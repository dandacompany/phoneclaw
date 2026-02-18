import fs from 'fs';
import path from 'path';

import { CHATS_DIR } from '../config.js';
import { logger } from '../logger.js';
import type { MemoryConfig } from './types.js';

const MEMORY_DIR = 'memory';
const LONG_TERM_FILE = 'MEMORY.md';

function memoryDir(chatFolder: string): string {
  return path.join(CHATS_DIR, chatFolder, MEMORY_DIR);
}

function dailyLogPath(chatFolder: string, date: string): string {
  return path.join(memoryDir(chatFolder), `${date}.md`);
}

function longTermPath(chatFolder: string): string {
  return path.join(memoryDir(chatFolder), LONG_TERM_FILE);
}

function ensureMemoryDir(chatFolder: string): void {
  fs.mkdirSync(memoryDir(chatFolder), { recursive: true });
}

function todayString(): string {
  return new Date().toISOString().slice(0, 10);
}

function truncateToKB(text: string, maxKB: number): string {
  const maxBytes = maxKB * 1024;
  if (Buffer.byteLength(text, 'utf-8') <= maxBytes) return text;
  // 라인 단위로 절삭
  const lines = text.split('\n');
  let result = '';
  for (const line of lines) {
    const next = result + line + '\n';
    if (Buffer.byteLength(next, 'utf-8') > maxBytes) break;
    result = next;
  }
  return result.trimEnd();
}

/**
 * 일일 로그에 엔트리 추가 (append-only)
 */
export function appendDailyLog(chatFolder: string, entry: string, config: MemoryConfig): void {
  ensureMemoryDir(chatFolder);
  const date = todayString();
  const filePath = dailyLogPath(chatFolder, date);

  // 기존 내용 확인하여 크기 제한
  let existing = '';
  if (fs.existsSync(filePath)) {
    existing = fs.readFileSync(filePath, 'utf-8');
  }

  const timestamp = new Date().toLocaleTimeString('ko-KR', { hour12: false });
  const newContent = `${existing}\n## ${timestamp}\n${entry}\n`;

  const truncated = truncateToKB(newContent, config.maxDailyLogKB);
  fs.writeFileSync(filePath, truncated, 'utf-8');
  logger.debug({ chatFolder, date }, '일일 메모리 로그 추가');
}

/**
 * 최근 N일간의 일일 로그를 로드한다.
 */
export function loadRecentMemory(chatFolder: string, config: MemoryConfig): string {
  const dir = memoryDir(chatFolder);
  if (!fs.existsSync(dir)) return '';

  const today = new Date();
  const parts: string[] = [];

  for (let i = 0; i < config.recentDays; i++) {
    const d = new Date(today);
    d.setDate(d.getDate() - i);
    const dateStr = d.toISOString().slice(0, 10);
    const filePath = dailyLogPath(chatFolder, dateStr);
    if (fs.existsSync(filePath)) {
      const content = fs.readFileSync(filePath, 'utf-8').trim();
      if (content) {
        parts.push(`### ${dateStr}\n${content}`);
      }
    }
  }

  if (parts.length === 0) return '';
  return `# Recent Memory\n${parts.join('\n\n')}`;
}

/**
 * 장기 기억(MEMORY.md)을 로드한다.
 */
export function loadLongTermMemory(chatFolder: string, config: MemoryConfig): string {
  const filePath = longTermPath(chatFolder);
  if (!fs.existsSync(filePath)) return '';
  const content = fs.readFileSync(filePath, 'utf-8').trim();
  return truncateToKB(content, config.maxLongTermKB);
}

/**
 * 장기 기억(MEMORY.md)을 저장한다.
 */
export function saveLongTermMemory(chatFolder: string, content: string, config: MemoryConfig): void {
  ensureMemoryDir(chatFolder);
  const truncated = truncateToKB(content, config.maxLongTermKB);
  fs.writeFileSync(longTermPath(chatFolder), truncated, 'utf-8');
  logger.info({ chatFolder }, '장기 기억 저장 완료');
}

/**
 * 메모리 키워드로 일일 로그를 검색한다.
 * 최근 30일 이내 로그에서 키워드가 포함된 엔트리를 반환.
 */
export function recallMemory(chatFolder: string, keyword: string): string {
  const dir = memoryDir(chatFolder);
  if (!fs.existsSync(dir)) return '관련 기억을 찾을 수 없습니다.';

  const today = new Date();
  const matches: string[] = [];
  const lowerKeyword = keyword.toLowerCase();

  for (let i = 0; i < 30; i++) {
    const d = new Date(today);
    d.setDate(d.getDate() - i);
    const dateStr = d.toISOString().slice(0, 10);
    const filePath = dailyLogPath(chatFolder, dateStr);
    if (fs.existsSync(filePath)) {
      const content = fs.readFileSync(filePath, 'utf-8');
      if (content.toLowerCase().includes(lowerKeyword)) {
        matches.push(`[${dateStr}] ${content.trim()}`);
      }
    }
    if (matches.length >= 5) break; // 최대 5개 결과
  }

  // 장기 기억도 검색
  const longTerm = longTermPath(chatFolder);
  if (fs.existsSync(longTerm)) {
    const ltContent = fs.readFileSync(longTerm, 'utf-8');
    if (ltContent.toLowerCase().includes(lowerKeyword)) {
      matches.unshift(`[장기 기억]\n${ltContent.trim()}`);
    }
  }

  return matches.length > 0 ? matches.join('\n\n---\n\n') : '관련 기억을 찾을 수 없습니다.';
}
