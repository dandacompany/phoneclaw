---
name: phoneclaw-mcp-tools
description: "PhoneClaw EP06 - Agent MCP Tools. Uses Claude Code SDK's MCP server to provide a tool set that enables the Agent to send Telegram messages, manage scheduled tasks, and more during execution."
---

> **Note:** This is an educational guide for understanding and customizing the MCP tools module.
> The core code is already included in the project. Run this skill only if you want to
> learn how this component works or customize its behavior.

# EP06: PhoneClaw MCP Tools

Defines **MCP (Model Context Protocol) tools** that the Agent can use during execution, and integrates them into the Local Runner.

## Overview

Uses `createSdkMcpServer` from the Claude Code SDK to build a custom MCP server. Through these MCP tools, the Agent can:

- **`send_message`**: Send a message to the user immediately during execution (progress updates, etc.)
- **`schedule_task`**: Register scheduled tasks via cron/interval/once
- **`list_tasks`**: List scheduled tasks for the current chat
- **`pause_task`** / **`resume_task`**: Pause/resume tasks
- **`cancel_task`**: Cancel and delete tasks

### Architecture

```
Agent (Claude Code)
  |
  ├── mcp__phoneclaw__send_message   -> callbacks.sendMessage -> TelegramChannel
  ├── mcp__phoneclaw__schedule_task  -> callbacks.scheduleTask -> DB
  ├── mcp__phoneclaw__list_tasks     -> callbacks.listTasks -> DB
  ├── mcp__phoneclaw__pause_task     -> callbacks.updateTaskStatus -> DB
  ├── mcp__phoneclaw__resume_task    -> callbacks.updateTaskStatus -> DB
  └── mcp__phoneclaw__cancel_task    -> callbacks.cancelTask -> DB
```

MCP tools are implemented using the callback pattern, so the actual execution logic (Telegram sending, DB operations) is injected from `index.ts`.

## Dependencies

- **EP01~EP04 required**: `config.ts`, `types.ts`, `db.ts`, `agent/types.ts` must exist
- **npm packages**: `@anthropic-ai/claude-code`, `@modelcontextprotocol/sdk`, `zod`

## Step-by-Step Instructions

### Step 1: Create `src/mcp/tools.ts`

The MCP server factory function. Captures `chatId` and `chatFolder` via closure so each tool operates in the correct chat context.

```typescript
// src/mcp/tools.ts
import { createSdkMcpServer, tool } from '@anthropic-ai/claude-code';
import { z } from 'zod';

export interface McpToolCallbacks {
  sendMessage: (chatId: string, text: string) => Promise<void>;
  scheduleTask?: (data: {
    prompt: string;
    scheduleType: 'cron' | 'interval' | 'once';
    scheduleValue: string;
    chatId: string;
    chatFolder: string;
  }) => Promise<string>;
  listTasks?: (chatFolder: string) => string;
  updateTaskStatus?: (taskId: string, status: 'active' | 'paused') => Promise<void>;
  cancelTask?: (taskId: string) => Promise<void>;
}

export function createPhoneClawMcpServer(chatId: string, chatFolder: string, callbacks: McpToolCallbacks) {
  return createSdkMcpServer({
    name: 'phoneclaw',
    version: '1.0.0',
    tools: [
      tool(
        'send_message',
        'Sends a message to the user immediately during execution. Use for progress updates or sending multiple messages.',
        { text: z.string().describe('Message text to send') },
        async (args) => {
          await callbacks.sendMessage(chatId, args.text);
          return { content: [{ type: 'text' as const, text: 'Message sent.' }] };
        },
      ),

      tool(
        'schedule_task',
        `Registers a scheduled task. Supports cron/interval/once types.
- cron: "0 9 * * *" (every day at 9 AM)
- interval: "3600000" (every hour, in milliseconds)
- once: "2026-02-01T15:30:00" (one-time, local time)`,
        {
          prompt: z.string().describe('Prompt to pass to the Agent when the task runs'),
          schedule_type: z.enum(['cron', 'interval', 'once']),
          schedule_value: z.string().describe('Schedule value'),
        },
        async (args) => {
          if (!callbacks.scheduleTask) {
            return { content: [{ type: 'text' as const, text: 'Scheduler is not enabled.' }], isError: true };
          }
          const taskId = await callbacks.scheduleTask({
            prompt: args.prompt,
            scheduleType: args.schedule_type,
            scheduleValue: args.schedule_value,
            chatId,
            chatFolder,
          });
          return { content: [{ type: 'text' as const, text: `Task scheduled (ID: ${taskId})` }] };
        },
      ),

      tool(
        'list_tasks',
        'Lists scheduled tasks for the current chat.',
        {},
        async () => {
          if (!callbacks.listTasks) {
            return { content: [{ type: 'text' as const, text: 'Scheduler is not enabled.' }] };
          }
          const list = callbacks.listTasks(chatFolder);
          return { content: [{ type: 'text' as const, text: list || 'No scheduled tasks.' }] };
        },
      ),

      tool(
        'pause_task',
        'Pauses a scheduled task.',
        { task_id: z.string().describe('Task ID') },
        async (args) => {
          if (!callbacks.updateTaskStatus) {
            return { content: [{ type: 'text' as const, text: 'Scheduler is not enabled.' }], isError: true };
          }
          await callbacks.updateTaskStatus(args.task_id, 'paused');
          return { content: [{ type: 'text' as const, text: `Task ${args.task_id} paused.` }] };
        },
      ),

      tool(
        'resume_task',
        'Resumes a paused task.',
        { task_id: z.string().describe('Task ID') },
        async (args) => {
          if (!callbacks.updateTaskStatus) {
            return { content: [{ type: 'text' as const, text: 'Scheduler is not enabled.' }], isError: true };
          }
          await callbacks.updateTaskStatus(args.task_id, 'active');
          return { content: [{ type: 'text' as const, text: `Task ${args.task_id} resumed.` }] };
        },
      ),

      tool(
        'cancel_task',
        'Cancels and deletes a scheduled task.',
        { task_id: z.string().describe('Task ID') },
        async (args) => {
          if (!callbacks.cancelTask) {
            return { content: [{ type: 'text' as const, text: 'Scheduler is not enabled.' }], isError: true };
          }
          await callbacks.cancelTask(args.task_id);
          return { content: [{ type: 'text' as const, text: `Task ${args.task_id} cancelled.` }] };
        },
      ),
    ],
  });
}
```

### Step 2: Integrate MCP into `src/agent/local-runner.ts`

Create the MCP server in the Local Runner and inject it into the Claude Code `query()` call. Key integration points:

1. **`setMcpCallbacks()`**: Inject callback functions from external code (index.ts)
2. **`createPhoneClawMcpServer()`**: Create per-chat MCP server instances
3. **`query({ mcpServers })`**: Pass MCP server when running the Agent
4. **`allowedTools: ['mcp__phoneclaw__*']`**: MCP tool allow pattern

```typescript
// src/agent/local-runner.ts
import fs from 'fs';
import path from 'path';
import { query } from '@anthropic-ai/claude-code';

import { AGENT_TIMEOUT, CHATS_DIR, BOT_NAME } from '../config.js';
import { logger } from '../logger.js';
import { getSession, setSession } from '../db.js';
import { createPhoneClawMcpServer, type McpToolCallbacks } from '../mcp/tools.js';
import type { AgentRunner } from './types.js';
import type { RegisteredChat, AgentInput, AgentOutput, OnAgentOutput } from '../types.js';

export class LocalAgentRunner implements AgentRunner {
  private mcpCallbacks: McpToolCallbacks | null = null;

  setMcpCallbacks(callbacks: McpToolCallbacks): void {
    this.mcpCallbacks = callbacks;
  }

  async run(chat: RegisteredChat, input: AgentInput, onOutput?: OnAgentOutput): Promise<AgentOutput> {
    const startTime = Date.now();
    const chatDir = path.join(CHATS_DIR, chat.folder);
    fs.mkdirSync(chatDir, { recursive: true });

    // Per-chat CLAUDE.md
    const claudeMdPath = path.join(chatDir, 'CLAUDE.md');

    // Resume existing session or create new one
    const existingSessionId = input.sessionId || getSession(chat.folder);

    // Build global system prompt
    let systemAppend = `Your name is ${BOT_NAME}. Respond to Telegram messages in Korean. Keep the conversation concise and natural.`;
    if (fs.existsSync(claudeMdPath)) {
      systemAppend += '\n\n' + fs.readFileSync(claudeMdPath, 'utf-8');
    }

    let sessionId = existingSessionId;
    let resultText = '';
    const timeout = input.timeout || AGENT_TIMEOUT;

    // Create MCP server (provides tools like send_message)
    const mcpServers: Record<string, any> = {};
    if (this.mcpCallbacks) {
      mcpServers.phoneclaw = createPhoneClawMcpServer(chat.chatId, chat.folder, this.mcpCallbacks);
    }

    try {
      const abortController = new AbortController();
      const timer = setTimeout(() => abortController.abort(), timeout);

      for await (const message of query({
        prompt: input.prompt,
        options: {
          cwd: chatDir,
          resume: existingSessionId,
          appendSystemPrompt: systemAppend,
          allowedTools: [
            'Read', 'Write', 'Edit', 'Glob', 'Grep',
            'Bash',
            'WebSearch', 'WebFetch',
            'Task', 'TaskOutput',
            'mcp__phoneclaw__*',
          ],
          permissionMode: 'bypassPermissions',
          mcpServers,
          abortController,
        },
      })) {
        // Session initialization
        if (message.type === 'system' && message.subtype === 'init') {
          sessionId = message.session_id;
          logger.debug({ sessionId, chat: chat.folder }, 'Agent session started');
        }

        // Collect results
        if (message.type === 'result') {
          const text = 'result' in message ? (message as { result?: string }).result : null;
          if (text) {
            resultText = text;
            onOutput?.(text);
          }
        }
      }

      clearTimeout(timer);

      // Save session ID
      if (sessionId) {
        setSession(chat.folder, sessionId);
      }

      const durationMs = Date.now() - startTime;
      logger.info({ chat: chat.folder, durationMs, sessionId }, 'Agent execution completed');

      return {
        result: resultText || '(No response)',
        sessionId: sessionId || '',
        durationMs,
      };
    } catch (err) {
      const durationMs = Date.now() - startTime;
      const errorMsg = err instanceof Error ? err.message : String(err);
      logger.error({ chat: chat.folder, err: errorMsg, durationMs }, 'Agent execution error');

      return {
        result: `An error occurred: ${errorMsg}`,
        sessionId: sessionId || '',
        durationMs,
      };
    }
  }

  async shutdown(): Promise<void> {
    logger.info('LocalAgentRunner shutting down');
  }
}
```

### Step 3: Connect MCP callbacks in `index.ts` (refer to EP05)

In the `main()` function of `index.ts`, call `setMcpCallbacks()` after creating the LocalAgentRunner. This part is already included in EP05 (message-loop), so complete EP05 first before running this skill.

Key connection code:

```typescript
// index.ts (created in EP05) - relevant section
const localRunner = new LocalAgentRunner();
localRunner.setMcpCallbacks({
  sendMessage: (chatId, text) => channel.sendMessage(chatId, text),
  scheduleTask: async (data) => {
    const taskId = crypto.randomUUID().slice(0, 8);
    // ... save task to DB
    return taskId;
  },
  listTasks: (chatFolder) => { /* DB query */ },
  updateTaskStatus: async (taskId, status) => { updateTask(taskId, { status }); },
  cancelTask: async (taskId) => { deleteTask(taskId); },
});
agentRunner = localRunner;
```

## MCP Tool Details

### send_message

| Field | Description |
|-------|-------------|
| Purpose | Send a message immediately during execution |
| Parameters | `text: string` |
| Usage example | "Analyzing data. Please wait..." |
| Internal flow | `callbacks.sendMessage(chatId, text)` -> `TelegramChannel.sendMessage()` |

### schedule_task

| Field | Description |
|-------|-------------|
| Purpose | Register a recurring/scheduled task |
| Parameters | `prompt`, `schedule_type` (cron/interval/once), `schedule_value` |
| cron example | `"0 9 * * *"` - every day at 9 AM |
| interval example | `"3600000"` - every hour (in milliseconds) |
| once example | `"2026-02-01T15:30:00"` - one-time execution |

### list_tasks / pause_task / resume_task / cancel_task

CRUD tools for scheduled tasks. Queries and manages only the tasks belonging to the relevant chat based on `chatFolder`.

## Verification

```bash
# Type check
npx tsc --noEmit

# Verify files exist
ls -la src/mcp/tools.ts src/agent/local-runner.ts
```
