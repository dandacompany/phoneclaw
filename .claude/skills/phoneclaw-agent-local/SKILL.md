---
name: phoneclaw-agent-local
description: "PhoneClaw EP04 - Claude Agent (Local 모드). @anthropic-ai/claude-code SDK를 사용하여 채팅별 Agent를 실행하고, MCP 도구를 통해 메시지 전송/스케줄링을 수행합니다."
---

# EP04: Claude Agent (Local 모드)

## 개요

`@anthropic-ai/claude-code` SDK의 `query` 함수를 사용하여 Claude Agent를 로컬 프로세스로 실행합니다.
채팅별로 독립된 세션을 유지하며, MCP 도구를 통해 Telegram 메시지 전송과 작업 스케줄링이 가능합니다.

주요 기능:
- 채팅별 작업 디렉토리 (`chats/{folder}/`) 분리
- 채팅별 CLAUDE.md로 커스텀 시스템 프롬프트
- 세션 resume (대화 맥락 유지)
- MCP 도구 (send_message, schedule_task 등) 제공
- 타임아웃 (AbortController) 지원
- 허용 도구 제한 (Read, Write, Bash, WebSearch 등)
- bypassPermissions 모드

이 에피소드는 3개 파일을 생성합니다:
- `src/agent/types.ts` - AgentRunner 인터페이스
- `src/agent/local-runner.ts` - LocalAgentRunner 구현
- `src/mcp/tools.ts` - MCP 도구 정의 (send_message, schedule_task 등)

## 의존성

- **EP01 완료 필수**: `src/config.ts`, `src/logger.ts`, `src/types.ts`
- **EP03 완료 필수**: `src/db.ts` (getSession, setSession 사용)
- `npm install` 완료 상태 (@anthropic-ai/claude-code, zod 포함)

## 단계별 지시

### 1단계: 디렉토리 생성

```bash
mkdir -p src/agent src/mcp
```

### 2단계: src/agent/types.ts 생성

AgentRunner 인터페이스를 정의합니다. 다음 내용으로 `src/agent/types.ts`를 작성합니다:

```typescript
import type { RegisteredChat, AgentInput, AgentOutput, OnAgentOutput } from '../types.js';

export interface AgentRunner {
  run(chat: RegisteredChat, input: AgentInput, onOutput?: OnAgentOutput): Promise<AgentOutput>;
  shutdown(): Promise<void>;
}
```

### 3단계: src/mcp/tools.ts 생성

Agent가 실행 중 사용할 MCP 도구를 정의합니다. 다음 내용으로 `src/mcp/tools.ts`를 작성합니다:

```typescript
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

### 4단계: src/agent/local-runner.ts 생성

Claude Agent SDK를 사용한 Local 모드 Agent Runner를 구현합니다. 다음 내용으로 `src/agent/local-runner.ts`를 작성합니다:

```typescript
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

## 검증

타입 체크를 실행하여 오류가 없는지 확인합니다:

```bash
npx tsc --noEmit
```

타입 체크가 통과하면 EP04가 완료된 것입니다.
Agent가 Telegram 메시지에 응답하려면 메시지 라우터(EP05)에서 이 Runner를 연결해야 합니다.
