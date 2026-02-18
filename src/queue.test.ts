import { describe, it, expect, vi, beforeEach } from 'vitest';
import { MessageQueue } from './queue.js';

// MAX_CONCURRENT_AGENTS 모킹 (다른 export 유지)
vi.mock('./config.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./config.js')>();
  return { ...actual, MAX_CONCURRENT_AGENTS: 2 };
});

describe('MessageQueue', () => {
  let queue: MessageQueue;
  let processedChats: string[];
  let processDelay: number;

  beforeEach(() => {
    queue = new MessageQueue();
    processedChats = [];
    processDelay = 0;

    queue.setProcessMessagesFn(async (chatId) => {
      processedChats.push(chatId);
      if (processDelay > 0) {
        await new Promise((r) => setTimeout(r, processDelay));
      }
    });
  });

  it('메시지를 큐에 넣고 처리한다', async () => {
    queue.enqueueMessageCheck('chat1');
    await new Promise((r) => setTimeout(r, 50));
    expect(processedChats).toContain('chat1');
  });

  it('같은 채팅의 중복 요청은 대기 상태로 처리된다', async () => {
    processDelay = 100;
    queue.enqueueMessageCheck('chat1');
    queue.enqueueMessageCheck('chat1');

    await new Promise((r) => setTimeout(r, 300));
    expect(processedChats.filter((c) => c === 'chat1').length).toBe(2);
  });

  it('셧다운 후에는 새 메시지를 처리하지 않는다', async () => {
    await queue.shutdown();
    queue.enqueueMessageCheck('chat1');
    await new Promise((r) => setTimeout(r, 50));
    expect(processedChats).toHaveLength(0);
  });

  it('동시 실행 제한을 따른다', async () => {
    processDelay = 200;
    queue.enqueueMessageCheck('chat1');
    queue.enqueueMessageCheck('chat2');
    queue.enqueueMessageCheck('chat3');

    await new Promise((r) => setTimeout(r, 50));
    expect(processedChats.length).toBeLessThanOrEqual(2);

    await new Promise((r) => setTimeout(r, 500));
    expect(processedChats).toContain('chat3');
  });
});
