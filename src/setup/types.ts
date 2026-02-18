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

export interface SkillMeta {
  name: string;       // 'phoneclaw-scaffold'
  episode: string;    // 'EP01'
  title: string;      // '프로젝트 기반 구축'
}

export interface SkillRunResult {
  skill: SkillMeta;
  success: boolean;
  durationMs: number;
  error?: string;
  retryCount: number;
}
