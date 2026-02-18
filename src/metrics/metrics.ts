/**
 * 경량 인메모리 메트릭스 수집기.
 * /metrics 관리자 명령어로 확인 가능.
 */
export class MetricsCollector {
  private static instance: MetricsCollector;

  // 카운터
  private counters = new Map<string, number>();
  // 게이지
  private gauges = new Map<string, number>();
  // 히스토그램 (최근 100개)
  private histograms = new Map<string, number[]>();
  // 시작 시간
  private startTime = Date.now();

  private constructor() {}

  static getInstance(): MetricsCollector {
    if (!MetricsCollector.instance) {
      MetricsCollector.instance = new MetricsCollector();
    }
    return MetricsCollector.instance;
  }

  // === 카운터 ===

  increment(name: string, value = 1): void {
    this.counters.set(name, (this.counters.get(name) || 0) + value);
  }

  getCounter(name: string): number {
    return this.counters.get(name) || 0;
  }

  // === 게이지 ===

  setGauge(name: string, value: number): void {
    this.gauges.set(name, value);
  }

  getGauge(name: string): number {
    return this.gauges.get(name) || 0;
  }

  // === 히스토그램 ===

  record(name: string, value: number): void {
    let values = this.histograms.get(name);
    if (!values) {
      values = [];
      this.histograms.set(name, values);
    }
    values.push(value);
    // 최근 100개만 유지
    if (values.length > 100) {
      values.shift();
    }
  }

  getHistogramStats(name: string): { count: number; avg: number; p50: number; p95: number; max: number } {
    const values = this.histograms.get(name);
    if (!values || values.length === 0) {
      return { count: 0, avg: 0, p50: 0, p95: 0, max: 0 };
    }
    const sorted = [...values].sort((a, b) => a - b);
    const count = sorted.length;
    const avg = Math.round(sorted.reduce((a, b) => a + b, 0) / count);
    const p50 = sorted[Math.floor(count * 0.5)];
    const p95 = sorted[Math.floor(count * 0.95)];
    const max = sorted[count - 1];
    return { count, avg, p50, p95, max };
  }

  // === 포매팅 ===

  format(): string {
    const uptimeS = Math.floor((Date.now() - this.startTime) / 1000);
    const lines: string[] = [];

    lines.push(`Uptime: ${formatDuration(uptimeS)}`);
    lines.push('');

    // 카운터
    lines.push('--- Counters ---');
    for (const [name, value] of sorted(this.counters)) {
      lines.push(`  ${name}: ${value}`);
    }

    // 게이지
    lines.push('');
    lines.push('--- Gauges ---');
    for (const [name, value] of sorted(this.gauges)) {
      lines.push(`  ${name}: ${value}`);
    }

    // 히스토그램
    if (this.histograms.size > 0) {
      lines.push('');
      lines.push('--- Histograms ---');
      for (const [name] of sorted(this.histograms)) {
        const stats = this.getHistogramStats(name);
        lines.push(`  ${name}: count=${stats.count} avg=${stats.avg}ms p50=${stats.p50}ms p95=${stats.p95}ms max=${stats.max}ms`);
      }
    }

    return lines.join('\n');
  }
}

function formatDuration(seconds: number): string {
  const d = Math.floor(seconds / 86400);
  const h = Math.floor((seconds % 86400) / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;
  const parts: string[] = [];
  if (d > 0) parts.push(`${d}d`);
  if (h > 0) parts.push(`${h}h`);
  if (m > 0) parts.push(`${m}m`);
  parts.push(`${s}s`);
  return parts.join(' ');
}

function sorted<T>(map: Map<string, T>): [string, T][] {
  return [...map.entries()].sort((a, b) => a[0].localeCompare(b[0]));
}
