// Project context passed to SDK query() during skill execution
// Operates independently from CLAUDE.md — works even without CLAUDE.md in user's build environment

export const SKILL_SYSTEM_CONTEXT = `
# PhoneClaw - Project Context

## Target Environment
- Android ARM64 + Termux + proot-distro Ubuntu
- No Docker, no systemd (proot limitations)
- Process management via PM2

## Tech Stack
- Runtime: Node.js 20+, TypeScript (ESM, "type": "module")
- AI: @anthropic-ai/claude-code (Agent SDK)
- Messaging: grammy (Telegram Bot API)
- DB: better-sqlite3 (SQLite, WAL mode)
- MCP: @modelcontextprotocol/sdk
- Scheduler: cron-parser
- Logging: pino + pino-pretty

## Code Conventions
- Identifiers (variables, functions, classes): English
- Comments, log messages: English
- File extension: .ts, use .js in imports (ESM)
- Indentation: 2 spaces
- Semicolons required
- Single quotes preferred

## Directory Structure
- src/ - Source code
- data/ - Runtime data (DB, sessions) — gitignored
- chats/ - Per-chat config (CLAUDE.md, logs) — gitignored
- scripts/ - PM2 start/stop/log cleanup scripts

## Important Notes
- Docker/systemd are unavailable in proot-distro. Use PM2 instead.
- better-sqlite3 is a C++ native module that requires source compilation on ARM64.
- inotify may be unstable; use polling for file watching.
`.trim();
