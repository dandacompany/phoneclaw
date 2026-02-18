---
name: phoneclaw-scaffold
description: "PhoneClaw EP01 - Project foundation setup. Auto-generates TypeScript + ESM project initial configuration, environment variables, logger, and type definitions."
---

> **Note:** This is an educational guide for understanding and customizing the project foundation module.
> The core code is already included in the project. Run this skill only if you want to
> learn how this component works or customize its behavior.

# EP01: PhoneClaw Project Foundation Setup

## Overview

Sets up the foundation for the Telegram AI assistant bot project "PhoneClaw".
Configures the following in a Node.js 20+ / TypeScript (ESM) environment:

- `package.json` - Project dependencies and scripts
- `tsconfig.json` - TypeScript compiler configuration
- `.env.example` - Environment variable template
- `.gitignore` - Git ignore file
- `CLAUDE.md` - Project convention guide
- `src/config.ts` - Environment variable loading and constant definitions
- `src/logger.ts` - pino-based logger
- `src/types.ts` - Shared interface/type definitions

## Dependencies

- No prior episodes (this is the first episode)
- Requires Node.js 20 or above

## Step-by-Step Instructions

### Step 1: Create Project Directory

Create the project root directory. Skip if it already exists.

```bash
mkdir -p phoneclaw/src
cd phoneclaw
```

### Step 2: Create package.json

Write `package.json` with the following content:

```json
{
  "name": "phoneclaw",
  "version": "0.1.0",
  "description": "Telegram AI assistant bot - Based on Claude Code Skills",
  "type": "module",
  "main": "dist/index.js",
  "scripts": {
    "build": "tsc",
    "start": "node dist/index.js",
    "dev": "tsx src/index.ts",
    "typecheck": "tsc --noEmit",
    "test": "vitest run",
    "test:watch": "vitest"
  },
  "dependencies": {
    "@anthropic-ai/claude-code": "^1.0.21",
    "@modelcontextprotocol/sdk": "^1.12.1",
    "better-sqlite3": "^11.8.1",
    "cron-parser": "^5.5.0",
    "grammy": "^1.30.0",
    "pino": "^9.6.0",
    "pino-pretty": "^13.0.0",
    "zod": "^3.24.0"
  },
  "devDependencies": {
    "@types/better-sqlite3": "^7.6.8",
    "@types/node": "^22.10.7",
    "tsx": "^4.0.0",
    "typescript": "^5.7.0",
    "vitest": "^3.0.0"
  },
  "engines": {
    "node": ">=20"
  }
}
```

### Step 3: Create tsconfig.json

Write `tsconfig.json` with the following content:

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "Node16",
    "moduleResolution": "Node16",
    "outDir": "dist",
    "rootDir": "src",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "forceConsistentCasingInFileNames": true,
    "resolveJsonModule": true,
    "declaration": true,
    "declarationMap": true,
    "sourceMap": true
  },
  "include": ["src/**/*"],
  "exclude": ["node_modules", "dist"]
}
```

### Step 4: Create .env.example

Write `.env.example` with the following content:

```
# === Required Settings ===
TELEGRAM_BOT_TOKEN=          # Issued from @BotFather
ANTHROPIC_API_KEY=            # Issued from Anthropic console

# === Optional Settings ===
BOT_NAME=PhoneClaw            # Bot display name (used in trigger pattern)
ANTHROPIC_MODEL=claude-sonnet-4-20250514
ANTHROPIC_BASE_URL=           # Alternative API-compatible endpoint (leave empty for official API)
ADMIN_USER_IDS=               # Comma-separated Telegram user IDs (for admin commands)
LOG_LEVEL=info                # trace, debug, info, warn, error, fatal
AGENT_TIMEOUT=300000          # Agent execution timeout (ms, default 5 min)
MAX_CONCURRENT_AGENTS=3       # Max concurrent agent limit
TZ=Asia/Seoul                 # Scheduler timezone
```

### Step 5: Create .gitignore

Write `.gitignore` with the following content:

```
node_modules/
dist/
data/
chats/
*.db
*.db-journal
.env
*.log
.DS_Store
```

### Step 6: Create CLAUDE.md

Write `CLAUDE.md` with the following content:

```markdown
# PhoneClaw - Telegram AI Assistant Bot

## Project Overview
Telegram AI assistant bot based on Claude Agent SDK + grammy.
Built as a YouTube tutorial series, where each episode corresponds to one Claude Code skill.

## Tech Stack
- **Runtime**: Node.js 20+, TypeScript (ESM)
- **AI**: @anthropic-ai/claude-code (Agent SDK)
- **Messaging**: grammy (Telegram Bot API)
- **DB**: better-sqlite3 (SQLite)
- **MCP**: @modelcontextprotocol/sdk
- **Logging**: pino + pino-pretty

## Code Conventions
- Identifiers (variables, functions, classes): English
- Comments, log messages: Korean
- File extension: `.ts`, use `.js` in imports (ESM)
- Indentation: 2 spaces
- Semicolons required
- Single quotes by default

## Directory Structure
- `src/` - Source code
- `data/` - Runtime data (DB, sessions, IPC) — gitignored
- `chats/` - Per-chat settings (CLAUDE.md, logs) — gitignored
- `ref/` - Reference materials

## Key Commands
\`\`\`bash
npm run dev       # Run in development mode
npm run build     # Compile TypeScript
npm start         # Run in production
npm run typecheck # Type check
npm test          # Run tests
\`\`\`

## Environment Variables
See `.env.example`. Copy to `.env` and fill in values.
```

### Step 7: Create src/config.ts

Write `src/config.ts` with the following content:

```typescript
import path from 'path';

// === Bot basic settings ===
export const BOT_NAME = process.env.BOT_NAME || 'PhoneClaw';
// proot-distro environment: only local mode supported (Docker unavailable)

// === Telegram ===
export const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN || '';

// === Anthropic ===
export const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY || '';
export const ANTHROPIC_MODEL = process.env.ANTHROPIC_MODEL || 'claude-sonnet-4-20250514';
export const ANTHROPIC_BASE_URL = process.env.ANTHROPIC_BASE_URL || '';

// === Admin ===
export const ADMIN_USER_IDS = (process.env.ADMIN_USER_IDS || '')
  .split(',')
  .map((id) => id.trim())
  .filter(Boolean);

// === Paths ===
const PROJECT_ROOT = process.cwd();
export const DATA_DIR = path.resolve(PROJECT_ROOT, 'data');
export const CHATS_DIR = path.resolve(PROJECT_ROOT, 'chats');
export const DB_PATH = path.resolve(DATA_DIR, 'phoneclaw.db');
export const SESSIONS_DIR = path.resolve(DATA_DIR, 'sessions');
export const IPC_DIR = path.resolve(DATA_DIR, 'ipc');

// === Agent execution ===
export const AGENT_TIMEOUT = parseInt(process.env.AGENT_TIMEOUT || '300000', 10);
export const MAX_CONCURRENT_AGENTS = Math.max(
  1,
  parseInt(process.env.MAX_CONCURRENT_AGENTS || '3', 10) || 3,
);

// === Polling/Timing ===
export const POLL_INTERVAL = 2000;
export const IPC_POLL_INTERVAL = 1000;
export const SCHEDULER_POLL_INTERVAL = 60000;

// === Logging ===
export const LOG_LEVEL = process.env.LOG_LEVEL || 'info';

// === Timezone ===
export const TIMEZONE = process.env.TZ || Intl.DateTimeFormat().resolvedOptions().timeZone;

// === Trigger pattern ===
function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
export const TRIGGER_PATTERN = new RegExp(`^@${escapeRegex(BOT_NAME)}\\b`, 'i');

```

### Step 8: Create src/logger.ts

Write `src/logger.ts` with the following content:

```typescript
import pino from 'pino';
import { LOG_LEVEL } from './config.js';

export const logger = pino({
  level: LOG_LEVEL,
  transport: {
    target: 'pino-pretty',
    options: {
      colorize: true,
      translateTime: 'SYS:yyyy-mm-dd HH:MM:ss.l',
      ignore: 'pid,hostname',
    },
  },
});
```

### Step 9: Create src/types.ts

Write `src/types.ts` with the following content:

```typescript
// === Channel abstraction ===

export interface Channel {
  name: string;
  connect(): Promise<void>;
  sendMessage(chatId: string, text: string): Promise<void>;
  setTyping?(chatId: string, isTyping: boolean): Promise<void>;
  isConnected(): boolean;
  disconnect(): Promise<void>;
}

export type OnInboundMessage = (chatId: string, message: NewMessage) => void;
export type OnChatMetadata = (chatId: string, timestamp: string, name?: string) => void;

// === Messages ===

export interface NewMessage {
  id: string;
  chatId: string;
  senderId: string;
  senderName: string;
  content: string;
  timestamp: string;
  isFromMe?: boolean;
}

// === Registered chats ===

export interface RegisteredChat {
  chatId: string;
  name: string;
  folder: string;
  requiresTrigger: boolean;
  addedAt: string;
}

// === Agent ===

export interface AgentInput {
  prompt: string;
  sessionId?: string;
  claudeMdPath?: string;
  timeout?: number;
}

export interface AgentOutput {
  result: string;
  sessionId: string;
  durationMs: number;
}

export type OnAgentOutput = (chunk: string) => void;

export interface AgentRunner {
  run(chat: RegisteredChat, input: AgentInput, onOutput?: OnAgentOutput): Promise<AgentOutput>;
  shutdown(): Promise<void>;
}

// === Scheduling ===

export interface ScheduledTask {
  id: string;
  chatFolder: string;
  chatId: string;
  prompt: string;
  scheduleType: 'cron' | 'interval' | 'once';
  scheduleValue: string;
  nextRun: string | null;
  lastRun: string | null;
  lastResult: string | null;
  status: 'active' | 'paused' | 'completed';
  createdAt: string;
}

export interface TaskRunLog {
  taskId: string;
  runAt: string;
  durationMs: number;
  status: 'success' | 'error';
  result: string | null;
  error: string | null;
}
```

### Step 10: Install Dependencies

```bash
npm install
```

### Step 11: Verify Directory Structure

```bash
mkdir -p data chats
```

## Verification

After all files are created, run a type check to ensure there are no errors:

```bash
npx tsc --noEmit
```

If the type check passes, EP01 is complete.
In the next episode (EP02), we will connect the Telegram bot.
