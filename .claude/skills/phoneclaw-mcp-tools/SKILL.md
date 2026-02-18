---
name: phoneclaw-mcp-tools
description: "PhoneClaw EP06 - Agent MCP 도구. Claude Code SDK의 MCP 서버를 활용하여 Agent가 실행 중 Telegram 메시지 전송, 예약 작업 관리 등을 수행할 수 있는 도구 세트를 구성합니다."
---

# EP06: PhoneClaw MCP Tools

Agent가 실행 중에 사용할 수 있는 **MCP(Model Context Protocol) 도구**를 정의하고, Local Runner에 통합합니다.

## 개요

Claude Code SDK의 `createSdkMcpServer`를 사용하여 커스텀 MCP 서버를 구성합니다. Agent는 이 MCP 도구를 통해:

- **`send_message`**: 실행 도중 사용자에게 즉시 메시지 전송 (진행 상황 알림 등)
- **`schedule_task`**: cron/interval/once 방식으로 예약 작업 등록
- **`list_tasks`**: 현재 채팅의 예약 작업 목록 조회
- **`pause_task`** / **`resume_task`**: 작업 일시정지/재개
- **`cancel_task`**: 작업 취소 및 삭제

### 아키텍처

```
Agent (Claude Code)
  |
  ├── mcp__phoneclaw__send_message   -> callbacks.sendMessage -> TelegramChannel
  ├── mcp__phoneclaw__schedule_task  -> callbacks.scheduleTask -> DB
  ├── mcp__phoneclaw__list_tasks     -> callbacks.listTasks -> DB
  ├── mcp__phoneclaw__pause_task     -> callbacks.updateTaskStatus -> DB
  ├── mcp__phoneclaw__resume_task    -> callbacks.updateTaskStatus -> DB
  └── mcp__phoneclaw__cancel_task    -> callbacks.cancelTask -> DB
```

MCP 도구는 콜백 패턴으로 구현되어, 실제 실행 로직(Telegram 전송, DB 조작)은 `index.ts`에서 주입합니다.

## 의존성

- **EP01~EP04 완료 필수**: `config.ts`, `types.ts`, `db.ts`, `agent/types.ts` 존재
- **npm 패키지**: `@anthropic-ai/claude-code`, `@modelcontextprotocol/sdk`, `zod`

## 단계별 지시

### Step 1: `src/mcp/tools.ts` 생성

MCP 서버 팩토리 함수입니다. `chatId`와 `chatFolder`를 클로저로 캡처하여 각 도구가 올바른 채팅 컨텍스트에서 동작합니다.

```typescript
// src/mcp/tools.ts
import { createSdkMcpServer, tool } from '@anthropic-ai/claude-code';
import { z } from 'zod';

export interface McpToolCallbacks {
  sendMessage: (chatId: string, text: string) => Promise<void>;
  scheduleTask?: (data: {
    prompt: string;
    scheduleType: 'cron' | 'interval' | 'once';
    scheduleValue: string;
    chatId: string;
    chatFolder: string;
  }) => Promise<string>;
  listTasks?: (chatFolder: string) => string;
  updateTaskStatus?: (taskId: string, status: 'active' | 'paused') => Promise<void>;
  cancelTask?: (taskId: string) => Promise<void>;
}

export function createPhoneClawMcpServer(chatId: string, chatFolder: string, callbacks: McpToolCallbacks) {
  return createSdkMcpServer({
    name: 'phoneclaw',
    version: '1.0.0',
    tools: [
      tool(
        'send_message',
        '실행 중 사용자에게 즉시 메시지를 보냅니다. 진행 상황 업데이트나 여러 메시지를 보낼 때 사용하세요.',
        { text: z.string().describe('보낼 메시지 텍스트') },
        async (args) => {
          await callbacks.sendMessage(chatId, args.text);
          return { content: [{ type: 'text' as const, text: '메시지 전송 완료.' }] };
        },
      ),

      tool(
        'schedule_task',
        `예약 작업을 등록합니다. cron/interval/once 타입 지원.
- cron: "0 9 * * *" (매일 오전 9시)
- interval: "3600000" (1시간마다, 밀리초)
- once: "2026-02-01T15:30:00" (1회, 로컬 시간)`,
        {
          prompt: z.string().describe('작업 실행 시 Agent에게 전달할 프롬프트'),
          schedule_type: z.enum(['cron', 'interval', 'once']),
          schedule_value: z.string().describe('스케줄 값'),
        },
        async (args) => {
          if (!callbacks.scheduleTask) {
            return { content: [{ type: 'text' as const, text: '스케줄러가 활성화되지 않았습니다.' }], isError: true };
          }
          const taskId = await callbacks.scheduleTask({
            prompt: args.prompt,
            scheduleType: args.schedule_type,
            scheduleValue: args.schedule_value,
            chatId,
            chatFolder,
          });
          return { content: [{ type: 'text' as const, text: `작업 예약 완료 (ID: ${taskId})` }] };
        },
      ),

      tool(
        'list_tasks',
        '현재 채팅의 예약 작업 목록을 조회합니다.',
        {},
        async () => {
          if (!callbacks.listTasks) {
            return { content: [{ type: 'text' as const, text: '스케줄러가 활성화되지 않았습니다.' }] };
          }
          const list = callbacks.listTasks(chatFolder);
          return { content: [{ type: 'text' as const, text: list || '예약된 작업이 없습니다.' }] };
        },
      ),

      tool(
        'pause_task',
        '예약 작업을 일시 정지합니다.',
        { task_id: z.string().describe('작업 ID') },
        async (args) => {
          if (!callbacks.updateTaskStatus) {
            return { content: [{ type: 'text' as const, text: '스케줄러가 활성화되지 않았습니다.' }], isError: true };
          }
          await callbacks.updateTaskStatus(args.task_id, 'paused');
          return { content: [{ type: 'text' as const, text: `작업 ${args.task_id} 일시정지.` }] };
        },
      ),

      tool(
        'resume_task',
        '일시정지된 작업을 재개합니다.',
        { task_id: z.string().describe('작업 ID') },
        async (args) => {
          if (!callbacks.updateTaskStatus) {
            return { content: [{ type: 'text' as const, text: '스케줄러가 활성화되지 않았습니다.' }], isError: true };
          }
          await callbacks.updateTaskStatus(args.task_id, 'active');
          return { content: [{ type: 'text' as const, text: `작업 ${args.task_id} 재개.` }] };
        },
      ),

      tool(
        'cancel_task',
        '예약 작업을 취소하고 삭제합니다.',
        { task_id: z.string().describe('작업 ID') },
        async (args) => {
          if (!callbacks.cancelTask) {
            return { content: [{ type: 'text' as const, text: '스케줄러가 활성화되지 않았습니다.' }], isError: true };
          }
          await callbacks.cancelTask(args.task_id);
          return { content: [{ type: 'text' as const, text: `작업 ${args.task_id} 취소됨.` }] };
        },
      ),
    ],
  });
}
```

### Step 2: `src/agent/local-runner.ts`에 MCP 통합

Local Runner에서 MCP 서버를 생성하고 Claude Code `query()`에 주입합니다. 핵심 통합 포인트:

1. **`setMcpCallbacks()`**: 외부(index.ts)에서 콜백 함수 주입
2. **`createPhoneClawMcpServer()`**: 채팅별 MCP 서버 인스턴스 생성
3. **`query({ mcpServers })`**: Agent 실행 시 MCP 서버 전달
4. **`allowedTools: ['mcp__phoneclaw__*']`**: MCP 도구 허용 패턴

```typescript
// src/agent/local-runner.ts
import fs from 'fs';
import path from 'path';
import { query } from '@anthropic-ai/claude-code';

import { AGENT_TIMEOUT, CHATS_DIR, BOT_NAME } from '../config.js';
import { logger } from '../logger.js';
import { getSession, setSession } from '../db.js';
import { createPhoneClawMcpServer, type McpToolCallbacks } from '../mcp/tools.js';
import type { AgentRunner } from './types.js';
import type { RegisteredChat, AgentInput, AgentOutput, OnAgentOutput } from '../types.js';

export class LocalAgentRunner implements AgentRunner {
  private mcpCallbacks: McpToolCallbacks | null = null;

  setMcpCallbacks(callbacks: McpToolCallbacks): void {
    this.mcpCallbacks = callbacks;
  }

  async run(chat: RegisteredChat, input: AgentInput, onOutput?: OnAgentOutput): Promise<AgentOutput> {
    const startTime = Date.now();
    const chatDir = path.join(CHATS_DIR, chat.folder);
    fs.mkdirSync(chatDir, { recursive: true });

    // 채팅별 CLAUDE.md
    const claudeMdPath = path.join(chatDir, 'CLAUDE.md');

    // 기존 세션 resume 또는 신규 생성
    const existingSessionId = input.sessionId || getSession(chat.folder);

    // 글로벌 시스템 프롬프트 구성
    let systemAppend = `당신의 이름은 ${BOT_NAME}입니다. Telegram 메시지에 한국어로 응답하세요. 간결하고 자연스럽게 대화하세요.`;
    if (fs.existsSync(claudeMdPath)) {
      systemAppend += '\n\n' + fs.readFileSync(claudeMdPath, 'utf-8');
    }

    let sessionId = existingSessionId;
    let resultText = '';
    const timeout = input.timeout || AGENT_TIMEOUT;

    // MCP 서버 생성 (send_message 등 도구 제공)
    const mcpServers: Record<string, any> = {};
    if (this.mcpCallbacks) {
      mcpServers.phoneclaw = createPhoneClawMcpServer(chat.chatId, chat.folder, this.mcpCallbacks);
    }

    try {
      const abortController = new AbortController();
      const timer = setTimeout(() => abortController.abort(), timeout);

      for await (const message of query({
        prompt: input.prompt,
        options: {
          cwd: chatDir,
          resume: existingSessionId,
          appendSystemPrompt: systemAppend,
          allowedTools: [
            'Read', 'Write', 'Edit', 'Glob', 'Grep',
            'Bash',
            'WebSearch', 'WebFetch',
            'Task', 'TaskOutput',
            'mcp__phoneclaw__*',
          ],
          permissionMode: 'bypassPermissions',
          mcpServers,
          abortController,
        },
      })) {
        // 세션 초기화
        if (message.type === 'system' && message.subtype === 'init') {
          sessionId = message.session_id;
          logger.debug({ sessionId, chat: chat.folder }, 'Agent 세션 시작');
        }

        // 결과 수집
        if (message.type === 'result') {
          const text = 'result' in message ? (message as { result?: string }).result : null;
          if (text) {
            resultText = text;
            onOutput?.(text);
          }
        }
      }

      clearTimeout(timer);

      // 세션 ID 저장
      if (sessionId) {
        setSession(chat.folder, sessionId);
      }

      const durationMs = Date.now() - startTime;
      logger.info({ chat: chat.folder, durationMs, sessionId }, 'Agent 실행 완료');

      return {
        result: resultText || '(응답 없음)',
        sessionId: sessionId || '',
        durationMs,
      };
    } catch (err) {
      const durationMs = Date.now() - startTime;
      const errorMsg = err instanceof Error ? err.message : String(err);
      logger.error({ chat: chat.folder, err: errorMsg, durationMs }, 'Agent 실행 오류');

      return {
        result: `오류가 발생했습니다: ${errorMsg}`,
        sessionId: sessionId || '',
        durationMs,
      };
    }
  }

  async shutdown(): Promise<void> {
    logger.info('LocalAgentRunner 종료');
  }
}
```

### Step 3: `index.ts`에서 MCP 콜백 연결 (EP05 참고)

`index.ts`의 `main()` 함수에서 LocalAgentRunner 생성 후 `setMcpCallbacks()`를 호출합니다. 이 부분은 EP05(message-loop)에서 이미 포함되어 있으므로, EP05를 먼저 완료한 후 이 스킬을 실행하세요.

핵심 연결 코드:

```typescript
// index.ts (EP05에서 생성됨) 중 관련 부분
const localRunner = new LocalAgentRunner();
localRunner.setMcpCallbacks({
  sendMessage: (chatId, text) => channel.sendMessage(chatId, text),
  scheduleTask: async (data) => {
    const taskId = crypto.randomUUID().slice(0, 8);
    // ... DB에 task 저장
    return taskId;
  },
  listTasks: (chatFolder) => { /* DB 조회 */ },
  updateTaskStatus: async (taskId, status) => { updateTask(taskId, { status }); },
  cancelTask: async (taskId) => { deleteTask(taskId); },
});
agentRunner = localRunner;
```

## MCP 도구 상세

### send_message

| 항목 | 설명 |
|------|------|
| 용도 | 실행 중 즉시 메시지 전송 |
| 파라미터 | `text: string` |
| 사용 예 | "데이터 분석 중입니다. 잠시 기다려주세요..." |
| 내부 동작 | `callbacks.sendMessage(chatId, text)` -> `TelegramChannel.sendMessage()` |

### schedule_task

| 항목 | 설명 |
|------|------|
| 용도 | 반복/예약 작업 등록 |
| 파라미터 | `prompt`, `schedule_type` (cron/interval/once), `schedule_value` |
| cron 예시 | `"0 9 * * *"` - 매일 오전 9시 |
| interval 예시 | `"3600000"` - 1시간마다 (밀리초) |
| once 예시 | `"2026-02-01T15:30:00"` - 1회 실행 |

### list_tasks / pause_task / resume_task / cancel_task

예약 작업 CRUD 도구입니다. `chatFolder` 기준으로 해당 채팅의 작업만 조회/관리합니다.

## 검증

```bash
# 타입 체크
npx tsc --noEmit

# 파일 존재 확인
ls -la src/mcp/tools.ts src/agent/local-runner.ts
```
