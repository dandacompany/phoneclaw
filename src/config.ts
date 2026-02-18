import path from 'path';

// === 봇 기본 설정 ===
export const BOT_NAME = process.env.BOT_NAME || 'PhoneClaw';
// proot-distro 환경: local 모드만 지원 (Docker 불가)

// === Telegram ===
export const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN || '';

// === Anthropic ===
export const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY || '';
export const ANTHROPIC_MODEL = process.env.ANTHROPIC_MODEL || 'claude-sonnet-4-20250514';
export const ANTHROPIC_BASE_URL = process.env.ANTHROPIC_BASE_URL || '';

// === 관리자 ===
export const ADMIN_USER_IDS = (process.env.ADMIN_USER_IDS || '')
  .split(',')
  .map((id) => id.trim())
  .filter(Boolean);

// === 경로 ===
const PROJECT_ROOT = process.cwd();
export const DATA_DIR = path.resolve(PROJECT_ROOT, 'data');
export const CHATS_DIR = path.resolve(PROJECT_ROOT, 'chats');
export const DB_PATH = path.resolve(DATA_DIR, 'phoneclaw.db');
export const SESSIONS_DIR = path.resolve(DATA_DIR, 'sessions');
export const IPC_DIR = path.resolve(DATA_DIR, 'ipc');

// === Agent 실행 ===
export const AGENT_TIMEOUT = parseInt(process.env.AGENT_TIMEOUT || '300000', 10);
export const MAX_CONCURRENT_AGENTS = Math.max(
  1,
  parseInt(process.env.MAX_CONCURRENT_AGENTS || '1', 10) || 1,
);

// === 폴링/타이밍 ===
export const POLL_INTERVAL = 2000;
export const IPC_POLL_INTERVAL = 1000;
export const SCHEDULER_POLL_INTERVAL = 60000;

// === 로깅 ===
export const LOG_LEVEL = process.env.LOG_LEVEL || 'info';

// === 타임존 ===
export const TIMEZONE = process.env.TZ || Intl.DateTimeFormat().resolvedOptions().timeZone;

// === 트리거 패턴 ===
function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
export const TRIGGER_PATTERN = new RegExp(`^@${escapeRegex(BOT_NAME)}\\b`, 'i');

