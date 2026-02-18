export interface MemoryConfig {
  /** 최근 일지 로드 일수 (기본 2) */
  recentDays: number;
  /** 일일 로그 최대 크기 KB (기본 8) */
  maxDailyLogKB: number;
  /** 장기 기억 최대 크기 KB (기본 16) */
  maxLongTermKB: number;
}
