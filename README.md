# PhoneClaw

A Telegram AI assistant bot that runs on your Android phone.

Uses the Claude Code SDK in a Termux + proot-distro Ubuntu environment to respond to Telegram messages with AI. Mention `@PhoneClaw` to invoke, with per-chat session memory, scheduled tasks, and MCP tools.

## Quick Start

```bash
npx create-phoneclaw my-bot
cd my-bot
npm install
npm run setup     # Interactive wizard: language, credentials, settings
npm run dev       # Start the bot
```

## Why PhoneClaw?

[OpenClaw](https://github.com/openclaw/openclaw) is an open-source personal AI assistant that runs locally on your machine, supporting multiple AI providers (Claude, GPT, local models) with 50+ service integrations. While powerful, it comes with a massive codebase and inherent security risks from its broad system access — browser automation, file I/O, command execution — that make casual deployment challenging.

[NanoClaw](https://github.com/gavrielc/nanoclaw) took a different approach — sandboxing the agent in Apple containers with a lightweight, Claude Code skill-based architecture. The entire core fits in ~500 lines of code you can read in minutes. This made it far simpler to understand, secure, and extend, but it remained tied to macOS.

**PhoneClaw** carries this philosophy further: take the lightweight, skill-driven architecture and adapt it to run on **Android smartphones** via Termux + proot-distro. No server, no Docker, no macOS required — just your phone, a Telegram bot token, and an Anthropic API key. The goal is to make it as easy as possible for anyone to set up a personal AI assistant bot that runs right in their pocket.

## Architecture

```
Telegram message (grammy)
    → SQLite storage (better-sqlite3)
    → Per-chat queue (MessageQueue)
    → LocalAgentRunner (claude-code SDK query())
    → MCP tools (send_message, schedule_task, etc.)
    → Telegram response
```

## Target Environment

| Item | Spec |
|------|------|
| Platform | Android (ARM64) |
| Terminal | Termux |
| OS | proot-distro Ubuntu |
| Constraints | No Docker, no systemd, virtual root only |

> **proot-distro** is a ptrace()-based userspace emulation. It lacks kernel namespace/cgroups (no Docker) and PID 1 init (no systemd). PM2 (Node.js-based) is used for process management.

## Requirements

- **Android phone** (ARM64, 6GB+ RAM recommended)
- **Termux** + **proot-distro** (Ubuntu)
- **Telegram Bot Token** — from [@BotFather](https://t.me/BotFather)
- **Anthropic API Key** — from [Anthropic Console](https://console.anthropic.com/)

## Installation

### 1. Prepare Termux Environment

```bash
# Run in Termux
pkg update && pkg upgrade
pkg install proot-distro

# Install Ubuntu
proot-distro install ubuntu
proot-distro login ubuntu
```

### 2. Configure proot Ubuntu

```bash
# System packages
apt update && apt upgrade -y
apt install -y curl git build-essential python3 make g++

# Install Node.js 20+ (via nvm)
curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.40.1/install.sh | bash
source ~/.bashrc
nvm install 20
nvm use 20

# Install PM2
npm install -g pm2
```

### 3. Install Project

```bash
npx create-phoneclaw ~/phoneclaw
cd ~/phoneclaw
npm install
```

> `better-sqlite3` is a C++ native addon. It compiles from source on ARM64, so `build-essential`, `python3`, `make`, and `g++` must be installed.

## Configuration

### Option 1: TUI Setup Wizard (Recommended)

```bash
npm run setup
```

The interactive wizard guides you through language selection → credential setup → API verification → environment configuration → `.env` file generation.

### Option 2: Manual Setup

```bash
cp .env.example .env
```

Edit the `.env` file with required values:

```bash
# === Required ===
TELEGRAM_BOT_TOKEN=123456:ABC-DEF...    # From @BotFather
ANTHROPIC_API_KEY=sk-ant-...             # From Anthropic Console

# === Optional ===
BOT_NAME=PhoneClaw                       # Bot display name (trigger pattern)
ANTHROPIC_MODEL=claude-sonnet-4-20250514 # Claude model
ADMIN_USER_IDS=123456789                 # Admin Telegram user IDs (comma-separated)
LOG_LEVEL=info                           # trace|debug|info|warn|error|fatal
AGENT_TIMEOUT=300000                     # Agent execution timeout (ms, default 5min)
MAX_CONCURRENT_AGENTS=1                  # Concurrent agents (proot: 1 recommended)
TZ=Asia/Seoul                            # Scheduler timezone
```

## Running

### Development Mode

```bash
npm run dev
```

### Production (PM2)

```bash
npm run build
bash scripts/start.sh
```

**PM2 management commands:**

```bash
pm2 status              # Check status
pm2 logs phoneclaw      # Live logs
pm2 restart phoneclaw   # Restart
pm2 stop phoneclaw      # Stop
pm2 monit               # Monitoring
```

### Auto-Start (Termux:Boot)

To automatically start the bot when Termux restarts:

```bash
# In Termux (outside proot)
mkdir -p ~/.termux/boot
cat > ~/.termux/boot/start-phoneclaw.sh << 'EOF'
#!/data/data/com.termux/files/usr/bin/bash
proot-distro login ubuntu -- bash -c "
  source ~/.nvm/nvm.sh
  cd ~/phoneclaw
  pm2 resurrect
"
EOF
chmod +x ~/.termux/boot/start-phoneclaw.sh

# Inside proot, save PM2 processes
pm2 save
```

## Telegram Commands

All users:

| Command | Description |
|---------|-------------|
| `/chatid` | Show current chat ID |
| `/ping` | Check bot responsiveness |

Admin only (users registered in `ADMIN_USER_IDS`):

| Command | Description |
|---------|-------------|
| `/register` | Register current chat (group: trigger required, DM: respond to all) |
| `/unregister` | Unregister chat |
| `/status` | Bot status |
| `/chats` | List registered chats |
| `/tasks` | List scheduled tasks |

## Educational Skills

This project includes 11 Claude Code skills organized as episodes. Each skill serves as an educational guide for understanding and customizing its component. The core bot is ready to use after `npm run setup`.

```bash
# Run skills in Claude Code to learn about or customize each component
/phoneclaw-scaffold          # EP01: Project scaffolding
/phoneclaw-telegram          # EP02: Telegram bot connection
/phoneclaw-database          # EP03: SQLite database
/phoneclaw-agent-local       # EP04: Claude Agent (Local)
/phoneclaw-message-loop      # EP05: Main message loop
/phoneclaw-mcp-tools         # EP06: MCP tools
/phoneclaw-session-memory    # EP07: Session memory
/phoneclaw-scheduler         # EP08: Scheduled tasks
/phoneclaw-multi-chat        # EP09: Multi-chat support
/phoneclaw-admin-commands    # EP10: Admin commands
/phoneclaw-production        # EP11: Production deployment
```

### Dependency Graph

```
EP01 ──┬── EP02 ──┬── EP05 ──┬── EP06 ── EP08
       │          │          │
       ├── EP03 ──┘     EP07 ┴── EP09 ── EP10
       │                  │
       └── EP04 ─────────┘

All ────── EP11
```

## Project Structure

```
phoneclaw/
├── src/
│   ├── index.ts             # Main entrypoint
│   ├── config.ts            # Environment variable config
│   ├── types.ts             # Type definitions
│   ├── db.ts                # SQLite database
│   ├── logger.ts            # pino logging
│   ├── router.ts            # Message formatting
│   ├── queue.ts             # Per-chat message queue
│   ├── scheduler.ts         # Scheduled task scheduler
│   ├── setup/               # TUI setup wizard
│   ├── channel/
│   │   └── telegram.ts      # Telegram channel (grammy)
│   ├── agent/
│   │   ├── types.ts         # AgentRunner interface
│   │   └── local-runner.ts  # Claude Code SDK agent
│   └── mcp/
│       └── tools.ts         # MCP tool server
├── scripts/
│   ├── start.sh             # PM2 start script
│   ├── stop.sh              # Stop script
│   └── log-cleanup.sh       # Log cleanup
├── chats/                   # Per-chat config (runtime)
│   └── {chat-folder}/
│       ├── CLAUDE.md        # Per-chat AI personality
│       └── logs/
├── data/                    # Runtime data (runtime)
│   ├── phoneclaw.db         # SQLite database
│   └── sessions/            # Agent sessions
├── .claude/skills/          # 11 episode skills
├── .env.example
├── package.json
└── tsconfig.json
```

## Per-Chat Customization

Each registered chat can have its AI personality configured via `chats/{folder}/CLAUDE.md`:

```markdown
# Study Group Assistant

This chat is a data science study group.
- Answer questions with code examples
- Respond in Korean
- Maintain a friendly tone
```

## proot-distro Notes

| Item | Description |
|------|-------------|
| Performance | Slower than native due to ptrace() overhead. Minimal impact since it's API-call based |
| Memory | Shared with Android RAM. `MAX_CONCURRENT_AGENTS=1` recommended |
| File watching | inotify may be unstable. Polling mode used by default |
| Network | Generally works fine. Telegram polling auto-reconnects on Wi-Fi drops |
| Background | Android battery optimization may kill Termux. Pin Termux notification recommended |

## Tech Stack

| Component | Technology |
|-----------|------------|
| Runtime | Node.js 20+ (ESM) |
| Language | TypeScript 5.7 |
| AI | `@anthropic-ai/claude-code` SDK |
| Messaging | grammy (Telegram Bot API) |
| Database | better-sqlite3 (WAL mode) |
| MCP | `@modelcontextprotocol/sdk` |
| Scheduler | cron-parser |
| Logging | pino + pino-pretty |
| Process Mgmt | PM2 |

## Acknowledgements

This project was inspired by [NanoClaw](https://github.com/gavrielc/nanoclaw) by [@gavrielc](https://github.com/gavrielc). NanoClaw's clean architecture for a personal Claude assistant — particularly its lightweight core and skill-based educational approach — served as a valuable reference during development.

## Author

**Dante Labs**
AI Automation & Agentic Workflow

- Homepage: [dante-labs.com](https://dante-labs.com)
- YouTube: [@dante-labs](https://youtube.com/@dante-labs)
- Discord: [Dante Labs Community](https://discord.com/invite/rXyy5e9ujs)
- KakaoTalk: [Agentic AI Community](https://open.kakao.com/o/gURfTmqh)
- Email: [datapod.k@gmail.com](mailto:datapod.k@gmail.com)

[![Buy Me A Coffee](https://img.shields.io/badge/Buy%20Me%20A%20Coffee-Support-yellow?style=for-the-badge&logo=buy-me-a-coffee)](https://buymeacoffee.com/dante.labs)

## License

MIT
