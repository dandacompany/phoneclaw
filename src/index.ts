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
} from './db.js';
import { LocalAgentRunner } from './agent/local-runner.js';
import { MessageQueue } from './queue.js';
import { formatMessages, stripInternalTags } from './router.js';
import { startSchedulerLoop, computeNextRun } from './scheduler.js';
import { logger } from './logger.js';
import type { AgentRunner } from './agent/types.js';
import type { NewMessage, RegisteredChat, ScheduledTask } from './types.js';

// === 상태 ===
let lastTimestamp = '';
let lastAgentTimestamp: Record<string, string> = {};
let registeredChats: Record<string, RegisteredChat> = {};

let channel: TelegramChannel;
let agentRunner: AgentRunner;
const queue = new MessageQueue();

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
  logger.info({ chatCount: Object.keys(registeredChats).length }, '상태 로드 완료');
}

function saveState(): void {
  setRouterState('last_timestamp', lastTimestamp);
  setRouterState('last_agent_timestamp', JSON.stringify(lastAgentTimestamp));
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

  // 채팅 폴더 생성
  const chatDir = path.join(CHATS_DIR, folder);
  fs.mkdirSync(path.join(chatDir, 'logs'), { recursive: true });

  // 기본 CLAUDE.md 생성
  const claudeMdPath = path.join(chatDir, 'CLAUDE.md');
  if (!fs.existsSync(claudeMdPath)) {
    fs.writeFileSync(claudeMdPath, `# ${name}\n\n이 채팅의 AI 비서 설정입니다.\n`);
  }

  logger.info({ chatId, name, folder }, '채팅 등록 완료');
}

function unregisterChat(chatId: string): void {
  delete registeredChats[chatId];
  removeRegisteredChat(chatId);
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
    logger.error({ chat: chat.name, err }, '메시지 처리 실패, 커서 롤백');
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

        const byChatId = new Map<string, NewMessage[]>();
        for (const msg of messages) {
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
    onMessage: (_chatId: string, msg: NewMessage) => storeMessage(msg),
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
    },
  });

  await channel.connect();

  // Agent Runner 생성
  const localRunner = new LocalAgentRunner();
  localRunner.setMcpCallbacks({
    sendMessage: (chatId, text) => channel.sendMessage(chatId, text),
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
