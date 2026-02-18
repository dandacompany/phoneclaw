---
name: phoneclaw-scheduler
description: "EP08 - PhoneClaw Scheduled Task Scheduler"
---

> **Note:** This is an educational guide for understanding and customizing the scheduled tasks module.
> The core code is already included in the project. Run this skill only if you want to
> learn how this component works or customize its behavior.

# EP08: Scheduled Task Scheduler (phoneclaw-scheduler)

## Overview

Implements the scheduled task scheduler for the PhoneClaw bot. Supports three schedule types: cron expressions, fixed intervals, and one-time (once). Periodically checks for due tasks, executes them through the Agent, and sends results to the chat.

## Dependencies

- **EP01~EP08 must be completed**: Project scaffold, database, Telegram channel, Agent Runner, and message loop must all be implemented.
- `ScheduledTask` and `TaskRunLog` interfaces must be defined in `src/types.ts`.
- `getDueTasks`, `updateTaskAfterRun`, and `logTaskRun` functions must exist in `src/db.ts`.
- `SCHEDULER_POLL_INTERVAL` and `TIMEZONE` constants must be defined in `src/config.ts`.
- The `cron-parser` package must be installed (check `package.json`).

## Step-by-Step Instructions

### Step 1: Verify Dependencies

Verify that the following files exist:
- `src/types.ts` - `ScheduledTask`, `TaskRunLog` types
- `src/db.ts` - `getDueTasks`, `updateTaskAfterRun`, `logTaskRun` functions
- `src/config.ts` - `SCHEDULER_POLL_INTERVAL`, `TIMEZONE` constants
- `package.json` - `cron-parser` dependency

### Step 2: Create `src/scheduler.ts`

Create the `src/scheduler.ts` file with the following content:

```typescript
import { CronExpressionParser } from 'cron-parser';

import { SCHEDULER_POLL_INTERVAL, TIMEZONE } from './config.js';
import { getDueTasks, updateTaskAfterRun, logTaskRun } from './db.js';
import { logger } from './logger.js';
import type { AgentRunner } from './agent/types.js';
import type { RegisteredChat, ScheduledTask } from './types.js';

interface SchedulerOpts {
  agentRunner: AgentRunner;
  getRegisteredChats: () => Record<string, RegisteredChat>;
  sendMessage: (chatId: string, text: string) => Promise<void>;
}

export function computeNextRun(task: ScheduledTask): string | null {
  if (task.scheduleType === 'cron') {
    try {
      const interval = CronExpressionParser.parse(task.scheduleValue, { tz: TIMEZONE });
      return interval.next().toISOString();
    } catch {
      logger.warn({ taskId: task.id, cron: task.scheduleValue }, 'Invalid cron expression');
      return null;
    }
  }

  if (task.scheduleType === 'interval') {
    const ms = parseInt(task.scheduleValue, 10);
    if (isNaN(ms) || ms <= 0) return null;
    return new Date(Date.now() + ms).toISOString();
  }

  // once - no next run after execution
  return null;
}

export function startSchedulerLoop(opts: SchedulerOpts): void {
  const { agentRunner, getRegisteredChats, sendMessage } = opts;

  async function tick(): Promise<void> {
    try {
      const dueTasks = getDueTasks();
      if (dueTasks.length === 0) return;

      logger.info({ count: dueTasks.length }, 'Due tasks found');

      for (const task of dueTasks) {
        const chats = getRegisteredChats();
        const chat = chats[task.chatId];
        if (!chat) {
          logger.warn({ taskId: task.id, chatId: task.chatId }, 'Task for unregistered chat, skipping');
          continue;
        }

        const startTime = Date.now();
        let status: 'success' | 'error' = 'success';
        let resultText = '';
        let errorText: string | null = null;

        try {
          logger.info({ taskId: task.id, prompt: task.prompt.slice(0, 50) }, 'Executing scheduled task');

          const output = await agentRunner.run(chat, {
            prompt: `[Scheduled Task] ${task.prompt}`,
          });

          resultText = output.result;

          // Send result to chat
          if (resultText && !resultText.startsWith('<internal>')) {
            await sendMessage(task.chatId, resultText);
          }
        } catch (err) {
          status = 'error';
          errorText = err instanceof Error ? err.message : String(err);
          logger.error({ taskId: task.id, err: errorText }, 'Scheduled task execution error');
        }

        const durationMs = Date.now() - startTime;

        // Log the run
        logTaskRun({
          taskId: task.id,
          runAt: new Date().toISOString(),
          durationMs,
          status,
          result: resultText.slice(0, 1000),
          error: errorText,
        });

        // Calculate next run time
        const nextRun = computeNextRun(task);
        updateTaskAfterRun(task.id, nextRun, resultText.slice(0, 500));

        logger.info(
          { taskId: task.id, status, durationMs, nextRun },
          'Scheduled task completed',
        );
      }
    } catch (err) {
      logger.error({ err }, 'Scheduler loop error');
    }
  }

  // Periodic execution
  setInterval(tick, SCHEDULER_POLL_INTERVAL);
  logger.info({ interval: SCHEDULER_POLL_INTERVAL }, 'Scheduler started');

  // Execute immediately once
  tick();
}
```

### Step 3: Integrate Scheduler into `src/index.ts`

Connect the scheduler inside the `main()` function of `src/index.ts`. The following import and invocation code must be included:

**Add import** (top of file):
```typescript
import { startSchedulerLoop, computeNextRun } from './scheduler.js';
```

**Start scheduler inside main()** (after `queue.setProcessMessagesFn(processMessages)`):
```typescript
  // Start the scheduler
  startSchedulerLoop({
    agentRunner,
    getRegisteredChats: () => registeredChats,
    sendMessage: (chatId, text) => channel.sendMessage(chatId, text),
  });
```

**Use computeNextRun in the MCP callback's scheduleTask**:
```typescript
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
```

## Core Behavior

1. **Three schedule types**:
   - `cron`: Cron expression (`0 9 * * *` = every day at 09:00)
   - `interval`: Millisecond interval (`3600000` = every hour)
   - `once`: One-time execution, then transitions to `completed` status

2. **Execution flow**:
   - `tick()` runs every `SCHEDULER_POLL_INTERVAL` (default 60 seconds)
   - `getDueTasks()` retrieves active tasks where `next_run <= now`
   - For each task, runs the Agent and sends the result to the chat
   - `logTaskRun()` records the execution history
   - `computeNextRun()` calculates the next run time and updates the DB

3. **Safety mechanisms**:
   - Tasks for unregistered chats are skipped
   - On error, status is recorded as `error` but the scheduler loop continues running
   - `once` type returns `nextRun = null` after execution -> marked as `completed` in DB

## Verification

1. Verify TypeScript compilation:
```bash
cd /Users/dante/workspace/dante-code/projects/phoneclaw && npx tsc --noEmit
```

2. Verify that `src/scheduler.ts` exists and exports `computeNextRun` and `startSchedulerLoop`

3. Verify that `src/index.ts` imports `startSchedulerLoop` and calls it inside `main()`

4. Run tests (if available):
```bash
cd /Users/dante/workspace/dante-code/projects/phoneclaw && npm test
```
