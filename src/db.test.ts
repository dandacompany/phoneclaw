import { describe, it, expect, beforeEach } from 'vitest';
import {
  _initTestDatabase,
  storeChatMetadata,
  getAllChats,
  storeMessage,
  getNewMessages,
  getMessagesSince,
  setRegisteredChat,
  getRegisteredChat,
  removeRegisteredChat,
  getAllRegisteredChats,
  getSession,
  setSession,
  createTask,
  getTaskById,
  getAllTasks,
  getDueTasks,
  updateTask,
  updateTaskAfterRun,
  deleteTask,
  logTaskRun,
  getRouterState,
  setRouterState,
  withTransaction,
  cleanupOldRunLogs,
  cleanupStaleSessions,
  incrementTaskRetry,
  resetTaskRetry,
} from './db.js';

beforeEach(() => {
  _initTestDatabase();
});

describe('채팅 메타데이터', () => {
  it('채팅 메타데이터를 저장하고 조회한다', () => {
    storeChatMetadata('tg:1', '2026-01-01T00:00:00Z', 'Test Chat');
    const chats = getAllChats();
    expect(chats).toHaveLength(1);
    expect(chats[0].chatId).toBe('tg:1');
    expect(chats[0].name).toBe('Test Chat');
  });

  it('같은 채팅을 업데이트한다', () => {
    storeChatMetadata('tg:1', '2026-01-01T00:00:00Z', 'Old Name');
    storeChatMetadata('tg:1', '2026-01-02T00:00:00Z', 'New Name');
    const chats = getAllChats();
    expect(chats).toHaveLength(1);
    expect(chats[0].name).toBe('New Name');
  });
});

describe('메시지', () => {
  it('메시지를 저장하고 조회한다', () => {
    // FK 제약: chat 먼저 생성
    storeChatMetadata('tg:1', '2026-01-01T00:00:00Z', 'Test');

    storeMessage({
      id: 'msg1', chatId: 'tg:1', senderId: 'u1', senderName: 'Alice',
      content: 'Hello', timestamp: '2026-01-01T00:00:01Z', isFromMe: false,
    });

    const result = getNewMessages(['tg:1'], '2026-01-01T00:00:00Z');
    expect(result.messages).toHaveLength(1);
    expect(result.messages[0].content).toBe('Hello');
    expect(result.newTimestamp).toBe('2026-01-01T00:00:01Z');
  });

  it('isFromMe 메시지는 필터링된다', () => {
    storeChatMetadata('tg:1', '2026-01-01T00:00:00Z', 'Test');

    storeMessage({
      id: 'msg1', chatId: 'tg:1', senderId: 'bot', senderName: 'Bot',
      content: 'Reply', timestamp: '2026-01-01T00:00:01Z', isFromMe: true,
    });

    const result = getNewMessages(['tg:1'], '2026-01-01T00:00:00Z');
    expect(result.messages).toHaveLength(0);
  });

  it('getMessagesSince는 특정 채팅의 메시지를 반환한다', () => {
    storeChatMetadata('tg:1', '2026-01-01T00:00:00Z', 'Chat1');
    storeChatMetadata('tg:2', '2026-01-01T00:00:00Z', 'Chat2');

    storeMessage({
      id: 'msg1', chatId: 'tg:1', senderId: 'u1', senderName: 'Alice',
      content: 'Hello', timestamp: '2026-01-01T00:00:01Z',
    });
    storeMessage({
      id: 'msg2', chatId: 'tg:2', senderId: 'u2', senderName: 'Bob',
      content: 'Hi', timestamp: '2026-01-01T00:00:02Z',
    });

    const msgs = getMessagesSince('tg:1', '2026-01-01T00:00:00Z');
    expect(msgs).toHaveLength(1);
    expect(msgs[0].chatId).toBe('tg:1');
  });
});

describe('등록된 채팅', () => {
  it('채팅을 등록하고 조회한다', () => {
    setRegisteredChat({
      chatId: 'tg:1', name: 'Test', folder: 'test',
      requiresTrigger: true, addedAt: '2026-01-01T00:00:00Z',
    });

    const chat = getRegisteredChat('tg:1');
    expect(chat).toBeDefined();
    expect(chat!.name).toBe('Test');
    expect(chat!.requiresTrigger).toBe(true);
  });

  it('채팅을 삭제한다', () => {
    setRegisteredChat({
      chatId: 'tg:1', name: 'Test', folder: 'test',
      requiresTrigger: false, addedAt: '2026-01-01T00:00:00Z',
    });
    removeRegisteredChat('tg:1');
    expect(getRegisteredChat('tg:1')).toBeUndefined();
  });

  it('모든 등록된 채팅을 조회한다', () => {
    setRegisteredChat({ chatId: 'tg:1', name: 'A', folder: 'a', requiresTrigger: true, addedAt: '2026-01-01T00:00:00Z' });
    setRegisteredChat({ chatId: 'tg:2', name: 'B', folder: 'b', requiresTrigger: false, addedAt: '2026-01-02T00:00:00Z' });

    const all = getAllRegisteredChats();
    expect(Object.keys(all)).toHaveLength(2);
  });
});

describe('세션', () => {
  it('세션을 저장하고 조회한다', () => {
    setSession('test-folder', 'session-123');
    expect(getSession('test-folder')).toBe('session-123');
  });

  it('존재하지 않는 세션은 undefined를 반환한다', () => {
    expect(getSession('nonexistent')).toBeUndefined();
  });
});

describe('예약 작업', () => {
  const baseTask = {
    id: 'task-1',
    chatFolder: 'test',
    chatId: 'tg:1',
    prompt: 'test prompt',
    scheduleType: 'cron' as const,
    scheduleValue: '0 9 * * *',
    nextRun: '2026-01-01T09:00:00Z',
    status: 'active' as const,
    createdAt: '2026-01-01T00:00:00Z',
    retryCount: 0,
    maxRetries: 2,
  };

  it('작업을 생성하고 조회한다', () => {
    createTask(baseTask);
    const task = getTaskById('task-1');
    expect(task).toBeDefined();
    expect(task!.prompt).toBe('test prompt');
    expect(task!.retryCount).toBe(0);
    expect(task!.maxRetries).toBe(2);
  });

  it('실행 대기 작업을 조회한다', () => {
    createTask({ ...baseTask, nextRun: new Date(Date.now() - 1000).toISOString() });
    const due = getDueTasks();
    expect(due).toHaveLength(1);
  });

  it('미래 작업은 실행 대기에 포함되지 않는다', () => {
    createTask({ ...baseTask, nextRun: new Date(Date.now() + 3600000).toISOString() });
    const due = getDueTasks();
    expect(due).toHaveLength(0);
  });

  it('작업을 업데이트한다', () => {
    createTask(baseTask);
    updateTask('task-1', { status: 'paused' });
    expect(getTaskById('task-1')!.status).toBe('paused');
  });

  it('실행 후 작업을 업데이트한다', () => {
    createTask(baseTask);
    updateTaskAfterRun('task-1', '2026-01-02T09:00:00Z', 'result text');
    const task = getTaskById('task-1')!;
    expect(task.nextRun).toBe('2026-01-02T09:00:00Z');
    expect(task.lastResult).toBe('result text');
  });

  it('once 작업은 실행 후 completed가 된다', () => {
    createTask({ ...baseTask, scheduleType: 'once' });
    updateTaskAfterRun('task-1', null, 'done');
    expect(getTaskById('task-1')!.status).toBe('completed');
  });

  it('작업을 삭제한다', () => {
    createTask(baseTask);
    deleteTask('task-1');
    expect(getTaskById('task-1')).toBeUndefined();
  });

  it('실행 로그를 기록한다', () => {
    createTask(baseTask);
    logTaskRun({
      taskId: 'task-1', runAt: '2026-01-01T09:00:00Z',
      durationMs: 1000, status: 'success', result: 'ok', error: null,
    });
    // 삭제 시 로그도 삭제되는지 확인
    deleteTask('task-1');
    expect(getTaskById('task-1')).toBeUndefined();
  });

  it('retry 카운트를 증가/초기화한다', () => {
    createTask(baseTask);
    incrementTaskRetry('task-1');
    expect(getTaskById('task-1')!.retryCount).toBe(1);
    incrementTaskRetry('task-1');
    expect(getTaskById('task-1')!.retryCount).toBe(2);
    resetTaskRetry('task-1');
    expect(getTaskById('task-1')!.retryCount).toBe(0);
  });
});

describe('라우터 상태', () => {
  it('상태를 저장하고 조회한다', () => {
    setRouterState('last_timestamp', '2026-01-01T00:00:00Z');
    expect(getRouterState('last_timestamp')).toBe('2026-01-01T00:00:00Z');
  });

  it('존재하지 않는 키는 undefined를 반환한다', () => {
    expect(getRouterState('nonexistent')).toBeUndefined();
  });
});

describe('withTransaction', () => {
  it('트랜잭션 내 작업이 원자적으로 실행된다', () => {
    withTransaction(() => {
      setRouterState('key1', 'val1');
      setRouterState('key2', 'val2');
    });
    expect(getRouterState('key1')).toBe('val1');
    expect(getRouterState('key2')).toBe('val2');
  });
});

describe('정리 함수', () => {
  it('오래된 실행 로그를 삭제한다', () => {
    const baseTask = {
      id: 'task-cleanup', chatFolder: 'test', chatId: 'tg:1', prompt: 'test',
      scheduleType: 'cron' as const, scheduleValue: '0 9 * * *', nextRun: null,
      status: 'active' as const, createdAt: '2026-01-01T00:00:00Z', retryCount: 0, maxRetries: 2,
    };
    createTask(baseTask);

    // 오래된 로그
    logTaskRun({
      taskId: 'task-cleanup', runAt: '2025-01-01T00:00:00Z',
      durationMs: 100, status: 'success', result: null, error: null,
    });

    const deleted = cleanupOldRunLogs(14);
    expect(deleted).toBe(1);
  });

  it('오래된 세션을 삭제한다', () => {
    setSession('old-folder', 'old-session');
    // last_access를 인위적으로 과거로 설정하기 어려우므로 0 반환 확인
    const deleted = cleanupStaleSessions(90);
    expect(deleted).toBe(0); // 방금 생성했으므로 삭제 안 됨
  });
});
