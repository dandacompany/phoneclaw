import { describe, it, expect, vi } from 'vitest';
import { computeNextRun } from './scheduler.js';
import type { ScheduledTask } from './types.js';

function makeTask(overrides: Partial<ScheduledTask> = {}): ScheduledTask {
  return {
    id: 'test-1',
    chatFolder: 'test',
    chatId: 'tg:123',
    prompt: 'test prompt',
    scheduleType: 'cron',
    scheduleValue: '0 9 * * *',
    nextRun: null,
    lastRun: null,
    lastResult: null,
    status: 'active',
    createdAt: '2026-01-01T00:00:00Z',
    retryCount: 0,
    maxRetries: 2,
    ...overrides,
  };
}

describe('computeNextRun', () => {
  it('cron 표현식으로 다음 실행 시간을 계산한다', () => {
    const task = makeTask({ scheduleType: 'cron', scheduleValue: '0 9 * * *' });
    const result = computeNextRun(task);
    expect(result).not.toBeNull();
    expect(result).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  it('잘못된 cron 표현식은 null을 반환한다', () => {
    const task = makeTask({ scheduleType: 'cron', scheduleValue: 'invalid' });
    const result = computeNextRun(task);
    expect(result).toBeNull();
  });

  it('interval 타입은 현재 시각 + ms를 반환한다', () => {
    const before = Date.now();
    const task = makeTask({ scheduleType: 'interval', scheduleValue: '3600000' });
    const result = computeNextRun(task);
    expect(result).not.toBeNull();

    const nextRunTime = new Date(result!).getTime();
    expect(nextRunTime).toBeGreaterThanOrEqual(before + 3600000 - 100);
    expect(nextRunTime).toBeLessThanOrEqual(before + 3600000 + 1000);
  });

  it('interval에 잘못된 값은 null을 반환한다', () => {
    const task = makeTask({ scheduleType: 'interval', scheduleValue: 'abc' });
    expect(computeNextRun(task)).toBeNull();
  });

  it('interval에 0 이하 값은 null을 반환한다', () => {
    const task = makeTask({ scheduleType: 'interval', scheduleValue: '-1000' });
    expect(computeNextRun(task)).toBeNull();
  });

  it('once 타입은 항상 null을 반환한다', () => {
    const task = makeTask({ scheduleType: 'once', scheduleValue: '2026-01-01T00:00:00Z' });
    expect(computeNextRun(task)).toBeNull();
  });
});
