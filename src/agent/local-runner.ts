import fs from 'fs';
import path from 'path';
import { query } from '@anthropic-ai/claude-code';

import {
  AGENT_TIMEOUT, CHATS_DIR, BOT_NAME,
  MEMORY_RECENT_DAYS, MEMORY_MAX_DAILY_LOG_KB, MEMORY_MAX_LONGTERM_KB,
} from '../config.js';
import { logger } from '../logger.js';
import { getSession, setSession } from '../db.js';
import { createPhoneClawMcpServer, type McpToolCallbacks } from '../mcp/tools.js';
import { isBootstrapped, loadPersona } from '../persona/persona.js';
import { BOOTSTRAP_PROMPT } from '../persona/bootstrap-prompt.js';
import { loadRecentMemory, loadLongTermMemory } from '../memory/memory.js';
import { MetricsCollector } from '../metrics/metrics.js';
import type { AgentRunner } from './types.js';
import type { RegisteredChat, AgentInput, AgentOutput, OnAgentOutput } from '../types.js';

const MAX_SYSTEM_PROMPT_KB = 50;
const metrics = MetricsCollector.getInstance();

export class LocalAgentRunner implements AgentRunner {
  private mcpCallbacks: McpToolCallbacks | null = null;

  setMcpCallbacks(callbacks: McpToolCallbacks): void {
    this.mcpCallbacks = callbacks;
  }

  async run(chat: RegisteredChat, input: AgentInput, onOutput?: OnAgentOutput): Promise<AgentOutput> {
    const startTime = Date.now();
    const chatDir = path.join(CHATS_DIR, chat.folder);
    fs.mkdirSync(chatDir, { recursive: true });

    metrics.increment('agent_runs');

    // 시스템 프롬프트 구성
    let systemAppend = this.buildSystemPrompt(chat, chatDir);

    // 사이즈 체크 & 절삭
    const sizeKB = Buffer.byteLength(systemAppend, 'utf-8') / 1024;
    if (sizeKB > MAX_SYSTEM_PROMPT_KB) {
      logger.warn({ chat: chat.folder, sizeKB: sizeKB.toFixed(1) }, '시스템 프롬프트 50KB 초과, 절삭');
      systemAppend = systemAppend.slice(0, MAX_SYSTEM_PROMPT_KB * 1024);
    }

    // 기존 세션 resume 또는 신규 생성
    const existingSessionId = input.sessionId || getSession(chat.folder);

    let sessionId = existingSessionId;
    let resultText = '';
    const timeout = input.timeout || AGENT_TIMEOUT;

    // MCP 서버 생성
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
        if (message.type === 'system' && message.subtype === 'init') {
          sessionId = message.session_id;
          logger.debug({ sessionId, chat: chat.folder }, 'Agent 세션 시작');
        }

        if (message.type === 'result') {
          const text = 'result' in message ? (message as { result?: string }).result : null;
          if (text) {
            resultText = text;
            onOutput?.(text);
          }
        }
      }

      clearTimeout(timer);

      if (sessionId) {
        setSession(chat.folder, sessionId);
      }

      const durationMs = Date.now() - startTime;
      metrics.record('agent_duration_ms', durationMs);
      logger.info({ chat: chat.folder, durationMs, sessionId }, 'Agent 실행 완료');

      return {
        result: resultText || '(응답 없음)',
        sessionId: sessionId || '',
        durationMs,
      };
    } catch (err) {
      const durationMs = Date.now() - startTime;
      const errorMsg = err instanceof Error ? err.message : String(err);
      metrics.increment('agent_errors');
      metrics.record('agent_duration_ms', durationMs);
      logger.error({ chat: chat.folder, err: errorMsg, durationMs }, 'Agent 실행 오류');

      return {
        result: `오류가 발생했습니다: ${errorMsg}`,
        sessionId: sessionId || '',
        durationMs,
      };
    }
  }

  private buildSystemPrompt(chat: RegisteredChat, chatDir: string): string {
    const parts: string[] = [];

    // 1. 기본 시스템 프롬프트
    parts.push(`당신의 이름은 ${BOT_NAME}입니다. Telegram 메시지에 한국어로 응답하세요. 간결하고 자연스럽게 대화하세요.`);

    // 2. CLAUDE.md
    const claudeMdPath = path.join(chatDir, 'CLAUDE.md');
    if (fs.existsSync(claudeMdPath)) {
      parts.push(fs.readFileSync(claudeMdPath, 'utf-8'));
    }

    // 3. 페르소나
    if (isBootstrapped(chat.folder)) {
      const persona = loadPersona(chat.folder);
      if (persona) {
        parts.push(`\n# Persona\n${persona}`);
      }
    } else {
      // 상견례 미완료 → 부트스트랩 프롬프트 주입
      parts.push(`\n${BOOTSTRAP_PROMPT}`);
    }

    // 4. 메모리
    const memoryConfig = {
      recentDays: MEMORY_RECENT_DAYS,
      maxDailyLogKB: MEMORY_MAX_DAILY_LOG_KB,
      maxLongTermKB: MEMORY_MAX_LONGTERM_KB,
    };

    const recentMemory = loadRecentMemory(chat.folder, memoryConfig);
    if (recentMemory) {
      parts.push(`\n${recentMemory}`);
    }

    const longTermMemory = loadLongTermMemory(chat.folder, memoryConfig);
    if (longTermMemory) {
      parts.push(`\n# Long-term Memory\n${longTermMemory}`);
    }

    return parts.join('\n\n');
  }

  async shutdown(): Promise<void> {
    logger.info('LocalAgentRunner 종료');
  }
}
