export interface WebhookRequest {
  /** 대상 채팅 ID (예: "tg:123456") */
  chatId: string;
  /** 에이전트에게 전달할 메시지 (message 엔드포인트용) */
  message?: string;
}

export interface WebhookResponse {
  ok: boolean;
  message?: string;
  error?: string;
}

export interface WebhookServerOpts {
  /** 포트 번호 (기본 3456) */
  port: number;
  /** Bearer 토큰 */
  token: string;
  /** 메시지 전달 콜백 */
  onMessage: (chatId: string, message: string) => Promise<void>;
  /** 하트비트 트리거 콜백 */
  onWake: (chatId: string) => Promise<void>;
}
