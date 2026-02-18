---
name: phoneclaw-scaffold
description: "PhoneClaw EP01 - 프로젝트 기반 구축. TypeScript + ESM 프로젝트 초기 설정, 환경 변수, 로거, 타입 정의를 자동 생성합니다."
---

# EP01: PhoneClaw 프로젝트 기반 구축

## 개요

Telegram AI 비서 봇 "PhoneClaw" 프로젝트의 기반을 구축합니다.
Node.js 20+ / TypeScript (ESM) 환경에서 다음을 설정합니다:

- `package.json` - 프로젝트 의존성 및 스크립트
- `tsconfig.json` - TypeScript 컴파일러 설정
- `.env.example` - 환경 변수 템플릿
- `.gitignore` - Git 제외 파일
- `CLAUDE.md` - 프로젝트 컨벤션 가이드
- `src/config.ts` - 환경 변수 로드 및 상수 정의
- `src/logger.ts` - pino 기반 로거
- `src/types.ts` - 공유 인터페이스/타입 정의

## 의존성

- 이전 에피소드 없음 (첫 번째 에피소드)
- Node.js 20 이상 필요

## 단계별 지시

### 1단계: 프로젝트 디렉토리 생성

프로젝트 루트 디렉토리를 생성합니다. 이미 존재하면 건너뜁니다.

```bash
mkdir -p phoneclaw/src
cd phoneclaw
```

### 2단계: package.json 생성

다음 내용으로 `package.json`을 작성합니다:

```json
{
  "name": "phoneclaw",
  "version": "0.1.0",
  "description": "Telegram AI 비서 봇 - Claude Code Skills 기반",
  "type": "module",
  "main": "dist/index.js",
  "scripts": {
    "build": "tsc",
    "start": "node dist/index.js",
    "dev": "tsx src/index.ts",
    "typecheck": "tsc --noEmit",
    "test": "vitest run",
    "test:watch": "vitest"
  },
  "dependencies": {
    "@anthropic-ai/claude-code": "^1.0.21",
    "@modelcontextprotocol/sdk": "^1.12.1",
    "better-sqlite3": "^11.8.1",
    "cron-parser": "^5.5.0",
    "grammy": "^1.30.0",
    "pino": "^9.6.0",
    "pino-pretty": "^13.0.0",
    "zod": "^3.24.0"
  },
  "devDependencies": {
    "@types/better-sqlite3": "^7.6.8",
    "@types/node": "^22.10.7",
    "tsx": "^4.0.0",
    "typescript": "^5.7.0",
    "vitest": "^3.0.0"
  },
  "engines": {
    "node": ">=20"
  }
}
```

### 3단계: tsconfig.json 생성

다음 내용으로 `tsconfig.json`을 작성합니다:

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "Node16",
    "moduleResolution": "Node16",
    "outDir": "dist",
    "rootDir": "src",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "forceConsistentCasingInFileNames": true,
    "resolveJsonModule": true,
    "declaration": true,
    "declarationMap": true,
    "sourceMap": true
  },
  "include": ["src/**/*"],
  "exclude": ["node_modules", "dist"]
}
```

### 4단계: .env.example 생성

다음 내용으로 `.env.example`을 작성합니다:

```
# === 필수 설정 ===
TELEGRAM_BOT_TOKEN=          # @BotFather에서 발급
ANTHROPIC_API_KEY=            # Anthropic 콘솔에서 발급

# === 선택 설정 ===
BOT_NAME=PhoneClaw            # 봇 표시 이름 (트리거 패턴에 사용)
ANTHROPIC_MODEL=claude-sonnet-4-20250514
ANTHROPIC_BASE_URL=           # 대체 API 호환 엔드포인트 (비워두면 공식 API)
ADMIN_USER_IDS=               # 쉼표 구분 Telegram user ID (관리자 명령어용)
LOG_LEVEL=info                # trace, debug, info, warn, error, fatal
AGENT_TIMEOUT=300000          # Agent 실행 제한 시간 (ms, 기본 5분)
MAX_CONCURRENT_AGENTS=3       # 동시 실행 Agent 수 제한
TZ=Asia/Seoul                 # 스케줄러 타임존
```

### 5단계: .gitignore 생성

다음 내용으로 `.gitignore`를 작성합니다:

```
node_modules/
dist/
data/
chats/
*.db
*.db-journal
.env
*.log
.DS_Store
```

### 6단계: CLAUDE.md 생성

다음 내용으로 `CLAUDE.md`를 작성합니다:

```markdown
# PhoneClaw - Telegram AI 비서 봇

## 프로젝트 개요
Claude Agent SDK + grammy 기반 Telegram AI 비서 봇.
YouTube 교육 시리즈로 제작되며, 각 에피소드가 하나의 Claude Code 스킬에 대응.

## 기술 스택
- **런타임**: Node.js 20+, TypeScript (ESM)
- **AI**: @anthropic-ai/claude-code (Agent SDK)
- **메시징**: grammy (Telegram Bot API)
- **DB**: better-sqlite3 (SQLite)
- **MCP**: @modelcontextprotocol/sdk
- **로깅**: pino + pino-pretty

## 코드 컨벤션
- 식별자(변수, 함수, 클래스): 영어
- 주석, 로그 메시지: 한국어
- 파일 확장자: `.ts`, import 시 `.js` (ESM)
- 들여쓰기: 2칸 스페이스
- 세미콜론 사용
- 작은따옴표 기본

## 디렉토리 구조
- `src/` - 소스 코드
- `data/` - 런타임 데이터 (DB, 세션, IPC) — gitignored
- `chats/` - 채팅별 설정 (CLAUDE.md, 로그) — gitignored
- `ref/` - 참고 자료

## 주요 명령어
\`\`\`bash
npm run dev       # 개발 모드 실행
npm run build     # TypeScript 컴파일
npm start         # 프로덕션 실행
npm run typecheck # 타입 체크
npm test          # 테스트 실행
\`\`\`

## 환경 변수
`.env.example` 참조. `.env` 파일로 복사 후 값 설정.
```

### 7단계: src/config.ts 생성

다음 내용으로 `src/config.ts`를 작성합니다:

```typescript
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
  parseInt(process.env.MAX_CONCURRENT_AGENTS || '3', 10) || 3,
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

```

### 8단계: src/logger.ts 생성

다음 내용으로 `src/logger.ts`를 작성합니다:

```typescript
import pino from 'pino';
import { LOG_LEVEL } from './config.js';

export const logger = pino({
  level: LOG_LEVEL,
  transport: {
    target: 'pino-pretty',
    options: {
      colorize: true,
      translateTime: 'SYS:yyyy-mm-dd HH:MM:ss.l',
      ignore: 'pid,hostname',
    },
  },
});
```

### 9단계: src/types.ts 생성

다음 내용으로 `src/types.ts`를 작성합니다:

```typescript
// === Channel 추상화 ===

export interface Channel {
  name: string;
  connect(): Promise<void>;
  sendMessage(chatId: string, text: string): Promise<void>;
  setTyping?(chatId: string, isTyping: boolean): Promise<void>;
  isConnected(): boolean;
  disconnect(): Promise<void>;
}

export type OnInboundMessage = (chatId: string, message: NewMessage) => void;
export type OnChatMetadata = (chatId: string, timestamp: string, name?: string) => void;

// === 메시지 ===

export interface NewMessage {
  id: string;
  chatId: string;
  senderId: string;
  senderName: string;
  content: string;
  timestamp: string;
  isFromMe?: boolean;
}

// === 등록된 채팅 ===

export interface RegisteredChat {
  chatId: string;
  name: string;
  folder: string;
  requiresTrigger: boolean;
  addedAt: string;
}

// === Agent ===

export interface AgentInput {
  prompt: string;
  sessionId?: string;
  claudeMdPath?: string;
  timeout?: number;
}

export interface AgentOutput {
  result: string;
  sessionId: string;
  durationMs: number;
}

export type OnAgentOutput = (chunk: string) => void;

export interface AgentRunner {
  run(chat: RegisteredChat, input: AgentInput, onOutput?: OnAgentOutput): Promise<AgentOutput>;
  shutdown(): Promise<void>;
}

// === 스케줄링 ===

export interface ScheduledTask {
  id: string;
  chatFolder: string;
  chatId: string;
  prompt: string;
  scheduleType: 'cron' | 'interval' | 'once';
  scheduleValue: string;
  nextRun: string | null;
  lastRun: string | null;
  lastResult: string | null;
  status: 'active' | 'paused' | 'completed';
  createdAt: string;
}

export interface TaskRunLog {
  taskId: string;
  runAt: string;
  durationMs: number;
  status: 'success' | 'error';
  result: string | null;
  error: string | null;
}
```

### 10단계: 의존성 설치

```bash
npm install
```

### 11단계: 디렉토리 구조 확인

```bash
mkdir -p data chats
```

## 검증

모든 파일이 생성된 후 타입 체크를 실행하여 오류가 없는지 확인합니다:

```bash
npx tsc --noEmit
```

타입 체크가 통과하면 EP01이 완료된 것입니다.
다음 에피소드(EP02)에서 Telegram 봇을 연결합니다.
