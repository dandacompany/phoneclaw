---
name: phoneclaw-message-loop
description: "PhoneClaw EP05 - Main message processing loop. Automatically generates the core files that handle the entire flow: Telegram message reception -> DB storage -> queue -> Agent execution -> response delivery."
---

# EP05: PhoneClaw Message Loop

Receives Telegram messages, routes them to the Agent, and returns responses via the **main processing loop**.

## Overview

This episode generates 3 files that handle PhoneClaw's core operational flow:

1. **`src/index.ts`** - Main entrypoint. Bootstraps the entire system by composing the Telegram channel, Agent Runner, and MessageQueue.
2. **`src/router.ts`** - Message formatting (XML structure) and internal tag removal utilities.
3. **`src/queue.ts`** - Per-chat concurrency control queue. If an Agent is already running for a chat, new messages are queued; total concurrent execution is capped.

### Processing Flow

```
Telegram message received
  -> TelegramChannel.onMessage -> storeMessage(DB storage)
  -> startMessageLoop (2-second polling) -> getNewMessages
  -> queue.enqueueMessageCheck(chatId)
  -> processMessages(chatId)
    -> getMessagesSince(chatId, cursor) -> formatMessages(XML)
    -> agentRunner.run(chat, { prompt })
    -> channel.sendMessage(chatId, result)
    -> setSession(folder, sessionId)
```

## Dependencies

- **EP01~EP04 required**: `config.ts`, `types.ts`, `db.ts`, `logger.ts`, `channel/telegram.ts`, `agent/local-runner.ts`, `agent/types.ts`, `mcp/tools.ts`, `scheduler.ts` must already exist.
- **npm packages**: `grammy`, `better-sqlite3`, `pino`, `@anthropic-ai/claude-code`, `zod`, `cron-parser`

## Step-by-Step Instructions

### Step 1: Create `src/router.ts`

Utility for formatting messages into XML and stripping `<internal>` tags from Agent responses.

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

### Step 2: Create `src/queue.ts`

A message queue that controls per-chat concurrency. Limits total concurrent Agent executions based on the `MAX_CONCURRENT_AGENTS` setting, and guarantees sequential execution within the same chat.

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

    // If already running, add to pending queue
    if (state.active) {
      state.pendingMessages = true;
      logger.debug({ chatId }, 'Agent running, message added to pending queue');
      return;
    }

    // Concurrency limit
    if (this.activeCount >= MAX_CONCURRENT_AGENTS) {
      state.pendingMessages = true;
      if (!this.waitingChats.includes(chatId)) {
        this.waitingChats.push(chatId);
      }
      logger.debug({ chatId, activeCount: this.activeCount }, 'Concurrency limit reached, added to waiting queue');
      return;
    }

    this.runForChat(chatId);
  }

  private async runForChat(chatId: string): Promise<void> {
    const state = this.getChat(chatId);
    state.active = true;
    state.pendingMessages = false;
    this.activeCount++;

    logger.debug({ chatId, activeCount: this.activeCount }, 'Agent execution started');

    try {
      if (this.processMessagesFn) {
        await this.processMessagesFn(chatId);
      }
    } catch (err) {
      logger.error({ chatId, err }, 'Message processing error');
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

    // Process other waiting chats
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
    logger.info({ activeCount: this.activeCount }, 'MessageQueue shutting down');
  }
}
```

### Step 3: Create `src/index.ts`

The main entrypoint. Composes all components to start the system.

Key responsibilities:
- DB initialization and state load/save (`router_state` table)
- Chat registration/unregistration (`/register`, `/unregister`)
- Message polling loop (2-second interval)
- Message processing: check trigger pattern -> advance cursor -> run Agent -> send response
- Crash recovery: re-enqueue unprocessed messages
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

// === State ===
let lastTimestamp = '';
let lastAgentTimestamp: Record<string, string> = {};
let registeredChats: Record<string, RegisteredChat> = {};

let channel: TelegramChannel;
let agentRunner: AgentRunner;
const queue = new MessageQueue();

// === State Management ===

function loadState(): void {
  lastTimestamp = getRouterState('last_timestamp') || '';
  const agentTs = getRouterState('last_agent_timestamp');
  try {
    lastAgentTimestamp = agentTs ? JSON.parse(agentTs) : {};
  } catch {
    logger.warn('last_agent_timestamp corrupted, resetting');
    lastAgentTimestamp = {};
  }
  registeredChats = getAllRegisteredChats();
  logger.info({ chatCount: Object.keys(registeredChats).length }, 'State loaded');
}

function saveState(): void {
  setRouterState('last_timestamp', lastTimestamp);
  setRouterState('last_agent_timestamp', JSON.stringify(lastAgentTimestamp));
}

// === Chat Registration ===

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

  // Create chat folder
  const chatDir = path.join(CHATS_DIR, folder);
  fs.mkdirSync(path.join(chatDir, 'logs'), { recursive: true });

  // Create default CLAUDE.md
  const claudeMdPath = path.join(chatDir, 'CLAUDE.md');
  if (!fs.existsSync(claudeMdPath)) {
    fs.writeFileSync(claudeMdPath, `# ${name}\n\nAI assistant configuration for this chat.\n`);
  }

  logger.info({ chatId, name, folder }, 'Chat registered');
}

function unregisterChat(chatId: string): void {
  delete registeredChats[chatId];
  removeRegisteredChat(chatId);
  logger.info({ chatId }, 'Chat unregistered');
}

// === Message Processing ===

async function processMessages(chatId: string): Promise<void> {
  const chat = registeredChats[chatId];
  if (!chat) return;

  const sinceTimestamp = lastAgentTimestamp[chatId] || '';
  const pendingMessages = getMessagesSince(chatId, sinceTimestamp);

  if (pendingMessages.length === 0) return;

  // Check trigger pattern
  if (chat.requiresTrigger) {
    const hasTrigger = pendingMessages.some((m) => TRIGGER_PATTERN.test(m.content.trim()));
    if (!hasTrigger) return;
  }

  // Advance cursor (prevent duplicate processing)
  const previousCursor = lastAgentTimestamp[chatId] || '';
  lastAgentTimestamp[chatId] = pendingMessages[pendingMessages.length - 1].timestamp;
  saveState();

  logger.info({ chat: chat.name, messageCount: pendingMessages.length }, 'Message processing started');

  // Remove @BotName from trigger text
  const cleanedMessages = pendingMessages.map((m) => ({
    ...m,
    content: m.content.replace(TRIGGER_PATTERN, '').trim() || m.content,
  }));

  const prompt = formatMessages(cleanedMessages);

  // Show typing indicator
  await channel.setTyping?.(chatId, true);

  try {
    const output = await agentRunner.run(chat, { prompt });

    // Send response
    const text = stripInternalTags(output.result);
    if (text) {
      await channel.sendMessage(chatId, text);
    }

    // Save session
    if (output.sessionId) {
      setSession(chat.folder, output.sessionId);
    }

    logger.info({ chat: chat.name, durationMs: output.durationMs }, 'Message processing completed');
  } catch (err) {
    lastAgentTimestamp[chatId] = previousCursor;
    saveState();
    logger.error({ chat: chat.name, err }, 'Message processing failed, cursor rolled back');
  }
}

// === Message Polling Loop ===

async function startMessageLoop(): Promise<void> {
  logger.info(`PhoneClaw running (trigger: @${BOT_NAME})`);

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
      logger.error({ err }, 'Message loop error');
    }
    await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL));
  }
}

// === Crash Recovery ===

function recoverPendingMessages(): void {
  for (const [chatId, chat] of Object.entries(registeredChats)) {
    const sinceTimestamp = lastAgentTimestamp[chatId] || '';
    const pending = getMessagesSince(chatId, sinceTimestamp);
    if (pending.length > 0) {
      logger.info({ chat: chat.name, pendingCount: pending.length }, 'Recovery: unprocessed messages found');
      queue.enqueueMessageCheck(chatId);
    }
  }
}

// === Main ===

async function main(): Promise<void> {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.mkdirSync(CHATS_DIR, { recursive: true });

  initDatabase();
  logger.info('Database initialized');
  loadState();

  // Graceful shutdown
  const shutdown = async (signal: string) => {
    logger.info({ signal }, 'Shutdown signal received');
    await queue.shutdown();
    await agentRunner.shutdown();
    await channel.disconnect();
    process.exit(0);
  };
  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));

  // Connect Telegram channel
  if (!TELEGRAM_BOT_TOKEN) {
    logger.error('TELEGRAM_BOT_TOKEN is not set');
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
          `${BOT_NAME} Status`,
          `Mode: local`,
          `Registered chats: ${chatCount}`,
          `Scheduled tasks: ${activeTasks}/${tasks.length} active`,
          `Uptime: ${process.uptime().toFixed(0)}s`,
        ].join('\n');
      },
      getChats: () => {
        const entries = Object.values(registeredChats);
        if (entries.length === 0) return 'No registered chats.';
        return entries
          .map((c) => `- ${c.name} (${c.chatId})\n  Folder: ${c.folder}, Trigger: ${c.requiresTrigger ? 'required' : 'not required'}`)
          .join('\n');
      },
      getTasks: () => {
        const tasks = getAllTasks();
        if (tasks.length === 0) return 'No scheduled tasks.';
        return tasks
          .map((t) => `- [${t.id.slice(0, 8)}] ${t.prompt.slice(0, 40)}...\n  ${t.scheduleType}: ${t.scheduleValue} (${t.status})`)
          .join('\n');
      },
    },
  });

  await channel.connect();

  // Create Agent Runner
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
      // Calculate next run time
      const nextRun = computeNextRun(task as ScheduledTask);
      createTask({ ...task, nextRun });
      return taskId;
    },
    listTasks: (chatFolder) => {
      const tasks = getAllTasks().filter((t) => t.chatFolder === chatFolder);
      if (tasks.length === 0) return 'No scheduled tasks';
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

  // Set up message queue
  queue.setProcessMessagesFn(processMessages);

  // Start scheduler
  startSchedulerLoop({
    agentRunner,
    getRegisteredChats: () => registeredChats,
    sendMessage: (chatId, text) => channel.sendMessage(chatId, text),
  });

  // Recover unprocessed messages
  recoverPendingMessages();

  // Start message polling loop
  startMessageLoop();
}

// Only call main() when run directly
const isDirectRun =
  process.argv[1] &&
  new URL(import.meta.url).pathname === new URL(`file://${process.argv[1]}`).pathname;

if (isDirectRun) {
  main().catch((err) => {
    logger.error({ err }, 'PhoneClaw startup failed');
    process.exit(1);
  });
}
```

## Key Design Points

### Cursor-Based Deduplication

Uses `lastAgentTimestamp[chatId]` to track the last processed timestamp for each chat. The cursor is advanced before Agent execution and rolled back on failure.

### MessageQueue Concurrency Control

| Scenario | Behavior |
|----------|----------|
| Agent already running for the same chat | `pendingMessages = true`, reprocessed after completion |
| Total concurrency limit exceeded | Added to `waitingChats`, executed when a slot opens |
| Shutting down | New jobs rejected (`shuttingDown`) |

### Graceful Shutdown Order

1. `queue.shutdown()` - Reject new jobs
2. `agentRunner.shutdown()` - Clean up in-progress work
3. `channel.disconnect()` - Close Telegram connection

## Verification

```bash
# Type check
npx tsc --noEmit

# Verify files exist
ls -la src/index.ts src/router.ts src/queue.ts
```
