---
name: phoneclaw-production
description: "EP11 - PhoneClaw 프로덕션 배포 (proot-distro, PM2, 로그 관리)"
---

# EP11: 프로덕션 배포 (phoneclaw-production)

## 개요

PhoneClaw를 안드로이드 proot-distro Ubuntu 환경에 프로덕션 배포하기 위한 설정입니다. PM2 프로세스 매니저로 자동 재시작, 로그 관리, 크래시 복구를 보장합니다.

> **proot-distro 제약**: Docker, systemd 사용 불가. PM2 + 쉘 스크립트로 프로세스를 관리합니다.

## 의존성

- **EP01~EP10 완료 필수**: 모든 핵심 기능이 구현되어 빌드 가능한 상태여야 합니다.
- `npm run build`로 `dist/` 디렉토리에 컴파일된 파일이 생성되어야 합니다.
- Node.js >= 20, PM2가 글로벌 설치되어 있어야 합니다 (`npm install -g pm2`).
- `.env` 파일에 필수 환경변수가 설정되어 있어야 합니다.

## 단계별 지시

### 1단계: PM2 설정 파일 생성

프로젝트 루트에 `ecosystem.config.cjs` 파일을 생성합니다:

```javascript
// ecosystem.config.cjs
// PM2 프로세스 매니저 설정 (proot-distro 최적화)
// 사용법: pm2 start ecosystem.config.cjs

const path = require('path');

module.exports = {
  apps: [
    {
      name: 'phoneclaw',
      script: 'dist/index.js',
      cwd: __dirname,

      // Node.js 설정
      node_args: '--enable-source-maps',
      interpreter: 'node',

      // 환경변수 (.env 파일에서 로드)
      env_file: '.env',

      // 재시작 정책
      autorestart: true,
      max_restarts: 10,
      min_uptime: '10s',
      restart_delay: 5000,

      // 크래시 시 지수 백오프
      exp_backoff_restart_delay: 1000,

      // 메모리 제한 (proot 환경: Android와 RAM 공유, 보수적 설정)
      max_memory_restart: '256M',

      // 로그 설정
      log_date_format: 'YYYY-MM-DD HH:mm:ss.SSS',
      error_file: 'logs/phoneclaw-error.log',
      out_file: 'logs/phoneclaw-out.log',
      merge_logs: true,

      // 파일 감시 비활성화 (proot에서 inotify 불안정)
      watch: false,

      // 단일 인스턴스 (Telegram 폴링 충돌 방지)
      instances: 1,

      // Graceful shutdown
      kill_timeout: 10000,
      listen_timeout: 5000,
      shutdown_with_message: true,
    },
  ],
};
```

### 2단계: 시작/종료 쉘 스크립트 생성

proot-distro에서는 systemd 대신 쉘 스크립트로 프로세스를 관리합니다.

프로젝트 루트에 `scripts/start.sh` 파일을 생성합니다:

```bash
#!/bin/bash
# scripts/start.sh - PhoneClaw 시작 스크립트

set -e

PROJECT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
cd "$PROJECT_DIR"

# 로그 디렉토리 생성
mkdir -p logs

# .env 파일 확인
if [ ! -f .env ]; then
  echo "❌ .env 파일이 없습니다. cp .env.example .env 후 값을 설정하세요."
  exit 1
fi

# 이미 실행 중인지 확인
if pm2 describe phoneclaw > /dev/null 2>&1; then
  echo "⚠️  PhoneClaw가 이미 실행 중입니다. 재시작하려면: pm2 restart phoneclaw"
  pm2 status phoneclaw
  exit 0
fi

# 빌드 확인
if [ ! -d dist ]; then
  echo "🔨 빌드 실행 중..."
  npm run build
fi

# PM2로 시작
pm2 start ecosystem.config.cjs
echo "✅ PhoneClaw 시작 완료"
pm2 status phoneclaw
```

프로젝트 루트에 `scripts/stop.sh` 파일을 생성합니다:

```bash
#!/bin/bash
# scripts/stop.sh - PhoneClaw 종료 스크립트

pm2 stop phoneclaw 2>/dev/null && echo "✅ PhoneClaw 종료" || echo "⚠️  PhoneClaw가 실행 중이 아닙니다"
```

프로젝트 루트에 `scripts/log-cleanup.sh` 파일을 생성합니다:

```bash
#!/bin/bash
# scripts/log-cleanup.sh - 오래된 로그 정리 (proot에 logrotate 대신 사용)
# cron 또는 수동 실행: bash scripts/log-cleanup.sh

PROJECT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
LOG_DIR="$PROJECT_DIR/logs"
KEEP_DAYS=7

if [ ! -d "$LOG_DIR" ]; then
  echo "로그 디렉토리 없음"
  exit 0
fi

# 7일 이상 된 로그 삭제
find "$LOG_DIR" -name "*.log" -mtime +$KEEP_DAYS -delete 2>/dev/null

# 50MB 초과 로그 트렁케이트
for logfile in "$LOG_DIR"/*.log; do
  [ -f "$logfile" ] || continue
  size=$(stat -f%z "$logfile" 2>/dev/null || stat -c%s "$logfile" 2>/dev/null || echo 0)
  if [ "$size" -gt 52428800 ]; then
    tail -n 1000 "$logfile" > "$logfile.tmp"
    mv "$logfile.tmp" "$logfile"
    echo "✂️  $(basename $logfile) 트렁케이트 완료"
  fi
done

echo "🧹 로그 정리 완료"
```

스크립트에 실행 권한을 부여합니다:

```bash
mkdir -p scripts
chmod +x scripts/start.sh scripts/stop.sh scripts/log-cleanup.sh
```

### 3단계: PM2 로그 로테이션 설정

```bash
# PM2 로그 로테이션 모듈 설치
pm2 install pm2-logrotate

# proot 환경에 맞춘 보수적 설정
pm2 set pm2-logrotate:max_size 20M
pm2 set pm2-logrotate:retain 7
pm2 set pm2-logrotate:compress true
pm2 set pm2-logrotate:dateFormat YYYY-MM-DD
pm2 set pm2-logrotate:rotateInterval '0 0 * * *'
```

### 4단계: logs 디렉토리 생성 및 .gitignore 확인

```bash
mkdir -p logs
```

프로젝트 루트 `.gitignore`에 다음이 포함되어 있는지 확인합니다:
```
logs/
data/
chats/
.env
```

### 5단계: 자동 재시작 설정 (선택)

Termux가 재시작되었을 때 자동으로 PhoneClaw를 시작하려면 **Termux:Boot** 앱을 설치하고 부팅 스크립트를 작성합니다:

```bash
# Termux:Boot 스크립트 (Termux 환경에서 실행)
mkdir -p ~/.termux/boot

cat > ~/.termux/boot/start-phoneclaw.sh << 'BOOT_EOF'
#!/data/data/com.termux/files/usr/bin/bash
# proot-distro 안에서 PM2 시작
proot-distro login ubuntu -- bash -c "
  source ~/.nvm/nvm.sh
  cd ~/phoneclaw
  pm2 resurrect
"
BOOT_EOF

chmod +x ~/.termux/boot/start-phoneclaw.sh
```

> **참고**: `pm2 save`를 먼저 실행해야 `pm2 resurrect`가 동작합니다.

## 배포 방법

```bash
# 1. proot Ubuntu 접속
proot-distro login ubuntu

# 2. 프로젝트 빌드
cd ~/phoneclaw
npm ci
npm run build

# 3. 환경변수 설정
cp .env.example .env
# .env 파일 편집

# 4. PM2로 시작
bash scripts/start.sh

# 5. 서버 재부팅 시 자동 시작
pm2 save
```

**PM2 관리 명령어**:
```bash
pm2 status              # 상태 확인
pm2 logs phoneclaw      # 실시간 로그
pm2 restart phoneclaw   # 재시작
pm2 stop phoneclaw      # 중지
pm2 delete phoneclaw    # 프로세스 삭제
pm2 monit               # 모니터링 대시보드
```

## 크래시 복구 검증

### 1. PM2 크래시 복구 테스트

```bash
# 봇 실행 확인
pm2 status

# 강제 종료 (크래시 시뮬레이션)
pm2 pid phoneclaw | xargs kill -9

# 5초 후 자동 재시작 확인
sleep 6 && pm2 status

# 로그에서 복구 메시지 확인
pm2 logs phoneclaw --lines 20 | grep "복구"
```

### 2. 메시지 복구 테스트

1. 봇이 실행 중일 때 Telegram에서 메시지 전송
2. 메시지 전송 직후 봇 강제 종료 (`kill -9`)
3. 봇 재시작 후 미처리 메시지가 처리되는지 확인

## 검증

1. 설정 파일 존재 확인:
```bash
ls -la ecosystem.config.cjs scripts/start.sh scripts/stop.sh scripts/log-cleanup.sh
```

2. PM2 설정 문법 검증:
```bash
node -e "require('./ecosystem.config.cjs')" && echo "OK"
```

3. TypeScript 빌드 확인:
```bash
npm run build
```

4. PM2 dry-run:
```bash
pm2 start ecosystem.config.cjs --no-daemon
# Ctrl+C로 종료
```
