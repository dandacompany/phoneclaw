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
      logger.warn({ taskId: task.id, cron: task.scheduleValue }, '잘못된 cron 표현식');
      return null;
    }
  }

  if (task.scheduleType === 'interval') {
    const ms = parseInt(task.scheduleValue, 10);
    if (isNaN(ms) || ms <= 0) return null;
    return new Date(Date.now() + ms).toISOString();
  }

  // once - 이미 실행되면 다음 실행 없음
  return null;
}

export function startSchedulerLoop(opts: SchedulerOpts): void {
  const { agentRunner, getRegisteredChats, sendMessage } = opts;

  async function tick(): Promise<void> {
    try {
      const dueTasks = getDueTasks();
      if (dueTasks.length === 0) return;

      logger.info({ count: dueTasks.length }, '실행 대기 작업 발견');

      for (const task of dueTasks) {
        const chats = getRegisteredChats();
        const chat = chats[task.chatId];
        if (!chat) {
          logger.warn({ taskId: task.id, chatId: task.chatId }, '등록되지 않은 채팅의 작업, 건너뜀');
          continue;
        }

        const startTime = Date.now();
        let status: 'success' | 'error' = 'success';
        let resultText = '';
        let errorText: string | null = null;

        try {
          logger.info({ taskId: task.id, prompt: task.prompt.slice(0, 50) }, '예약 작업 실행');

          const output = await agentRunner.run(chat, {
            prompt: `[예약 작업] ${task.prompt}`,
          });

          resultText = output.result;

          // 결과를 채팅에 전송
          if (resultText && !resultText.startsWith('<internal>')) {
            await sendMessage(task.chatId, resultText);
          }
        } catch (err) {
          status = 'error';
          errorText = err instanceof Error ? err.message : String(err);
          logger.error({ taskId: task.id, err: errorText }, '예약 작업 실행 오류');
        }

        const durationMs = Date.now() - startTime;

        // 실행 로그 기록
        logTaskRun({
          taskId: task.id,
          runAt: new Date().toISOString(),
          durationMs,
          status,
          result: resultText.slice(0, 1000),
          error: errorText,
        });

        // 다음 실행 시간 계산
        const nextRun = computeNextRun(task);
        updateTaskAfterRun(task.id, nextRun, resultText.slice(0, 500));

        logger.info(
          { taskId: task.id, status, durationMs, nextRun },
          '예약 작업 완료',
        );
      }
    } catch (err) {
      logger.error({ err }, '스케줄러 루프 오류');
    }
  }

  // 주기적 실행
  setInterval(tick, SCHEDULER_POLL_INTERVAL);
  logger.info({ interval: SCHEDULER_POLL_INTERVAL }, '스케줄러 시작');

  // 즉시 1회 실행
  tick();
}
