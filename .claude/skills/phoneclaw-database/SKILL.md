---
name: phoneclaw-database
description: "PhoneClaw EP03 - SQLite database. Manages all persistent data including chats, messages, sessions, and scheduled tasks using better-sqlite3."
---

# EP03: SQLite Database

## Overview

Implements a database module that manages all persistent data for PhoneClaw using better-sqlite3.
Optimizes concurrent read performance with WAL mode and manages the following tables:

- `chats` - Chat metadata (ID, name, last message time)
- `messages` - Inbound/outbound message history
- `registered_chats` - List of registered chats the bot responds to
- `sessions` - Per-chat Agent session IDs
- `scheduled_tasks` - Scheduled tasks (cron, interval, once)
- `task_run_logs` - Scheduled task execution logs
- `router_state` - Router state key-value store

Key features:
- Automatic schema creation (CREATE IF NOT EXISTS)
- In-memory DB support (for testing)
- Chat registration/unregistration, message storage/retrieval, session management, scheduled task CRUD

## Dependencies

- **EP01 must be completed**: Requires `src/config.ts`, `src/types.ts`
- `npm install` must be completed (including better-sqlite3)

## Step-by-Step Instructions

### Step 1: Create src/db.ts

Write `src/db.ts` with the following content:

```typescript
import Database from 'better-sqlite3';
import fs from 'fs';
import path from 'path';

import { DATA_DIR } from './config.js';
import type { NewMessage, RegisteredChat, ScheduledTask, TaskRunLog } from './types.js';

let db: Database.Database;

function createSchema(database: Database.Database): void {
  database.exec(`
    CREATE TABLE IF NOT EXISTS chats (
      chat_id TEXT PRIMARY KEY,
      name TEXT,
      last_message_time TEXT
    );

    CREATE TABLE IF NOT EXISTS messages (
      id TEXT,
      chat_id TEXT,
      sender_id TEXT,
      sender_name TEXT,
      content TEXT,
      timestamp TEXT,
      is_from_me INTEGER,
      PRIMARY KEY (id, chat_id),
      FOREIGN KEY (chat_id) REFERENCES chats(chat_id)
    );
    CREATE INDEX IF NOT EXISTS idx_messages_timestamp ON messages(timestamp);

    CREATE TABLE IF NOT EXISTS registered_chats (
      chat_id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      folder TEXT NOT NULL UNIQUE,
      requires_trigger INTEGER DEFAULT 1,
      added_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS sessions (
      chat_folder TEXT PRIMARY KEY,
      session_id TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS scheduled_tasks (
      id TEXT PRIMARY KEY,
      chat_folder TEXT NOT NULL,
      chat_id TEXT NOT NULL,
      prompt TEXT NOT NULL,
      schedule_type TEXT NOT NULL,
      schedule_value TEXT NOT NULL,
      next_run TEXT,
      last_run TEXT,
      last_result TEXT,
      status TEXT DEFAULT 'active',
      created_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_tasks_next_run ON scheduled_tasks(next_run);
    CREATE INDEX IF NOT EXISTS idx_tasks_status ON scheduled_tasks(status);

    CREATE TABLE IF NOT EXISTS task_run_logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      task_id TEXT NOT NULL,
      run_at TEXT NOT NULL,
      duration_ms INTEGER NOT NULL,
      status TEXT NOT NULL,
      result TEXT,
      error TEXT,
      FOREIGN KEY (task_id) REFERENCES scheduled_tasks(id)
    );
    CREATE INDEX IF NOT EXISTS idx_task_logs ON task_run_logs(task_id, run_at);

    CREATE TABLE IF NOT EXISTS router_state (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );
  `);
}

// === Initialization ===

export function initDatabase(): void {
  const dbPath = path.join(DATA_DIR, 'phoneclaw.db');
  fs.mkdirSync(path.dirname(dbPath), { recursive: true });
  db = new Database(dbPath);
  db.pragma('journal_mode = WAL');
  createSchema(db);
}

export function _initTestDatabase(): void {
  db = new Database(':memory:');
  createSchema(db);
}

// === Chat metadata ===

export function storeChatMetadata(chatId: string, timestamp: string, name?: string): void {
  if (name) {
    db.prepare(`
      INSERT INTO chats (chat_id, name, last_message_time) VALUES (?, ?, ?)
      ON CONFLICT(chat_id) DO UPDATE SET
        name = excluded.name,
        last_message_time = MAX(last_message_time, excluded.last_message_time)
    `).run(chatId, name, timestamp);
  } else {
    db.prepare(`
      INSERT INTO chats (chat_id, name, last_message_time) VALUES (?, ?, ?)
      ON CONFLICT(chat_id) DO UPDATE SET
        last_message_time = MAX(last_message_time, excluded.last_message_time)
    `).run(chatId, chatId, timestamp);
  }
}

export interface ChatInfo {
  chatId: string;
  name: string;
  lastMessageTime: string;
}

export function getAllChats(): ChatInfo[] {
  return (db.prepare(`
    SELECT chat_id, name, last_message_time
    FROM chats ORDER BY last_message_time DESC
  `).all() as Array<{ chat_id: string; name: string; last_message_time: string }>)
    .map((row) => ({
      chatId: row.chat_id,
      name: row.name,
      lastMessageTime: row.last_message_time,
    }));
}

// === Messages ===

export function storeMessage(msg: NewMessage): void {
  db.prepare(`
    INSERT OR REPLACE INTO messages (id, chat_id, sender_id, sender_name, content, timestamp, is_from_me)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(msg.id, msg.chatId, msg.senderId, msg.senderName, msg.content, msg.timestamp, msg.isFromMe ? 1 : 0);
}

export function getNewMessages(
  chatIds: string[],
  lastTimestamp: string,
): { messages: NewMessage[]; newTimestamp: string } {
  if (chatIds.length === 0) return { messages: [], newTimestamp: lastTimestamp };

  const placeholders = chatIds.map(() => '?').join(',');
  const rows = db.prepare(`
    SELECT id, chat_id, sender_id, sender_name, content, timestamp, is_from_me
    FROM messages
    WHERE timestamp > ? AND chat_id IN (${placeholders}) AND is_from_me = 0
    ORDER BY timestamp
  `).all(lastTimestamp, ...chatIds) as Array<{
    id: string; chat_id: string; sender_id: string; sender_name: string;
    content: string; timestamp: string; is_from_me: number;
  }>;

  let newTimestamp = lastTimestamp;
  const messages: NewMessage[] = rows.map((row) => {
    if (row.timestamp > newTimestamp) newTimestamp = row.timestamp;
    return {
      id: row.id,
      chatId: row.chat_id,
      senderId: row.sender_id,
      senderName: row.sender_name,
      content: row.content,
      timestamp: row.timestamp,
      isFromMe: row.is_from_me === 1,
    };
  });

  return { messages, newTimestamp };
}

export function getMessagesSince(chatId: string, sinceTimestamp: string): NewMessage[] {
  const rows = db.prepare(`
    SELECT id, chat_id, sender_id, sender_name, content, timestamp, is_from_me
    FROM messages
    WHERE chat_id = ? AND timestamp > ?
    ORDER BY timestamp
  `).all(chatId, sinceTimestamp) as Array<{
    id: string; chat_id: string; sender_id: string; sender_name: string;
    content: string; timestamp: string; is_from_me: number;
  }>;

  return rows.map((row) => ({
    id: row.id,
    chatId: row.chat_id,
    senderId: row.sender_id,
    senderName: row.sender_name,
    content: row.content,
    timestamp: row.timestamp,
    isFromMe: row.is_from_me === 1,
  }));
}

// === Registered chats ===

export function getRegisteredChat(chatId: string): RegisteredChat | undefined {
  const row = db.prepare('SELECT * FROM registered_chats WHERE chat_id = ?').get(chatId) as {
    chat_id: string; name: string; folder: string; requires_trigger: number; added_at: string;
  } | undefined;
  if (!row) return undefined;
  return {
    chatId: row.chat_id,
    name: row.name,
    folder: row.folder,
    requiresTrigger: row.requires_trigger === 1,
    addedAt: row.added_at,
  };
}

export function setRegisteredChat(chat: RegisteredChat): void {
  db.prepare(`
    INSERT OR REPLACE INTO registered_chats (chat_id, name, folder, requires_trigger, added_at)
    VALUES (?, ?, ?, ?, ?)
  `).run(chat.chatId, chat.name, chat.folder, chat.requiresTrigger ? 1 : 0, chat.addedAt);
}

export function removeRegisteredChat(chatId: string): void {
  db.prepare('DELETE FROM registered_chats WHERE chat_id = ?').run(chatId);
}

export function getAllRegisteredChats(): Record<string, RegisteredChat> {
  const rows = db.prepare('SELECT * FROM registered_chats').all() as Array<{
    chat_id: string; name: string; folder: string; requires_trigger: number; added_at: string;
  }>;
  const result: Record<string, RegisteredChat> = {};
  for (const row of rows) {
    result[row.chat_id] = {
      chatId: row.chat_id,
      name: row.name,
      folder: row.folder,
      requiresTrigger: row.requires_trigger === 1,
      addedAt: row.added_at,
    };
  }
  return result;
}

// === Sessions ===

export function getSession(chatFolder: string): string | undefined {
  const row = db.prepare('SELECT session_id FROM sessions WHERE chat_folder = ?').get(chatFolder) as {
    session_id: string;
  } | undefined;
  return row?.session_id;
}

export function setSession(chatFolder: string, sessionId: string): void {
  db.prepare('INSERT OR REPLACE INTO sessions (chat_folder, session_id) VALUES (?, ?)').run(chatFolder, sessionId);
}

// === Scheduled tasks ===

export function createTask(task: Omit<ScheduledTask, 'lastRun' | 'lastResult'>): void {
  db.prepare(`
    INSERT INTO scheduled_tasks (id, chat_folder, chat_id, prompt, schedule_type, schedule_value, next_run, status, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(task.id, task.chatFolder, task.chatId, task.prompt, task.scheduleType, task.scheduleValue, task.nextRun, task.status, task.createdAt);
}

export function getTaskById(id: string): ScheduledTask | undefined {
  const row = db.prepare('SELECT * FROM scheduled_tasks WHERE id = ?').get(id) as {
    id: string; chat_folder: string; chat_id: string; prompt: string;
    schedule_type: string; schedule_value: string; next_run: string | null;
    last_run: string | null; last_result: string | null; status: string; created_at: string;
  } | undefined;
  if (!row) return undefined;
  return {
    id: row.id,
    chatFolder: row.chat_folder,
    chatId: row.chat_id,
    prompt: row.prompt,
    scheduleType: row.schedule_type as ScheduledTask['scheduleType'],
    scheduleValue: row.schedule_value,
    nextRun: row.next_run,
    lastRun: row.last_run,
    lastResult: row.last_result,
    status: row.status as ScheduledTask['status'],
    createdAt: row.created_at,
  };
}

export function getAllTasks(): ScheduledTask[] {
  const rows = db.prepare('SELECT * FROM scheduled_tasks ORDER BY created_at DESC').all() as Array<{
    id: string; chat_folder: string; chat_id: string; prompt: string;
    schedule_type: string; schedule_value: string; next_run: string | null;
    last_run: string | null; last_result: string | null; status: string; created_at: string;
  }>;
  return rows.map((row) => ({
    id: row.id,
    chatFolder: row.chat_folder,
    chatId: row.chat_id,
    prompt: row.prompt,
    scheduleType: row.schedule_type as ScheduledTask['scheduleType'],
    scheduleValue: row.schedule_value,
    nextRun: row.next_run,
    lastRun: row.last_run,
    lastResult: row.last_result,
    status: row.status as ScheduledTask['status'],
    createdAt: row.created_at,
  }));
}

export function getDueTasks(): ScheduledTask[] {
  const now = new Date().toISOString();
  const rows = db.prepare(`
    SELECT * FROM scheduled_tasks
    WHERE status = 'active' AND next_run IS NOT NULL AND next_run <= ?
    ORDER BY next_run
  `).all(now) as Array<{
    id: string; chat_folder: string; chat_id: string; prompt: string;
    schedule_type: string; schedule_value: string; next_run: string | null;
    last_run: string | null; last_result: string | null; status: string; created_at: string;
  }>;
  return rows.map((row) => ({
    id: row.id,
    chatFolder: row.chat_folder,
    chatId: row.chat_id,
    prompt: row.prompt,
    scheduleType: row.schedule_type as ScheduledTask['scheduleType'],
    scheduleValue: row.schedule_value,
    nextRun: row.next_run,
    lastRun: row.last_run,
    lastResult: row.last_result,
    status: row.status as ScheduledTask['status'],
    createdAt: row.created_at,
  }));
}

export function updateTask(id: string, updates: Partial<Pick<ScheduledTask, 'nextRun' | 'status' | 'prompt'>>): void {
  const fields: string[] = [];
  const values: unknown[] = [];

  if (updates.nextRun !== undefined) { fields.push('next_run = ?'); values.push(updates.nextRun); }
  if (updates.status !== undefined) { fields.push('status = ?'); values.push(updates.status); }
  if (updates.prompt !== undefined) { fields.push('prompt = ?'); values.push(updates.prompt); }

  if (fields.length === 0) return;
  values.push(id);
  db.prepare(`UPDATE scheduled_tasks SET ${fields.join(', ')} WHERE id = ?`).run(...values);
}

export function updateTaskAfterRun(id: string, nextRun: string | null, lastResult: string): void {
  const now = new Date().toISOString();
  db.prepare(`
    UPDATE scheduled_tasks
    SET next_run = ?, last_run = ?, last_result = ?, status = CASE WHEN ? IS NULL THEN 'completed' ELSE status END
    WHERE id = ?
  `).run(nextRun, now, lastResult, nextRun, id);
}

export function deleteTask(id: string): void {
  db.prepare('DELETE FROM task_run_logs WHERE task_id = ?').run(id);
  db.prepare('DELETE FROM scheduled_tasks WHERE id = ?').run(id);
}

export function logTaskRun(log: TaskRunLog): void {
  db.prepare(`
    INSERT INTO task_run_logs (task_id, run_at, duration_ms, status, result, error)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(log.taskId, log.runAt, log.durationMs, log.status, log.result, log.error);
}

// === Router state ===

export function getRouterState(key: string): string | undefined {
  const row = db.prepare('SELECT value FROM router_state WHERE key = ?').get(key) as { value: string } | undefined;
  return row?.value;
}

export function setRouterState(key: string, value: string): void {
  db.prepare('INSERT OR REPLACE INTO router_state (key, value) VALUES (?, ?)').run(key, value);
}
```

## Verification

Run a type check to ensure there are no errors:

```bash
npx tsc --noEmit
```

If the type check passes, EP03 is complete.
In the next episode (EP04), we will integrate the Claude Agent in local mode.
