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
