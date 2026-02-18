// TUI 설정 마법사 타입 정의

export type Language = 'ko' | 'en';

export interface WizardState {
  language: Language;
  credentials: {
    telegramBotToken: string;
    anthropicApiKey: string;
  };
  settings: {
    botName: string;
    anthropicModel: string;
    anthropicBaseUrl: string;
    adminUserIds: string;
    logLevel: string;
    agentTimeout: string;
    maxConcurrentAgents: string;
    timezone: string;
  };
}
