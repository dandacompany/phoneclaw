import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { RateLimiter } from './rate-limiter.js';

describe('RateLimiter', () => {
  it('윈도우 내에서 허용된 횟수까지 허용한다', () => {
    const limiter = new RateLimiter(3, 60000);

    expect(limiter.check('user1')).toBe(true);
    expect(limiter.check('user1')).toBe(true);
    expect(limiter.check('user1')).toBe(true);
    expect(limiter.check('user1')).toBe(false); // 4번째는 거부
  });

  it('다른 키는 독립적으로 관리된다', () => {
    const limiter = new RateLimiter(1, 60000);

    expect(limiter.check('user1')).toBe(true);
    expect(limiter.check('user2')).toBe(true); // 다른 키
    expect(limiter.check('user1')).toBe(false); // 같은 키
  });

  it('남은 요청 수를 반환한다', () => {
    const limiter = new RateLimiter(5, 60000);

    expect(limiter.remaining('user1')).toBe(5);
    limiter.check('user1');
    expect(limiter.remaining('user1')).toBe(4);
  });

  it('윈도우가 지나면 다시 허용된다', () => {
    vi.useFakeTimers();
    const limiter = new RateLimiter(1, 1000); // 1초 윈도우

    expect(limiter.check('user1')).toBe(true);
    expect(limiter.check('user1')).toBe(false);

    vi.advanceTimersByTime(1100); // 윈도우 경과

    expect(limiter.check('user1')).toBe(true);
    vi.useRealTimers();
  });

  it('cleanup은 오래된 엔트리를 제거한다', () => {
    vi.useFakeTimers();
    const limiter = new RateLimiter(10, 1000);

    limiter.check('user1');
    vi.advanceTimersByTime(1100);
    limiter.cleanup();

    expect(limiter.remaining('user1')).toBe(10); // 정리됨
    vi.useRealTimers();
  });
});
