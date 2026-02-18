---
name: phoneclaw-message-loop
description: "PhoneClaw EP05 - 메인 메시지 처리 루프. Telegram 메시지 수신 -> DB 저장 -> 큐 -> Agent 실행 -> 응답 전송까지의 전체 흐름을 구성하는 핵심 파일을 자동 생성합니다."
---

# EP05: PhoneClaw Message Loop

Telegram 메시지를 수신하여 Agent에게 전달하고 응답을 반환하는 **메인 처리 루프**를 구성합니다.

## 개요

이 에피소드는 PhoneClaw의 핵심 동작 흐름을 담당하는 3개 파일을 생성합니다:

1. **`src/index.ts`** - 메인 엔트리포인트. Telegram 채널, Agent Runner, MessageQueue를 조합하여 전체 시스템을 부트스트랩합니다.
2. **`src/router.ts`** - 메시지 포맷팅(XML 구조) 및 내부 태그 제거 유틸리티.
3. **`src/queue.ts`** - 채팅별 동시실행 제어 큐. 한 채팅에 Agent가 이미 실행 중이면 대기열에 추가하고, 전체 동시실행 수를 제한합니다.

### 처리 흐름

```
Telegram 메시지 수신
  -> TelegramChannel.onMessage -> storeMessage(DB 저장)
  -> startMessageLoop (2초 폴링) -> getNewMessages
  -> queue.enqueueMessageCheck(chatId)
  -> processMessages(chatId)
    -> getMessagesSince(chatId, cursor) -> formatMessages(XML)
    -> agentRunner.run(chat, { prompt })
    -> channel.sendMessage(chatId, result)
    -> setSession(folder, sessionId)
```

## 의존성

- **EP01~EP04 완료 필수**: `config.ts`, `types.ts`, `db.ts`, `logger.ts`, `channel/telegram.ts`, `agent/local-runner.ts`, `agent/types.ts`, `mcp/tools.ts`, `scheduler.ts`가 이미 존재해야 합니다.
- **npm 패키지**: `grammy`, `better-sqlite3`, `pino`, `@anthropic-ai/claude-code`, `zod`, `cron-parser`

## 단계별 지시

### Step 1: `src/router.ts` 생성

메시지를 XML 형식으로 포맷팅하고, Agent 응답에서 `<internal>` 태그를 제거하는 유틸리티입니다.

```typescript
// src/router.ts
import type { NewMessage } from './types.js';

export function escapeXml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

export function formatMessages(messages: NewMessage[]): string {
  const lines = messages.map((m) =>
    `<message sender="${escapeXml(m.senderName)}" time="${m.timestamp}">${escapeXml(m.content)}</message>`,
  );
  return `<messages>\n${lines.join('\n')}\n</messages>`;
}

export function stripInternalTags(text: string): string {
  return text.replace(/<internal>[\s\S]*?<\/internal>/g, '').trim();
}
```

### Step 2: `src/queue.ts` 생성

채팅별 동시실행을 제어하는 메시지 큐입니다. `MAX_CONCURRENT_AGENTS` 설정에 따라 전체 동시 Agent 실행 수를 제한하고, 같은 채팅에 대해서는 순차 실행을 보장합니다.

```typescript
// src/queue.ts
import { MAX_CONCURRENT_AGENTS } from './config.js';
import { logger } from './logger.js';

interface QueuedJob {
  chatId: string;
  fn: () => Promise<void>;
}

interface ChatState {
  active: boolean;
  pendingMessages: boolean;
}

export class MessageQueue {
  private chats = new Map<string, ChatState>();
  private activeCount = 0;
  private waitingChats: string[] = [];
  private processMessagesFn: ((chatId: string) => Promise<void>) | null = null;
  private shuttingDown = false;

  private getChat(chatId: string): ChatState {
    let state = this.chats.get(chatId);
    if (!state) {
      state = { active: false, pendingMessages: false };
      this.chats.set(chatId, state);
    }
    return state;
  }

  setProcessMessagesFn(fn: (chatId: string) => Promise<void>): void {
    this.processMessagesFn = fn;
  }

  enqueueMessageCheck(chatId: string): void {
    if (this.shuttingDown) return;

    const state = this.getChat(chatId);

    // 이미 실행 중이면 대기열에 추가
    if (state.active) {
      state.pendingMessages = true;
      logger.debug({ chatId }, 'Agent 실행 중, 메시지 대기열 추가');
      return;
    }

    // 동시 실행 제한
    if (this.activeCount >= MAX_CONCURRENT_AGENTS) {
      state.pendingMessages = true;
      if (!this.waitingChats.includes(chatId)) {
        this.waitingChats.push(chatId);
      }
      logger.debug({ chatId, activeCount: this.activeCount }, '동시실행 제한, 대기열 추가');
      return;
    }

    this.runForChat(chatId);
  }

  private async runForChat(chatId: string): Promise<void> {
    const state = this.getChat(chatId);
    state.active = true;
    state.pendingMessages = false;
    this.activeCount++;

    logger.debug({ chatId, activeCount: this.activeCount }, 'Agent 실행 시작');

    try {
      if (this.processMessagesFn) {
        await this.processMessagesFn(chatId);
      }
    } catch (err) {
      logger.error({ chatId, err }, '메시지 처리 오류');
    } finally {
      state.active = false;
      this.activeCount--;
      this.drain(chatId);
    }
  }

  private drain(chatId: string): void {
    if (this.shuttingDown) return;

    const state = this.getChat(chatId);
    if (state.pendingMessages) {
      this.runForChat(chatId);
      return;
    }

    // 대기 중인 다른 채팅 처리
    this.drainWaiting();
  }

  private drainWaiting(): void {
    while (this.waitingChats.length > 0 && this.activeCount < MAX_CONCURRENT_AGENTS) {
      const nextChatId = this.waitingChats.shift()!;
      const state = this.getChat(nextChatId);
      if (state.pendingMessages) {
        this.runForChat(nextChatId);
      }
    }
  }

  async shutdown(): Promise<void> {
    this.shuttingDown = true;
    logger.info({ activeCount: this.activeCount }, 'MessageQueue 종료');
  }
}
```

### Step 3: `src/index.ts` 생성

메인 엔트리포인트입니다. 모든 컴포넌트를 조합하여 시스템을 시작합니다.

주요 역할:
- DB 초기화 및 상태 로드/저장 (`router_state` 테이블)
- 채팅 등록/해제 (`/register`, `/unregister`)
- 메시지 폴링 루프 (2초 간격)
- 메시지 처리: 트리거 패턴 확인 -> 커서 전진 -> Agent 실행 -> 응답 전송
- 크래시 복구: 미처리 메시지 큐 재등록
- Graceful shutdown: SIGTERM/SIGINT

```typescript
// src/index.ts
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
      // 다음 실행 시간 계산
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
```

## 핵심 설계 포인트

### 커서 기반 중복 방지

`lastAgentTimestamp[chatId]`를 사용하여 각 채팅별로 마지막 처리 완료 시점을 추적합니다. Agent 실행 전에 커서를 전진시키고, 실패 시 롤백합니다.

### MessageQueue의 동시실행 제어

| 상황 | 동작 |
|------|------|
| 같은 채팅에 Agent 실행 중 | `pendingMessages = true`, 완료 후 재처리 |
| 전체 동시실행 한도 초과 | `waitingChats`에 추가, 슬롯 확보 시 실행 |
| 종료 중 | 새 작업 거부 (`shuttingDown`) |

### Graceful Shutdown 순서

1. `queue.shutdown()` - 새 작업 거부
2. `agentRunner.shutdown()` - 진행 중 작업 정리
3. `channel.disconnect()` - Telegram 연결 종료

## 검증

```bash
# 타입 체크
npx tsc --noEmit

# 파일 존재 확인
ls -la src/index.ts src/router.ts src/queue.ts
```
