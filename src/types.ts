// === Channel 추상화 ===

export interface Channel {
  name: string;
  connect(): Promise<void>;
  sendMessage(chatId: string, text: string): Promise<void>;
  setTyping?(chatId: string, isTyping: boolean): Promise<void>;
  isConnected(): boolean;
  disconnect(): Promise<void>;
}

export type OnInboundMessage = (chatId: string, message: NewMessage) => void;
export type OnChatMetadata = (chatId: string, timestamp: string, name?: string) => void;

// === 메시지 ===

export interface NewMessage {
  id: string;
  chatId: string;
  senderId: string;
  senderName: string;
  content: string;
  timestamp: string;
  isFromMe?: boolean;
}

// === 등록된 채팅 ===

export interface RegisteredChat {
  chatId: string;
  name: string;
  folder: string;
  requiresTrigger: boolean;
  addedAt: string;
}

// === Agent ===

export interface AgentInput {
  prompt: string;
  sessionId?: string;
  claudeMdPath?: string;
  timeout?: number;
}

export interface AgentOutput {
  result: string;
  sessionId: string;
  durationMs: number;
}

export type OnAgentOutput = (chunk: string) => void;

export interface AgentRunner {
  run(chat: RegisteredChat, input: AgentInput, onOutput?: OnAgentOutput): Promise<AgentOutput>;
  shutdown(): Promise<void>;
}

// === 스케줄링 ===

export interface ScheduledTask {
  id: string;
  chatFolder: string;
  chatId: string;
  prompt: string;
  scheduleType: 'cron' | 'interval' | 'once';
  scheduleValue: string;
  nextRun: string | null;
  lastRun: string | null;
  lastResult: string | null;
  status: 'active' | 'paused' | 'completed';
  createdAt: string;
}

export interface TaskRunLog {
  taskId: string;
  runAt: string;
  durationMs: number;
  status: 'success' | 'error';
  result: string | null;
  error: string | null;
}
