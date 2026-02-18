// 한국어/영어 메시지 카탈로그
import type { Language } from './types.js';

const messages = {
  ko: {
    // 공통
    welcome: 'PhoneClaw 설정 마법사에 오신 것을 환영합니다!',
    cancelled: '설정이 취소되었습니다.',
    done: '설정이 완료되었습니다!',

    // Step 1: 언어
    selectLanguage: '언어를 선택하세요',
    langKo: '한국어',
    langEn: 'English',

    // Step 2: 인증
    credentialsTitle: '인증 설정',
    enterTelegramToken: 'Telegram Bot Token을 입력하세요 (@BotFather에서 발급)',
    enterAnthropicKey: 'Anthropic API Key를 입력하세요',
    telegramTokenRequired: 'Telegram Bot Token은 필수입니다',
    anthropicKeyRequired: 'Anthropic API Key는 필수입니다',
    telegramTokenInvalid: 'Telegram Bot Token 형식이 올바르지 않습니다 (숫자:문자열)',
    anthropicKeyInvalid: 'Anthropic API Key는 sk-ant-로 시작해야 합니다',

    // Step 3: 설정
    settingsTitle: '선택 설정',
    enterBotName: '봇 표시 이름 (트리거 패턴에 사용)',
    selectModel: 'Claude 모델을 선택하세요',
    enterBaseUrl: '대체 API 엔드포인트 (비워두면 공식 API)',
    enterAdminIds: '관리자 Telegram User ID (쉼표 구분, 선택)',
    selectLogLevel: '로그 레벨을 선택하세요',
    enterTimezone: '타임존',

    // Step 4: .env 생성
    envTitle: '.env 파일 생성',
    envExists: '.env 파일이 이미 존재합니다. 덮어쓰시겠습니까?',
    envOverwrite: '덮어쓰기',
    envCancel: '취소',
    envCreated: '.env 파일이 생성되었습니다',
    envSettingSummary: '설정 요약',

    // 건강 체크
    healthCheckTitle: '인증 정보 검증',
    healthCheckRunning: 'API 연결 테스트 중...',
    healthCheckDone: '검증 완료',
    healthCheckTelegramOk: (botName: string) => `Telegram Bot 연결 성공: ${botName}`,
    healthCheckTelegramFail: (error: string) => `Telegram Bot 연결 실패: ${error}`,
    healthCheckAnthropicOk: 'Anthropic API 연결 성공',
    healthCheckAnthropicFail: (error: string) => `Anthropic API 연결 실패: ${error}`,
    healthCheckContinue: '검증에 실패한 항목이 있습니다. 계속 진행하시겠습니까?',

    // 완료
    setupComplete: '설정이 완료되었습니다! 봇을 실행하려면 아래 명령어를 사용하세요.',
    setupNextDev: '개발 모드: npm run dev',
    setupNextProd: '프로덕션: npm run build && bash scripts/start.sh',
  },
  en: {
    welcome: 'Welcome to PhoneClaw Setup Wizard!',
    cancelled: 'Setup cancelled.',
    done: 'Setup complete!',

    selectLanguage: 'Select language',
    langKo: '한국어',
    langEn: 'English',

    credentialsTitle: 'Authentication',
    enterTelegramToken: 'Enter Telegram Bot Token (from @BotFather)',
    enterAnthropicKey: 'Enter Anthropic API Key',
    telegramTokenRequired: 'Telegram Bot Token is required',
    anthropicKeyRequired: 'Anthropic API Key is required',
    telegramTokenInvalid: 'Invalid Telegram Bot Token format (number:string)',
    anthropicKeyInvalid: 'Anthropic API Key must start with sk-ant-',

    settingsTitle: 'Optional Settings',
    enterBotName: 'Bot display name (used in trigger pattern)',
    selectModel: 'Select Claude model',
    enterBaseUrl: 'Alternative API endpoint (leave empty for official API)',
    enterAdminIds: 'Admin Telegram User IDs (comma-separated, optional)',
    selectLogLevel: 'Select log level',
    enterTimezone: 'Timezone',

    envTitle: '.env File Generation',
    envExists: '.env file already exists. Overwrite?',
    envOverwrite: 'Overwrite',
    envCancel: 'Cancel',
    envCreated: '.env file created',
    envSettingSummary: 'Settings Summary',

    healthCheckTitle: 'Credential Verification',
    healthCheckRunning: 'Testing API connections...',
    healthCheckDone: 'Verification complete',
    healthCheckTelegramOk: (botName: string) => `Telegram Bot connected: ${botName}`,
    healthCheckTelegramFail: (error: string) => `Telegram Bot connection failed: ${error}`,
    healthCheckAnthropicOk: 'Anthropic API connected',
    healthCheckAnthropicFail: (error: string) => `Anthropic API connection failed: ${error}`,
    healthCheckContinue: 'Some verifications failed. Continue anyway?',

    setupComplete: 'Setup complete! Use the commands below to start the bot.',
    setupNextDev: 'Development: npm run dev',
    setupNextProd: 'Production: npm run build && bash scripts/start.sh',
  },
} as const;

type MessageKey = keyof typeof messages.ko;

export function t<K extends MessageKey>(
  lang: Language,
  key: K,
): (typeof messages.ko)[K] {
  return messages[lang][key] as (typeof messages.ko)[K];
}
