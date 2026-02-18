import fs from 'fs';
import path from 'path';

import { CHATS_DIR } from '../config.js';
import { logger } from '../logger.js';
import { stripInternalTags } from '../router.js';
import type { HeartbeatOpts } from './types.js';

const HEARTBEAT_FILE = 'HEARTBEAT.md';
const HEARTBEAT_OK = 'HEARTBEAT_OK';

/**
 * HEARTBEAT.md 내용이 실질적으로 비어있는지 확인.
 * 주석과 빈 줄만 있으면 비어있는 것으로 간주.
 */
function isContentEmpty(content: string): boolean {
  const stripped = content
    .split('\n')
    .filter((line) => {
      const trimmed = line.trim();
      return trimmed.length > 0 && !trimmed.startsWith('#') && !trimmed.startsWith('<!--');
    })
    .join('')
    .trim();
  return stripped.length === 0;
}

/**
 * 현재 시각이 활성 시간 범위 내인지 확인.
 */
function isActiveHour(start: number, end: number): boolean {
  const hour = new Date().getHours();
  if (start <= end) {
    return hour >= start && hour < end;
  }
  // 야간 시간대 (예: 22~6시)
  return hour >= start || hour < end;
}

export class HeartbeatManager {
  private timer: ReturnType<typeof setInterval> | null = null;
  private opts: HeartbeatOpts;
  private running = false;

  constructor(opts: HeartbeatOpts) {
    this.opts = opts;
  }

  start(): void {
    if (this.timer) return;
    this.timer = setInterval(() => this.tick(), this.opts.intervalMs);
    logger.info(
      { intervalMs: this.opts.intervalMs, activeHours: `${this.opts.activeStart}-${this.opts.activeEnd}` },
      '하트비트 시작',
    );
  }

  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
    logger.info('하트비트 중지');
  }

  /**
   * 특정 채팅의 하트비트를 강제 실행 (웹훅에서 호출).
   */
  async triggerChat(chatFolder: string, chatId: string): Promise<void> {
    const chats = this.opts.getRegisteredChats();
    const chat = chats[chatId];
    if (!chat) return;
    await this.runHeartbeat(chat.folder, chatId);
  }

  private async tick(): Promise<void> {
    if (this.running) return; // 이전 tick이 진행 중이면 스킵
    if (!isActiveHour(this.opts.activeStart, this.opts.activeEnd)) {
      logger.debug('하트비트: 비활성 시간대, 스킵');
      return;
    }

    this.running = true;
    try {
      const chats = this.opts.getRegisteredChats();
      for (const [chatId, chat] of Object.entries(chats)) {
        await this.runHeartbeat(chat.folder, chatId);
      }
    } catch (err) {
      logger.error({ err }, '하트비트 루프 오류');
    } finally {
      this.running = false;
    }
  }

  private async runHeartbeat(chatFolder: string, chatId: string): Promise<void> {
    const filePath = path.join(CHATS_DIR, chatFolder, HEARTBEAT_FILE);
    if (!fs.existsSync(filePath)) return;

    const content = fs.readFileSync(filePath, 'utf-8');
    if (isContentEmpty(content)) {
      logger.debug({ chatFolder }, '하트비트: 빈 체크리스트, 스킵');
      return;
    }

    logger.info({ chatFolder }, '하트비트 실행');
    const chats = this.opts.getRegisteredChats();
    const chat = chats[chatId];
    if (!chat) return;

    try {
      const output = await this.opts.agentRunner.run(chat, {
        prompt: `[하트비트] HEARTBEAT.md를 읽고 체크리스트를 확인하세요. 할 일이 없으면 "HEARTBEAT_OK"라고만 답하세요.\n\n${content}`,
      });

      const result = stripInternalTags(output.result).trim();

      // HEARTBEAT_OK 응답이면 사용자에게 전송하지 않음
      if (result === HEARTBEAT_OK || result.includes(HEARTBEAT_OK)) {
        logger.debug({ chatFolder }, '하트비트: OK, 전송 건너뜀');
        return;
      }

      if (result) {
        await this.opts.sendMessage(chatId, result);
      }
    } catch (err) {
      logger.error({ chatFolder, err }, '하트비트 실행 오류');
    }
  }
}
