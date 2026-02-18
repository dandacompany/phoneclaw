import { describe, it, expect, vi } from 'vitest';
import { withRetry } from './retry.js';

// logger 모킹
vi.mock('../logger.js', () => ({
  logger: { warn: vi.fn(), error: vi.fn(), info: vi.fn(), debug: vi.fn() },
}));

describe('withRetry', () => {
  it('첫 시도에 성공하면 바로 반환한다', async () => {
    const fn = vi.fn().mockResolvedValue('ok');
    const result = await withRetry(fn, { maxAttempts: 3, baseDelayMs: 10 });
    expect(result).toBe('ok');
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('실패 후 재시도하여 성공한다', async () => {
    const fn = vi.fn()
      .mockRejectedValueOnce(new Error('fail1'))
      .mockResolvedValue('ok');

    const result = await withRetry(fn, { maxAttempts: 3, baseDelayMs: 10 });
    expect(result).toBe('ok');
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it('모든 시도가 실패하면 마지막 에러를 던진다', async () => {
    const fn = vi.fn().mockRejectedValue(new Error('always fail'));

    await expect(withRetry(fn, { maxAttempts: 3, baseDelayMs: 10 })).rejects.toThrow('always fail');
    expect(fn).toHaveBeenCalledTimes(3);
  });

  it('기본값으로 3회 시도한다', async () => {
    const fn = vi.fn().mockRejectedValue(new Error('fail'));

    await expect(withRetry(fn, { baseDelayMs: 10 })).rejects.toThrow('fail');
    expect(fn).toHaveBeenCalledTimes(3);
  });
});
