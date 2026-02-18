import { MAX_CONCURRENT_AGENTS } from './config.js';
import { logger } from './logger.js';

interface QueuedJob {
  chatId: string;
  fn: () => Promise<void>;
}

interface ChatState {
  active: boolean;
  pendingMessages: boolean;
}

export class MessageQueue {
  private chats = new Map<string, ChatState>();
  private activeCount = 0;
  private waitingChats: string[] = [];
  private processMessagesFn: ((chatId: string) => Promise<void>) | null = null;
  private shuttingDown = false;

  private getChat(chatId: string): ChatState {
    let state = this.chats.get(chatId);
    if (!state) {
      state = { active: false, pendingMessages: false };
      this.chats.set(chatId, state);
    }
    return state;
  }

  setProcessMessagesFn(fn: (chatId: string) => Promise<void>): void {
    this.processMessagesFn = fn;
  }

  enqueueMessageCheck(chatId: string): void {
    if (this.shuttingDown) return;

    const state = this.getChat(chatId);

    // 이미 실행 중이면 대기열에 추가
    if (state.active) {
      state.pendingMessages = true;
      logger.debug({ chatId }, 'Agent 실행 중, 메시지 대기열 추가');
      return;
    }

    // 동시 실행 제한
    if (this.activeCount >= MAX_CONCURRENT_AGENTS) {
      state.pendingMessages = true;
      if (!this.waitingChats.includes(chatId)) {
        this.waitingChats.push(chatId);
      }
      logger.debug({ chatId, activeCount: this.activeCount }, '동시실행 제한, 대기열 추가');
      return;
    }

    this.runForChat(chatId);
  }

  private async runForChat(chatId: string): Promise<void> {
    const state = this.getChat(chatId);
    state.active = true;
    state.pendingMessages = false;
    this.activeCount++;

    logger.debug({ chatId, activeCount: this.activeCount }, 'Agent 실행 시작');

    try {
      if (this.processMessagesFn) {
        await this.processMessagesFn(chatId);
      }
    } catch (err) {
      logger.error({ chatId, err }, '메시지 처리 오류');
    } finally {
      state.active = false;
      this.activeCount--;
      this.drain(chatId);
    }
  }

  private drain(chatId: string): void {
    if (this.shuttingDown) return;

    const state = this.getChat(chatId);
    if (state.pendingMessages) {
      this.runForChat(chatId);
      return;
    }

    // 대기 중인 다른 채팅 처리
    this.drainWaiting();
  }

  private drainWaiting(): void {
    while (this.waitingChats.length > 0 && this.activeCount < MAX_CONCURRENT_AGENTS) {
      const nextChatId = this.waitingChats.shift()!;
      const state = this.getChat(nextChatId);
      if (state.pendingMessages) {
        this.runForChat(nextChatId);
      }
    }
  }

  async shutdown(): Promise<void> {
    this.shuttingDown = true;
    logger.info({ activeCount: this.activeCount }, 'MessageQueue 종료');
  }
}
