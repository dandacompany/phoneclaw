import fs from 'fs';
import path from 'path';
import crypto from 'crypto';

import {
  BOT_NAME,
  CHATS_DIR,
  DATA_DIR,
  POLL_INTERVAL,
  TELEGRAM_BOT_TOKEN,
  TRIGGER_PATTERN,
  MEMORY_RECENT_DAYS,
  MEMORY_MAX_DAILY_LOG_KB,
  MEMORY_MAX_LONGTERM_KB,
  HEARTBEAT_ENABLED,
  HEARTBEAT_INTERVAL,
  HEARTBEAT_ACTIVE_START,
  HEARTBEAT_ACTIVE_END,
  WEBHOOK_ENABLED,
  WEBHOOK_PORT,
  WEBHOOK_TOKEN,
} from './config.js';
import { TelegramChannel } from './channel/telegram.js';
import {
  getAllRegisteredChats,
  getAllTasks,
  getMessagesSince,
  getNewMessages,
  getRouterState,
  initDatabase,
  setRegisteredChat,
  removeRegisteredChat,
  setRouterState,
  storeChatMetadata,
  storeMessage,
  setSession,
  createTask,
  updateTask,
  deleteTask,
  cleanupOldRunLogs,
  cleanupStaleSessions,
} from './db.js';
import { LocalAgentRunner } from './agent/local-runner.js';
import { MessageQueue } from './queue.js';
import { formatMessages, stripInternalTags } from './router.js';
import { startSchedulerLoop, computeNextRun } from './scheduler.js';
import { logger } from './logger.js';
import { createPendingPersona, savePersona } from './persona/persona.js';
import { appendDailyLog, recallMemory, saveLongTermMemory } from './memory/memory.js';
import { HeartbeatManager } from './heartbeat/heartbeat.js';
import { WebhookServer } from './webhook/server.js';
import { MetricsCollector } from './metrics/metrics.js';
import { RateLimiter } from './utils/rate-limiter.js';
import type { AgentRunner } from './agent/types.js';
import type { NewMessage, RegisteredChat, ScheduledTask } from './types.js';

// === 상태 ===
let lastTimestamp = '';
let lastAgentTimestamp: Record<string, string> = {};
let registeredChats: Record<string, RegisteredChat> = {};

let channel: TelegramChannel;
let agentRunner: AgentRunner;
const queue = new MessageQueue();
let heartbeatManager: HeartbeatManager | null = null;
let webhookServer: WebhookServer | null = null;

const metrics = MetricsCollector.getInstance();
const processedMessageIds = new Set<string>();
const MAX_PROCESSED_IDS = 1000;
const mcpSendRateLimiter = new RateLimiter(10, 60000); // 분당 10회

// 에러 알림 디바운스
let lastErrorNotifyTime: Record<string, number> = {};
const ERROR_NOTIFY_DEBOUNCE_MS = 60000; // 60초

// === 상태 관리 ===

function loadState(): void {
  lastTimestamp = getRouterState('last_timestamp') || '';
  const agentTs = getRouterState('last_agent_timestamp');
  try {
    lastAgentTimestamp = agentTs ? JSON.parse(agentTs) : {};
  } catch {
    logger.warn('last_agent_timestamp 손상, 초기화');
    lastAgentTimestamp = {};
  }
  registeredChats = getAllRegisteredChats();
  metrics.setGauge('registered_chats', Object.keys(registeredChats).length);
  logger.info({ chatCount: Object.keys(registeredChats).length }, '상태 로드 완료');
}

function saveState(): void {
  setRouterState('last_timestamp', lastTimestamp);
  setRouterState('last_agent_timestamp', JSON.stringify(lastAgentTimestamp));
}

// === 메시지 중복 방지 ===

function markProcessed(messageId: string): boolean {
  if (processedMessageIds.has(messageId)) return false;
  processedMessageIds.add(messageId);
  // 오래된 ID 정리
  if (processedMessageIds.size > MAX_PROCESSED_IDS) {
    const arr = [...processedMessageIds];
    for (let i = 0; i < arr.length - MAX_PROCESSED_IDS; i++) {
      processedMessageIds.delete(arr[i]);
    }
  }
  return true;
}

// === 에러 알림 ===

async function notifyError(chatId: string, error: string): Promise<void> {
  const now = Date.now();
  const lastNotify = lastErrorNotifyTime[chatId] || 0;
  if (now - lastNotify < ERROR_NOTIFY_DEBOUNCE_MS) return;

  lastErrorNotifyTime[chatId] = now;
  try {
    await channel.sendMessage(chatId, `처리 중 오류가 발생했습니다. 잠시 후 다시 시도해주세요.`);
  } catch {
    // 알림 전송 실패는 무시
  }
}

// === 채팅 등록 ===

function registerChat(chatId: string, name: string, folder: string, requiresTrigger: boolean): void {
  const chat: RegisteredChat = {
    chatId,
    name,
    folder,
    requiresTrigger,
    addedAt: new Date().toISOString(),
  };
  registeredChats[chatId] = chat;
  setRegisteredChat(chat);
  metrics.setGauge('registered_chats', Object.keys(registeredChats).length);

  // 채팅 폴더 생성
  const chatDir = path.join(CHATS_DIR, folder);
  fs.mkdirSync(path.join(chatDir, 'logs'), { recursive: true });

  // 기본 CLAUDE.md 생성
  const claudeMdPath = path.join(chatDir, 'CLAUDE.md');
  if (!fs.existsSync(claudeMdPath)) {
    fs.writeFileSync(claudeMdPath, `# ${name}\n\n이 채팅의 AI 비서 설정입니다.\n`);
  }

  // PERSONA.md 부트스트랩 대기 상태 생성
  createPendingPersona(folder);

  logger.info({ chatId, name, folder }, '채팅 등록 완료');
}

function unregisterChat(chatId: string): void {
  delete registeredChats[chatId];
  removeRegisteredChat(chatId);
  metrics.setGauge('registered_chats', Object.keys(registeredChats).length);
  logger.info({ chatId }, '채팅 등록 해제');
}

// === 메시지 처리 ===

async function processMessages(chatId: string): Promise<void> {
  const chat = registeredChats[chatId];
  if (!chat) return;

  const sinceTimestamp = lastAgentTimestamp[chatId] || '';
  const pendingMessages = getMessagesSince(chatId, sinceTimestamp);

  if (pendingMessages.length === 0) return;

  // 트리거 패턴 확인
  if (chat.requiresTrigger) {
    const hasTrigger = pendingMessages.some((m) => TRIGGER_PATTERN.test(m.content.trim()));
    if (!hasTrigger) return;
  }

  // 커서 전진 (중복 처리 방지)
  const previousCursor = lastAgentTimestamp[chatId] || '';
  lastAgentTimestamp[chatId] = pendingMessages[pendingMessages.length - 1].timestamp;
  saveState();

  metrics.increment('messages_processed', pendingMessages.length);
  logger.info({ chat: chat.name, messageCount: pendingMessages.length }, '메시지 처리 시작');

  // 트리거 텍스트에서 @BotName 제거
  const cleanedMessages = pendingMessages.map((m) => ({
    ...m,
    content: m.content.replace(TRIGGER_PATTERN, '').trim() || m.content,
  }));

  const prompt = formatMessages(cleanedMessages);

  // 타이핑 표시
  await channel.setTyping?.(chatId, true);

  try {
    const output = await agentRunner.run(chat, { prompt });

    // 응답 전송
    const text = stripInternalTags(output.result);
    if (text) {
      await channel.sendMessage(chatId, text);
    }

    // 세션 저장
    if (output.sessionId) {
      setSession(chat.folder, output.sessionId);
    }

    logger.info({ chat: chat.name, durationMs: output.durationMs }, '메시지 처리 완료');
  } catch (err) {
    lastAgentTimestamp[chatId] = previousCursor;
    saveState();
    const errorMsg = err instanceof Error ? err.message : String(err);
    logger.error({ chat: chat.name, err: errorMsg }, '메시지 처리 실패, 커서 롤백');
    await notifyError(chatId, errorMsg);
  }
}

// === 메시지 폴링 루프 ===

async function startMessageLoop(): Promise<void> {
  logger.info(`PhoneClaw 실행 중 (트리거: @${BOT_NAME})`);

  while (true) {
    try {
      const chatIds = Object.keys(registeredChats);
      const { messages, newTimestamp } = getNewMessages(chatIds, lastTimestamp);

      if (messages.length > 0) {
        lastTimestamp = newTimestamp;
        saveState();
        metrics.increment('messages_received', messages.length);

        const byChatId = new Map<string, NewMessage[]>();
        for (const msg of messages) {
          // 중복 메시지 필터링
          if (!markProcessed(msg.id)) continue;

          const existing = byChatId.get(msg.chatId);
          if (existing) existing.push(msg);
          else byChatId.set(msg.chatId, [msg]);
        }

        for (const chatId of byChatId.keys()) {
          queue.enqueueMessageCheck(chatId);
        }
      }
    } catch (err) {
      logger.error({ err }, '메시지 루프 오류');
    }
    await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL));
  }
}

// === 크래시 복구 ===

function recoverPendingMessages(): void {
  for (const [chatId, chat] of Object.entries(registeredChats)) {
    const sinceTimestamp = lastAgentTimestamp[chatId] || '';
    const pending = getMessagesSince(chatId, sinceTimestamp);
    if (pending.length > 0) {
      logger.info({ chat: chat.name, pendingCount: pending.length }, '복구: 미처리 메시지 발견');
      queue.enqueueMessageCheck(chatId);
    }
  }
}

// === 주기적 정리 ===

function startCleanupLoop(): void {
  // 1일 1회 실행
  const CLEANUP_INTERVAL = 24 * 60 * 60 * 1000;

  const cleanup = () => {
    try {
      const logsDeleted = cleanupOldRunLogs(14);
      const sessionsDeleted = cleanupStaleSessions(90);
      if (logsDeleted > 0 || sessionsDeleted > 0) {
        logger.info({ logsDeleted, sessionsDeleted }, '정기 정리 완료');
      }
    } catch (err) {
      logger.error({ err }, '정기 정리 오류');
    }
  };

  setInterval(cleanup, CLEANUP_INTERVAL);
  // 시작 30초 후 첫 실행
  setTimeout(cleanup, 30000);
}

// === 메모리 설정 ===

const memoryConfig = {
  recentDays: MEMORY_RECENT_DAYS,
  maxDailyLogKB: MEMORY_MAX_DAILY_LOG_KB,
  maxLongTermKB: MEMORY_MAX_LONGTERM_KB,
};

// === 메인 ===

async function main(): Promise<void> {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.mkdirSync(CHATS_DIR, { recursive: true });

  initDatabase();
  logger.info('데이터베이스 초기화 완료');
  loadState();

  // Graceful shutdown
  const shutdown = async (signal: string) => {
    logger.info({ signal }, '종료 신호 수신');
    heartbeatManager?.stop();
    if (webhookServer) await webhookServer.stop();
    await queue.shutdown();
    await agentRunner.shutdown();
    await channel.disconnect();
    process.exit(0);
  };
  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));

  // Telegram 채널 연결
  if (!TELEGRAM_BOT_TOKEN) {
    logger.error('TELEGRAM_BOT_TOKEN이 설정되지 않았습니다');
    process.exit(1);
  }

  channel = new TelegramChannel(TELEGRAM_BOT_TOKEN, {
    onMessage: (_chatId: string, msg: NewMessage) => {
      storeMessage(msg);
      metrics.increment('messages_received');
    },
    onChatMetadata: (chatId: string, timestamp: string, name?: string) =>
      storeChatMetadata(chatId, timestamp, name),
    registeredChats: () => registeredChats,
    adminCommands: {
      register: (chatId, name, folder, requiresTrigger) =>
        registerChat(chatId, name, folder, requiresTrigger),
      unregister: (chatId) => unregisterChat(chatId),
      getStatus: () => {
        const chatCount = Object.keys(registeredChats).length;
        const tasks = getAllTasks();
        const activeTasks = tasks.filter((t) => t.status === 'active').length;
        return [
          `${BOT_NAME} 상태`,
          `모드: local`,
          `등록 채팅: ${chatCount}개`,
          `예약 작업: ${activeTasks}/${tasks.length}개 활성`,
          `업타임: ${process.uptime().toFixed(0)}초`,
          HEARTBEAT_ENABLED ? `하트비트: 활성 (${HEARTBEAT_INTERVAL / 1000}s 간격)` : `하트비트: 비활성`,
          WEBHOOK_ENABLED ? `웹훅: 활성 (포트 ${WEBHOOK_PORT})` : `웹훅: 비활성`,
        ].join('\n');
      },
      getChats: () => {
        const entries = Object.values(registeredChats);
        if (entries.length === 0) return '등록된 채팅이 없습니다.';
        return entries
          .map((c) => `- ${c.name} (${c.chatId})\n  폴더: ${c.folder}, 트리거: ${c.requiresTrigger ? '필요' : '불필요'}`)
          .join('\n');
      },
      getTasks: () => {
        const tasks = getAllTasks();
        if (tasks.length === 0) return '예약 작업이 없습니다.';
        return tasks
          .map((t) => `- [${t.id.slice(0, 8)}] ${t.prompt.slice(0, 40)}...\n  ${t.scheduleType}: ${t.scheduleValue} (${t.status})`)
          .join('\n');
      },
      getMetrics: () => metrics.format(),
    },
  });

  await channel.connect();

  // Agent Runner 생성
  const localRunner = new LocalAgentRunner();
  localRunner.setMcpCallbacks({
    sendMessage: (chatId, text) => {
      if (!mcpSendRateLimiter.check(chatId)) {
        logger.warn({ chatId }, 'MCP send_message 레이트 리밋 초과');
        return Promise.resolve();
      }
      return channel.sendMessage(chatId, text);
    },
    scheduleTask: async (data) => {
      const taskId = crypto.randomUUID().slice(0, 8);
      const task: Omit<ScheduledTask, 'lastRun' | 'lastResult'> = {
        id: taskId,
        chatFolder: data.chatFolder,
        chatId: data.chatId,
        prompt: data.prompt,
        scheduleType: data.scheduleType,
        scheduleValue: data.scheduleValue,
        nextRun: null,
        status: 'active',
        createdAt: new Date().toISOString(),
        retryCount: 0,
        maxRetries: 2,
      };
      const nextRun = computeNextRun(task as ScheduledTask);
      createTask({ ...task, nextRun });
      return taskId;
    },
    listTasks: (chatFolder) => {
      const tasks = getAllTasks().filter((t) => t.chatFolder === chatFolder);
      if (tasks.length === 0) return '예약 작업 없음';
      return tasks
        .map((t) => `[${t.id}] ${t.prompt.slice(0, 50)} (${t.scheduleType}: ${t.scheduleValue}, ${t.status})`)
        .join('\n');
    },
    updateTaskStatus: async (taskId, status) => {
      updateTask(taskId, { status });
    },
    cancelTask: async (taskId) => {
      deleteTask(taskId);
    },
    savePersona: (chatFolder, content) => {
      savePersona(chatFolder, content);
    },
    saveMemory: (chatFolder, entry) => {
      appendDailyLog(chatFolder, entry, memoryConfig);
    },
    recallMemory: (chatFolder, keyword) => {
      return recallMemory(chatFolder, keyword);
    },
    updateLongTermMemory: (chatFolder, content) => {
      saveLongTermMemory(chatFolder, content, memoryConfig);
    },
  });
  agentRunner = localRunner;

  // 메시지 큐 설정
  queue.setProcessMessagesFn(processMessages);

  // 스케줄러 시작
  startSchedulerLoop({
    agentRunner,
    getRegisteredChats: () => registeredChats,
    sendMessage: (chatId, text) => channel.sendMessage(chatId, text),
  });

  // 하트비트 시작
  if (HEARTBEAT_ENABLED) {
    heartbeatManager = new HeartbeatManager({
      intervalMs: HEARTBEAT_INTERVAL,
      activeStart: HEARTBEAT_ACTIVE_START,
      activeEnd: HEARTBEAT_ACTIVE_END,
      agentRunner,
      getRegisteredChats: () => registeredChats,
      sendMessage: (chatId, text) => channel.sendMessage(chatId, text),
    });
    heartbeatManager.start();
  }

  // 웹훅 서버 시작
  if (WEBHOOK_ENABLED && WEBHOOK_TOKEN) {
    webhookServer = new WebhookServer({
      port: WEBHOOK_PORT,
      token: WEBHOOK_TOKEN,
      onMessage: async (chatId, message) => {
        const chat = registeredChats[chatId];
        if (!chat) throw new Error(`미등록 채팅: ${chatId}`);
        const output = await agentRunner.run(chat, { prompt: message });
        const text = stripInternalTags(output.result);
        if (text) await channel.sendMessage(chatId, text);
      },
      onWake: async (chatId) => {
        if (heartbeatManager) {
          const chat = registeredChats[chatId];
          if (!chat) throw new Error(`미등록 채팅: ${chatId}`);
          await heartbeatManager.triggerChat(chat.folder, chatId);
        }
      },
    });
    await webhookServer.start();
  }

  // 주기적 정리 시작
  startCleanupLoop();

  // 미처리 메시지 복구
  recoverPendingMessages();

  // 메시지 폴링 루프 시작
  startMessageLoop();
}

// 직접 실행인 경우에만 main() 호출
const isDirectRun =
  process.argv[1] &&
  new URL(import.meta.url).pathname === new URL(`file://${process.argv[1]}`).pathname;

if (isDirectRun) {
  main().catch((err) => {
    logger.error({ err }, 'PhoneClaw 시작 실패');
    process.exit(1);
  });
}
