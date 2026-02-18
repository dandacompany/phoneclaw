---
name: phoneclaw-production
description: "EP11 - PhoneClaw Production Deployment (proot-distro, PM2, Log Management)"
---

> **Note:** This is an educational guide for understanding and customizing the production deployment module.
> The core code is already included in the project. Run this skill only if you want to
> learn how this component works or customize its behavior.

# EP11: Production Deployment (phoneclaw-production)

## Overview

Configuration for deploying PhoneClaw to production on an Android proot-distro Ubuntu environment. Uses the PM2 process manager to ensure automatic restarts, log management, and crash recovery.

> **proot-distro constraints**: Docker and systemd are unavailable. Processes are managed with PM2 + shell scripts.

## Dependencies

- **EP01~EP10 must be completed**: All core features must be implemented and in a buildable state.
- `npm run build` must generate compiled files in the `dist/` directory.
- Node.js >= 20 and PM2 must be globally installed (`npm install -g pm2`).
- Required environment variables must be set in the `.env` file.

## Step-by-Step Instructions

### Step 1: Create PM2 Configuration File

Create an `ecosystem.config.cjs` file in the project root:

```javascript
// ecosystem.config.cjs
// PM2 process manager configuration (optimized for proot-distro)
// Usage: pm2 start ecosystem.config.cjs

const path = require('path');

module.exports = {
  apps: [
    {
      name: 'phoneclaw',
      script: 'dist/index.js',
      cwd: __dirname,

      // Node.js settings
      node_args: '--enable-source-maps',
      interpreter: 'node',

      // Environment variables (loaded from .env file)
      env_file: '.env',

      // Restart policy
      autorestart: true,
      max_restarts: 10,
      min_uptime: '10s',
      restart_delay: 5000,

      // Exponential backoff on crash
      exp_backoff_restart_delay: 1000,

      // Memory limit (proot environment: shares RAM with Android, conservative setting)
      max_memory_restart: '256M',

      // Log settings
      log_date_format: 'YYYY-MM-DD HH:mm:ss.SSS',
      error_file: 'logs/phoneclaw-error.log',
      out_file: 'logs/phoneclaw-out.log',
      merge_logs: true,

      // Disable file watching (inotify is unstable in proot)
      watch: false,

      // Single instance (prevents Telegram polling conflicts)
      instances: 1,

      // Graceful shutdown
      kill_timeout: 10000,
      listen_timeout: 5000,
      shutdown_with_message: true,
    },
  ],
};
```

### Step 2: Create Start/Stop Shell Scripts

In proot-distro, shell scripts are used instead of systemd for process management.

Create `scripts/start.sh` in the project root:

```bash
#!/bin/bash
# scripts/start.sh - PhoneClaw start script

set -e

PROJECT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
cd "$PROJECT_DIR"

# Create log directory
mkdir -p logs

# Check for .env file
if [ ! -f .env ]; then
  echo "❌ .env file not found. Run cp .env.example .env and configure the values."
  exit 1
fi

# Check if already running
if pm2 describe phoneclaw > /dev/null 2>&1; then
  echo "⚠️  PhoneClaw is already running. To restart: pm2 restart phoneclaw"
  pm2 status phoneclaw
  exit 0
fi

# Check build
if [ ! -d dist ]; then
  echo "🔨 Running build..."
  npm run build
fi

# Start with PM2
pm2 start ecosystem.config.cjs
echo "✅ PhoneClaw started successfully"
pm2 status phoneclaw
```

Create `scripts/stop.sh` in the project root:

```bash
#!/bin/bash
# scripts/stop.sh - PhoneClaw stop script

pm2 stop phoneclaw 2>/dev/null && echo "✅ PhoneClaw stopped" || echo "⚠️  PhoneClaw is not running"
```

Create `scripts/log-cleanup.sh` in the project root:

```bash
#!/bin/bash
# scripts/log-cleanup.sh - Clean up old logs (used instead of logrotate in proot)
# Run via cron or manually: bash scripts/log-cleanup.sh

PROJECT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
LOG_DIR="$PROJECT_DIR/logs"
KEEP_DAYS=7

if [ ! -d "$LOG_DIR" ]; then
  echo "Log directory not found"
  exit 0
fi

# Delete logs older than 7 days
find "$LOG_DIR" -name "*.log" -mtime +$KEEP_DAYS -delete 2>/dev/null

# Truncate logs exceeding 50MB
for logfile in "$LOG_DIR"/*.log; do
  [ -f "$logfile" ] || continue
  size=$(stat -f%z "$logfile" 2>/dev/null || stat -c%s "$logfile" 2>/dev/null || echo 0)
  if [ "$size" -gt 52428800 ]; then
    tail -n 1000 "$logfile" > "$logfile.tmp"
    mv "$logfile.tmp" "$logfile"
    echo "✂️  $(basename $logfile) truncated"
  fi
done

echo "🧹 Log cleanup complete"
```

Grant execution permissions to the scripts:

```bash
mkdir -p scripts
chmod +x scripts/start.sh scripts/stop.sh scripts/log-cleanup.sh
```

### Step 3: Configure PM2 Log Rotation

```bash
# Install PM2 log rotation module
pm2 install pm2-logrotate

# Conservative settings for proot environment
pm2 set pm2-logrotate:max_size 20M
pm2 set pm2-logrotate:retain 7
pm2 set pm2-logrotate:compress true
pm2 set pm2-logrotate:dateFormat YYYY-MM-DD
pm2 set pm2-logrotate:rotateInterval '0 0 * * *'
```

### Step 4: Create logs Directory and Verify .gitignore

```bash
mkdir -p logs
```

Verify the following entries are included in the project root `.gitignore`:
```
logs/
data/
chats/
.env
```

### Step 5: Auto-Restart Setup (Optional)

To automatically start PhoneClaw when Termux restarts, install the **Termux:Boot** app and create a boot script:

```bash
# Termux:Boot script (run in Termux environment)
mkdir -p ~/.termux/boot

cat > ~/.termux/boot/start-phoneclaw.sh << 'BOOT_EOF'
#!/data/data/com.termux/files/usr/bin/bash
# Start PM2 inside proot-distro
proot-distro login ubuntu -- bash -c "
  source ~/.nvm/nvm.sh
  cd ~/phoneclaw
  pm2 resurrect
"
BOOT_EOF

chmod +x ~/.termux/boot/start-phoneclaw.sh
```

> **Note**: You must run `pm2 save` first for `pm2 resurrect` to work.

## Deployment Steps

```bash
# 1. Log into proot Ubuntu
proot-distro login ubuntu

# 2. Build the project
cd ~/phoneclaw
npm ci
npm run build

# 3. Configure environment variables
cp .env.example .env
# Edit the .env file

# 4. Start with PM2
bash scripts/start.sh

# 5. Enable auto-start on server reboot
pm2 save
```

**PM2 Management Commands**:
```bash
pm2 status              # Check status
pm2 logs phoneclaw      # Real-time logs
pm2 restart phoneclaw   # Restart
pm2 stop phoneclaw      # Stop
pm2 delete phoneclaw    # Delete process
pm2 monit               # Monitoring dashboard
```

## Crash Recovery Verification

### 1. PM2 Crash Recovery Test

```bash
# Verify bot is running
pm2 status

# Force kill (crash simulation)
pm2 pid phoneclaw | xargs kill -9

# Verify auto-restart after 5 seconds
sleep 6 && pm2 status

# Check recovery message in logs
pm2 logs phoneclaw --lines 20 | grep "recovery"
```

### 2. Message Recovery Test

1. Send a message via Telegram while the bot is running
2. Force kill the bot immediately after sending the message (`kill -9`)
3. Verify that unprocessed messages are handled after the bot restarts

## Verification

1. Confirm configuration files exist:
```bash
ls -la ecosystem.config.cjs scripts/start.sh scripts/stop.sh scripts/log-cleanup.sh
```

2. Validate PM2 configuration syntax:
```bash
node -e "require('./ecosystem.config.cjs')" && echo "OK"
```

3. Verify TypeScript build:
```bash
npm run build
```

4. PM2 dry-run:
```bash
pm2 start ecosystem.config.cjs --no-daemon
# Stop with Ctrl+C
```
