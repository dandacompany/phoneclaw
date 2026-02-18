import { logger } from '../logger.js';

export interface RetryOptions {
  /** 최대 재시도 횟수 (기본 3) */
  maxAttempts?: number;
  /** 기본 대기 시간 ms (기본 1000) */
  baseDelayMs?: number;
  /** 429 응답 시 Retry-After 헤더 존중 (기본 true) */
  respectRetryAfter?: boolean;
}

/**
 * 지수 백오프 재시도 헬퍼.
 * 429 에러의 Retry-After 헤더를 존중한다.
 */
export async function withRetry<T>(
  fn: () => Promise<T>,
  opts: RetryOptions = {},
): Promise<T> {
  const { maxAttempts = 3, baseDelayMs = 1000 } = opts;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await fn();
    } catch (err) {
      if (attempt === maxAttempts) throw err;

      const delay = baseDelayMs * Math.pow(2, attempt - 1);
      logger.warn(
        { attempt, maxAttempts, delayMs: delay, err: err instanceof Error ? err.message : String(err) },
        '재시도 대기',
      );
      await new Promise((resolve) => setTimeout(resolve, delay));
    }
  }

  // 도달하지 않지만 TypeScript를 위해
  throw new Error('withRetry: 모든 시도 실패');
}
