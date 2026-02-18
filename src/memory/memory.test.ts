import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'fs';
import path from 'path';
import os from 'os';
import type { MemoryConfig } from './types.js';

// config.CHATS_DIR를 임시 디렉토리로 오버라이드
const tmpBase = path.join(os.tmpdir(), `phoneclaw-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
fs.mkdirSync(tmpBase, { recursive: true });

vi.mock('../config.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../config.js')>();
  return { ...actual, CHATS_DIR: tmpBase };
});

// logger 모킹 (pino-pretty가 테스트 환경에서 문제 될 수 있으므로)
vi.mock('../logger.js', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

const { appendDailyLog, loadRecentMemory, loadLongTermMemory, saveLongTermMemory, recallMemory } = await import('./memory.js');

const config: MemoryConfig = {
  recentDays: 2,
  maxDailyLogKB: 8,
  maxLongTermKB: 16,
};

beforeEach(() => {
  fs.mkdirSync(path.join(tmpBase, 'test-chat', 'memory'), { recursive: true });
});

afterEach(() => {
  fs.rmSync(tmpBase, { recursive: true, force: true });
  fs.mkdirSync(tmpBase, { recursive: true });
});

describe('appendDailyLog', () => {
  it('일일 로그에 엔트리를 추가한다', () => {
    appendDailyLog('test-chat', '오늘 날씨가 좋다', config);

    const today = new Date().toISOString().slice(0, 10);
    const logPath = path.join(tmpBase, 'test-chat', 'memory', `${today}.md`);
    expect(fs.existsSync(logPath)).toBe(true);

    const content = fs.readFileSync(logPath, 'utf-8');
    expect(content).toContain('오늘 날씨가 좋다');
  });

  it('같은 날 여러 엔트리를 추가한다', () => {
    appendDailyLog('test-chat', '첫 번째', config);
    appendDailyLog('test-chat', '두 번째', config);

    const today = new Date().toISOString().slice(0, 10);
    const logPath = path.join(tmpBase, 'test-chat', 'memory', `${today}.md`);
    const content = fs.readFileSync(logPath, 'utf-8');
    expect(content).toContain('첫 번째');
    expect(content).toContain('두 번째');
  });
});

describe('loadRecentMemory', () => {
  it('최근 일지를 로드한다', () => {
    const today = new Date().toISOString().slice(0, 10);
    const memDir = path.join(tmpBase, 'test-chat', 'memory');
    fs.writeFileSync(path.join(memDir, `${today}.md`), '오늘의 기록');

    const result = loadRecentMemory('test-chat', config);
    expect(result).toContain(today);
    expect(result).toContain('오늘의 기록');
  });

  it('일지가 없으면 빈 문자열을 반환한다', () => {
    const result = loadRecentMemory('test-chat', config);
    expect(result).toBe('');
  });
});

describe('장기 기억', () => {
  it('장기 기억을 저장하고 로드한다', () => {
    saveLongTermMemory('test-chat', '# 중요한 사실\n- 사용자는 데이터 사이언티스트', config);
    const result = loadLongTermMemory('test-chat', config);
    expect(result).toContain('데이터 사이언티스트');
  });

  it('장기 기억이 없으면 빈 문자열을 반환한다', () => {
    expect(loadLongTermMemory('test-chat', config)).toBe('');
  });
});

describe('recallMemory', () => {
  it('키워드로 일일 로그를 검색한다', () => {
    appendDailyLog('test-chat', '파이썬 강의를 들었다', config);
    const result = recallMemory('test-chat', '파이썬');
    expect(result).toContain('파이썬');
  });

  it('키워드를 찾지 못하면 안내 메시지를 반환한다', () => {
    const result = recallMemory('test-chat', '없는키워드');
    expect(result).toContain('관련 기억을 찾을 수 없습니다');
  });

  it('장기 기억도 검색한다', () => {
    saveLongTermMemory('test-chat', '사용자는 서울에 거주', config);
    const result = recallMemory('test-chat', '서울');
    expect(result).toContain('서울');
    expect(result).toContain('장기 기억');
  });
});
