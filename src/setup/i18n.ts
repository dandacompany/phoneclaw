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

    // Step 5: 스킬 실행
    skillsTitle: '스킬 순차 실행',
    skillsStart: '11개 스킬을 순차적으로 실행합니다...',
    skillRunning: '실행 중',
    skillSuccess: '완료',
    skillFailed: '실패',
    skillSkipped: '건너뜀',
    skillRetrying: '자동 복구 시도 중',
    skillTscFailed: 'TypeScript 컴파일 오류 수정 중',
    skillProgress: (current: number, total: number) => `${current}/${total}`,

    // 에러 복구 사용자 선택
    errorRecoveryTitle: '스킬 실행 실패',
    errorRecoveryMessage: (name: string, error: string) =>
      `${name} 실행 중 오류가 발생했습니다:\n${error}`,
    errorRetry: '재시도',
    errorSkip: '건너뛰기',
    errorAbort: '중단',

    // 건강 체크
    healthCheckTitle: '인증 정보 검증',
    healthCheckRunning: 'API 연결 테스트 중...',
    healthCheckDone: '검증 완료',
    healthCheckTelegramOk: (botName: string) => `Telegram Bot 연결 성공: ${botName}`,
    healthCheckTelegramFail: (error: string) => `Telegram Bot 연결 실패: ${error}`,
    healthCheckAnthropicOk: 'Anthropic API 연결 성공',
    healthCheckAnthropicFail: (error: string) => `Anthropic API 연결 실패: ${error}`,
    healthCheckContinue: '검증에 실패한 항목이 있습니다. 계속 진행하시겠습니까?',

    // 진행 상태 재개
    resumeFound: '이전 설정 진행 상태가 발견되었습니다.',
    resumeAsk: '이전 진행 상태를 이어서 계속하시겠습니까?',
    resumeYes: '이어서 계속',
    resumeNo: '처음부터 시작',
    resumeSkillsFrom: (count: number) => `완료된 스킬 ${count}개를 건너뛰고 이어서 실행합니다.`,

    // 스킬 검증
    validationOk: '모든 스킬 파일이 확인되었습니다.',
    validationMissing: (names: string) => `다음 스킬 파일이 누락되었습니다:\n${names}`,
    validationDepWarning: (episode: string, deps: string) =>
      `${episode}의 의존성 순서 경고: ${deps}가 뒤에 위치합니다.`,

    // 요약
    summaryTitle: '실행 결과 요약',
    summarySuccess: (count: number) => `성공: ${count}개`,
    summaryFailed: (count: number) => `실패: ${count}개`,
    summarySkipped: (count: number) => `건너뜀: ${count}개`,
    summaryDuration: (sec: number) => `총 소요 시간: ${sec}초`,
    summaryNextSteps: '다음 단계: npm run dev 로 봇을 실행하세요!',
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

    skillsTitle: 'Sequential Skill Execution',
    skillsStart: 'Running 11 skills sequentially...',
    skillRunning: 'Running',
    skillSuccess: 'Done',
    skillFailed: 'Failed',
    skillSkipped: 'Skipped',
    skillRetrying: 'Auto-recovery attempt',
    skillTscFailed: 'Fixing TypeScript compilation errors',
    skillProgress: (current: number, total: number) => `${current}/${total}`,

    errorRecoveryTitle: 'Skill Execution Failed',
    errorRecoveryMessage: (name: string, error: string) =>
      `Error during ${name}:\n${error}`,
    errorRetry: 'Retry',
    errorSkip: 'Skip',
    errorAbort: 'Abort',

    healthCheckTitle: 'Credential Verification',
    healthCheckRunning: 'Testing API connections...',
    healthCheckDone: 'Verification complete',
    healthCheckTelegramOk: (botName: string) => `Telegram Bot connected: ${botName}`,
    healthCheckTelegramFail: (error: string) => `Telegram Bot connection failed: ${error}`,
    healthCheckAnthropicOk: 'Anthropic API connected',
    healthCheckAnthropicFail: (error: string) => `Anthropic API connection failed: ${error}`,
    healthCheckContinue: 'Some verifications failed. Continue anyway?',

    resumeFound: 'Previous setup progress found.',
    resumeAsk: 'Resume from where you left off?',
    resumeYes: 'Resume',
    resumeNo: 'Start over',
    resumeSkillsFrom: (count: number) => `Skipping ${count} completed skill(s) and resuming.`,

    validationOk: 'All skill files verified.',
    validationMissing: (names: string) => `Missing skill files:\n${names}`,
    validationDepWarning: (episode: string, deps: string) =>
      `${episode} dependency order warning: ${deps} is positioned later.`,

    summaryTitle: 'Execution Summary',
    summarySuccess: (count: number) => `Success: ${count}`,
    summaryFailed: (count: number) => `Failed: ${count}`,
    summarySkipped: (count: number) => `Skipped: ${count}`,
    summaryDuration: (sec: number) => `Total duration: ${sec}s`,
    summaryNextSteps: 'Next: run npm run dev to start your bot!',
  },
} as const;

type MessageKey = keyof typeof messages.ko;

export function t<K extends MessageKey>(
  lang: Language,
  key: K,
): (typeof messages.ko)[K] {
  return messages[lang][key] as (typeof messages.ko)[K];
}
