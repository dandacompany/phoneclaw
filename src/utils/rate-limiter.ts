/**
 * 슬라이딩 윈도우 레이트 리미터.
 * 키별로 독립적인 윈도우를 관리한다.
 */
export class RateLimiter {
  private windows = new Map<string, number[]>();
  private readonly maxRequests: number;
  private readonly windowMs: number;

  /**
   * @param maxRequests 윈도우 내 최대 요청 수
   * @param windowMs 윈도우 크기 (밀리초, 기본 60000 = 1분)
   */
  constructor(maxRequests: number, windowMs = 60000) {
    this.maxRequests = maxRequests;
    this.windowMs = windowMs;
  }

  /**
   * 요청이 허용되는지 확인하고, 허용되면 기록한다.
   * @param key 레이트 리밋 키 (예: chatId, userId)
   * @returns true면 허용, false면 제한됨
   */
  check(key: string): boolean {
    const now = Date.now();
    const cutoff = now - this.windowMs;

    let timestamps = this.windows.get(key);
    if (!timestamps) {
      timestamps = [];
      this.windows.set(key, timestamps);
    }

    // 윈도우 밖의 오래된 기록 제거
    while (timestamps.length > 0 && timestamps[0] <= cutoff) {
      timestamps.shift();
    }

    if (timestamps.length >= this.maxRequests) {
      return false;
    }

    timestamps.push(now);
    return true;
  }

  /**
   * 특정 키의 남은 요청 수를 반환한다.
   */
  remaining(key: string): number {
    const now = Date.now();
    const cutoff = now - this.windowMs;
    const timestamps = this.windows.get(key);
    if (!timestamps) return this.maxRequests;
    const valid = timestamps.filter((t) => t > cutoff);
    return Math.max(0, this.maxRequests - valid.length);
  }

  /**
   * 메모리 정리: 오래된 엔트리 제거.
   */
  cleanup(): void {
    const now = Date.now();
    const cutoff = now - this.windowMs;
    for (const [key, timestamps] of this.windows) {
      const valid = timestamps.filter((t) => t > cutoff);
      if (valid.length === 0) {
        this.windows.delete(key);
      } else {
        this.windows.set(key, valid);
      }
    }
  }
}
