import type { AgentRunner } from '../agent/types.js';
import type { RegisteredChat } from '../types.js';

export interface HeartbeatOpts {
  /** 하트비트 간격 (밀리초) */
  intervalMs: number;
  /** 활성 시간 시작 (0-23시) */
  activeStart: number;
  /** 활성 시간 종료 (0-23시) */
  activeEnd: number;
  /** 에이전트 러너 */
  agentRunner: AgentRunner;
  /** 등록된 채팅 목록 */
  getRegisteredChats: () => Record<string, RegisteredChat>;
  /** 메시지 전송 콜백 */
  sendMessage: (chatId: string, text: string) => Promise<void>;
}
