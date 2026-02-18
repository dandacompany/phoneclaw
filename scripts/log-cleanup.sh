#!/bin/bash
# PhoneClaw 로그 및 메모리 정리 스크립트
# crontab -e 에서 매일 실행 추천:
# 0 3 * * * /path/to/phoneclaw/scripts/log-cleanup.sh

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"
CHATS_DIR="$PROJECT_DIR/chats"
LOG_RETENTION_DAYS=7
MEMORY_RETENTION_DAYS=30

echo "[$(date)] PhoneClaw 정리 시작"

# 1. 채팅 로그 정리 (7일 초과)
if [ -d "$CHATS_DIR" ]; then
  find "$CHATS_DIR" -path "*/logs/*.log" -mtime +"$LOG_RETENTION_DAYS" -delete 2>/dev/null
  deleted_logs=$?
  echo "  로그 정리 완료 (${LOG_RETENTION_DAYS}일 초과 삭제)"
fi

# 2. 메모리 일지 정리 (30일 초과)
if [ -d "$CHATS_DIR" ]; then
  find "$CHATS_DIR" -path "*/memory/20*.md" -mtime +"$MEMORY_RETENTION_DAYS" -delete 2>/dev/null
  echo "  메모리 일지 정리 완료 (${MEMORY_RETENTION_DAYS}일 초과 삭제)"
fi

# 3. 빈 디렉토리 정리
if [ -d "$CHATS_DIR" ]; then
  find "$CHATS_DIR" -type d -empty -delete 2>/dev/null
fi

echo "[$(date)] PhoneClaw 정리 완료"
