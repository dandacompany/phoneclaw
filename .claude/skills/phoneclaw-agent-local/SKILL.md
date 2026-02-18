---
name: phoneclaw-agent-local
description: "PhoneClaw EP04 - Claude Agent (Local mode). Uses the @anthropic-ai/claude-code SDK to run per-chat Agents and perform message sending/scheduling via MCP tools."
---

> **Note:** This is an educational guide for understanding and customizing the Claude agent runner module.
> The core code is already included in the project. Run this skill only if you want to
> learn how this component works or customize its behavior.

# EP04: Claude Agent (Local Mode)

## Overview

Runs a Claude Agent as a local process using the `query` function from the `@anthropic-ai/claude-code` SDK.
Each chat maintains an independent session, and MCP tools enable Telegram message sending and task scheduling.

Key features:
- Per-chat working directory isolation (`chats/{folder}/`)
- Custom system prompts via per-chat CLAUDE.md
- Session resume (maintaining conversation context)
- MCP tools (send_message, schedule_task, etc.)
- Timeout support (AbortController)
- Allowed tools restriction (Read, Write, Bash, WebSearch, etc.)
- bypassPermissions mode

This episode generates 3 files:
- `src/agent/types.ts` - AgentRunner interface
- `src/agent/local-runner.ts` - LocalAgentRunner implementation
- `src/mcp/tools.ts` - MCP tool definitions (send_message, schedule_task, etc.)

## Dependencies

- **EP01 required**: `src/config.ts`, `src/logger.ts`, `src/types.ts`
- **EP03 required**: `src/db.ts` (uses getSession, setSession)
- `npm install` completed (@anthropic-ai/claude-code, zod included)

## Step-by-Step Instructions

### Step 1: Create directories

```bash
mkdir -p src/agent src/mcp
```

### Step 2: Create src/agent/types.ts

Define the AgentRunner interface. Write the following to `src/agent/types.ts`:

```typescript
import type { RegisteredChat, AgentInput, AgentOutput, OnAgentOutput } from '../types.js';

export interface AgentRunner {
  run(chat: RegisteredChat, input: AgentInput, onOutput?: OnAgentOutput): Promise<AgentOutput>;
  shutdown(): Promise<void>;
}
```

### Step 3: Create src/mcp/tools.ts

Define the MCP tools that the Agent will use during execution. Write the following to `src/mcp/tools.ts`:

```typescript
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

### Step 4: Create src/agent/local-runner.ts

Implement the Local mode Agent Runner using the Claude Agent SDK. Write the following to `src/agent/local-runner.ts`:

```typescript
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

## Verification

Run a type check to confirm there are no errors:

```bash
npx tsc --noEmit
```

If the type check passes, EP04 is complete.
For the Agent to respond to Telegram messages, this Runner must be connected via the message router (EP05).
