import { CronExpressionParser } from 'cron-parser';

import { SCHEDULER_POLL_INTERVAL, TIMEZONE } from './config.js';
import { getDueTasks, updateTaskAfterRun, logTaskRun, incrementTaskRetry, resetTaskRetry, updateTask } from './db.js';
import { logger } from './logger.js';
import { MetricsCollector } from './metrics/metrics.js';
import type { AgentRunner } from './agent/types.js';
import type { RegisteredChat, ScheduledTask } from './types.js';

const RETRY_DELAY_MS = 5 * 60 * 1000; // 재시도 5분 간격
const MAX_JITTER_MS = 30 * 1000; // 0~30초 jitter
const metrics = MetricsCollector.getInstance();

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

/**
 * 랜덤 jitter를 추가하여 동시 실행 분산.
 */
function jitter(): Promise<void> {
  const ms = Math.floor(Math.random() * MAX_JITTER_MS);
  return new Promise((resolve) => setTimeout(resolve, ms));
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

        // 동시 실행 jitter
        if (dueTasks.length > 1) {
          await jitter();
        }

        const startTime = Date.now();
        let status: 'success' | 'error' = 'success';
        let resultText = '';
        let errorText: string | null = null;

        try {
          logger.info({ taskId: task.id, prompt: task.prompt.slice(0, 50) }, '예약 작업 실행');
          metrics.increment('scheduler_runs');

          const output = await agentRunner.run(chat, {
            prompt: `[예약 작업] ${task.prompt}`,
          });

          resultText = output.result;

          // 결과를 채팅에 전송
          if (resultText && !resultText.startsWith('<internal>')) {
            await sendMessage(task.chatId, resultText);
          }

          // 성공 시 retry 카운트 초기화
          resetTaskRetry(task.id);
        } catch (err) {
          status = 'error';
          errorText = err instanceof Error ? err.message : String(err);
          logger.error({ taskId: task.id, err: errorText }, '예약 작업 실행 오류');

          // 재시도 로직
          if (task.retryCount < task.maxRetries) {
            incrementTaskRetry(task.id);
            const retryTime = new Date(Date.now() + RETRY_DELAY_MS).toISOString();
            updateTask(task.id, { nextRun: retryTime });
            logger.info(
              { taskId: task.id, retryCount: task.retryCount + 1, maxRetries: task.maxRetries, nextRetry: retryTime },
              '예약 작업 재시도 예약',
            );
            // 재시도 시 아래의 정상 nextRun 계산을 건너뜀
            logTaskRun({
              taskId: task.id,
              runAt: new Date().toISOString(),
              durationMs: Date.now() - startTime,
              status,
              result: resultText.slice(0, 1000),
              error: errorText,
            });
            continue;
          }
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

  // 즉시 1회 실행 (미실행 catch-up 포함)
  tick();
}
