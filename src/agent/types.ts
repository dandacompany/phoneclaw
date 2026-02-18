import type { RegisteredChat, AgentInput, AgentOutput, OnAgentOutput } from '../types.js';

export interface AgentRunner {
  run(chat: RegisteredChat, input: AgentInput, onOutput?: OnAgentOutput): Promise<AgentOutput>;
  shutdown(): Promise<void>;
}
