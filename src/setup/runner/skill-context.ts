// 스킬 실행 시 SDK query()에 전달되는 프로젝트 컨텍스트
// CLAUDE.md와 독립적으로 운영 — 사용자 빌드 환경에 CLAUDE.md가 없어도 동작

export const SKILL_SYSTEM_CONTEXT = `
# PhoneClaw - 프로젝트 컨텍스트

## 대상 환경
- Android ARM64 + Termux + proot-distro Ubuntu
- Docker 불가, systemd 불가 (proot 제약)
- PM2로 프로세스 관리

## 기술 스택
- 런타임: Node.js 20+, TypeScript (ESM, "type": "module")
- AI: @anthropic-ai/claude-code (Agent SDK)
- 메시징: grammy (Telegram Bot API)
- DB: better-sqlite3 (SQLite, WAL mode)
- MCP: @modelcontextprotocol/sdk
- 스케줄러: cron-parser
- 로깅: pino + pino-pretty

## 코드 컨벤션
- 식별자(변수, 함수, 클래스): 영어
- 주석, 로그 메시지: 한국어
- 파일 확장자: .ts, import 시 .js (ESM)
- 들여쓰기: 2칸 스페이스
- 세미콜론 사용
- 작은따옴표 기본

## 디렉토리 구조
- src/ - 소스 코드
- data/ - 런타임 데이터 (DB, 세션) — gitignored
- chats/ - 채팅별 설정 (CLAUDE.md, 로그) — gitignored
- scripts/ - PM2 시작/종료/로그 정리 스크립트

## 주의사항
- proot-distro 환경에서 Docker/systemd는 사용 불가. PM2로 대체.
- better-sqlite3는 C++ 네이티브 모듈로 ARM64에서 소스 빌드 필요.
- inotify가 불안정하므로 파일 감시 시 polling 사용.
`.trim();
