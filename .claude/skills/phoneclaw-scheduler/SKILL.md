---
name: phoneclaw-scheduler
description: "EP08 - PhoneClaw 예약 작업 스케줄러 생성"
---

# EP08: 예약 작업 스케줄러 (phoneclaw-scheduler)

## 개요

PhoneClaw 봇의 예약 작업 스케줄러를 구현합니다. cron 표현식, 고정 간격(interval), 일회성(once) 세 가지 스케줄 유형을 지원하며, 주기적으로 실행 대기 작업을 확인하여 Agent를 통해 실행하고 결과를 채팅에 전송합니다.

## 의존성

- **EP01~EP08 완료 필수**: 프로젝트 스캐폴드, 데이터베이스, Telegram 채널, Agent Runner, 메시지 루프가 모두 구현되어 있어야 합니다.
- `src/types.ts`에 `ScheduledTask`, `TaskRunLog` 인터페이스가 정의되어 있어야 합니다.
- `src/db.ts`에 `getDueTasks`, `updateTaskAfterRun`, `logTaskRun` 함수가 존재해야 합니다.
- `src/config.ts`에 `SCHEDULER_POLL_INTERVAL`, `TIMEZONE` 상수가 정의되어 있어야 합니다.
- `cron-parser` 패키지가 설치되어 있어야 합니다 (`package.json` 확인).

## 단계별 지시

### 1단계: 의존성 확인

다음 파일들이 존재하는지 확인합니다:
- `src/types.ts` - `ScheduledTask`, `TaskRunLog` 타입
- `src/db.ts` - `getDueTasks`, `updateTaskAfterRun`, `logTaskRun` 함수
- `src/config.ts` - `SCHEDULER_POLL_INTERVAL`, `TIMEZONE` 상수
- `package.json` - `cron-parser` 의존성

### 2단계: `src/scheduler.ts` 생성

아래 내용으로 `src/scheduler.ts` 파일을 생성합니다:

```typescript
import { CronExpressionParser } from 'cron-parser';

import { SCHEDULER_POLL_INTERVAL, TIMEZONE } from './config.js';
import { getDueTasks, updateTaskAfterRun, logTaskRun } from './db.js';
import { logger } from './logger.js';
import type { AgentRunner } from './agent/types.js';
import type { RegisteredChat, ScheduledTask } from './types.js';

interface SchedulerOpts {
  agentRunner: AgentRunner;
  getRegisteredChats: () => Record<string, RegisteredChat>;
  sendMessage: (chatId: string, text: string) => Promise<void>;
}

export function computeNextRun(task: ScheduledTask): string | null {
  if (task.scheduleType === 'cron') {
    try {
      const interval = CronExpressionParser.parse(task.scheduleValue, { tz: TIMEZONE });
      return interval.next().toISOString();
    } catch {
      logger.warn({ taskId: task.id, cron: task.scheduleValue }, '잘못된 cron 표현식');
      return null;
    }
  }

  if (task.scheduleType === 'interval') {
    const ms = parseInt(task.scheduleValue, 10);
    if (isNaN(ms) || ms <= 0) return null;
    return new Date(Date.now() + ms).toISOString();
  }

  // once - 이미 실행되면 다음 실행 없음
  return null;
}

export function startSchedulerLoop(opts: SchedulerOpts): void {
  const { agentRunner, getRegisteredChats, sendMessage } = opts;

  async function tick(): Promise<void> {
    try {
      const dueTasks = getDueTasks();
      if (dueTasks.length === 0) return;

      logger.info({ count: dueTasks.length }, '실행 대기 작업 발견');

      for (const task of dueTasks) {
        const chats = getRegisteredChats();
        const chat = chats[task.chatId];
        if (!chat) {
          logger.warn({ taskId: task.id, chatId: task.chatId }, '등록되지 않은 채팅의 작업, 건너뜀');
          continue;
        }

        const startTime = Date.now();
        let status: 'success' | 'error' = 'success';
        let resultText = '';
        let errorText: string | null = null;

        try {
          logger.info({ taskId: task.id, prompt: task.prompt.slice(0, 50) }, '예약 작업 실행');

          const output = await agentRunner.run(chat, {
            prompt: `[예약 작업] ${task.prompt}`,
          });

          resultText = output.result;

          // 결과를 채팅에 전송
          if (resultText && !resultText.startsWith('<internal>')) {
            await sendMessage(task.chatId, resultText);
          }
        } catch (err) {
          status = 'error';
          errorText = err instanceof Error ? err.message : String(err);
          logger.error({ taskId: task.id, err: errorText }, '예약 작업 실행 오류');
        }

        const durationMs = Date.now() - startTime;

        // 실행 로그 기록
        logTaskRun({
          taskId: task.id,
          runAt: new Date().toISOString(),
          durationMs,
          status,
          result: resultText.slice(0, 1000),
          error: errorText,
        });

        // 다음 실행 시간 계산
        const nextRun = computeNextRun(task);
        updateTaskAfterRun(task.id, nextRun, resultText.slice(0, 500));

        logger.info(
          { taskId: task.id, status, durationMs, nextRun },
          '예약 작업 완료',
        );
      }
    } catch (err) {
      logger.error({ err }, '스케줄러 루프 오류');
    }
  }

  // 주기적 실행
  setInterval(tick, SCHEDULER_POLL_INTERVAL);
  logger.info({ interval: SCHEDULER_POLL_INTERVAL }, '스케줄러 시작');

  // 즉시 1회 실행
  tick();
}
```

### 3단계: `src/index.ts`에 스케줄러 통합

`src/index.ts`의 `main()` 함수 안에 스케줄러를 연결합니다. 다음 import와 호출 코드가 포함되어 있어야 합니다:

**import 추가** (파일 상단):
```typescript
import { startSchedulerLoop, computeNextRun } from './scheduler.js';
```

**main() 함수 내 스케줄러 시작** (`queue.setProcessMessagesFn(processMessages)` 이후):
```typescript
  // 스케줄러 시작
  startSchedulerLoop({
    agentRunner,
    getRegisteredChats: () => registeredChats,
    sendMessage: (chatId, text) => channel.sendMessage(chatId, text),
  });
```

**MCP 콜백의 scheduleTask에서 computeNextRun 사용**:
```typescript
      scheduleTask: async (data) => {
        const taskId = crypto.randomUUID().slice(0, 8);
        const task: Omit<ScheduledTask, 'lastRun' | 'lastResult'> = {
          id: taskId,
          chatFolder: data.chatFolder,
          chatId: data.chatId,
          prompt: data.prompt,
          scheduleType: data.scheduleType,
          scheduleValue: data.scheduleValue,
          nextRun: null,
          status: 'active',
          createdAt: new Date().toISOString(),
        };
        // 다음 실행 시간 계산
        const nextRun = computeNextRun(task as ScheduledTask);
        createTask({ ...task, nextRun });
        return taskId;
      },
```

## 핵심 동작 원리

1. **스케줄 유형 3가지**:
   - `cron`: cron 표현식 (`0 9 * * *` = 매일 09:00)
   - `interval`: 밀리초 간격 (`3600000` = 1시간마다)
   - `once`: 일회성 실행 후 `completed` 상태로 전환

2. **실행 흐름**:
   - `SCHEDULER_POLL_INTERVAL` (기본 60초)마다 `tick()` 실행
   - `getDueTasks()`로 `next_run <= now`인 활성 작업 조회
   - 각 작업에 대해 Agent를 실행하고 결과를 채팅에 전송
   - `logTaskRun()`으로 실행 이력 기록
   - `computeNextRun()`으로 다음 실행 시간 계산 후 DB 업데이트

3. **안전장치**:
   - 등록되지 않은 채팅의 작업은 건너뜀
   - 오류 발생 시 status를 `error`로 기록하되 스케줄러 루프는 계속 동작
   - `once` 유형은 실행 후 `nextRun = null` 반환 -> DB에서 `completed` 처리

## 검증

1. TypeScript 컴파일 확인:
```bash
cd /Users/dante/workspace/dante-code/projects/phoneclaw && npx tsc --noEmit
```

2. `src/scheduler.ts` 파일이 존재하고 `computeNextRun`, `startSchedulerLoop`를 export하는지 확인

3. `src/index.ts`에서 `startSchedulerLoop`을 import하고 `main()` 내에서 호출하는지 확인

4. 테스트 실행 (있는 경우):
```bash
cd /Users/dante/workspace/dante-code/projects/phoneclaw && npm test
```
