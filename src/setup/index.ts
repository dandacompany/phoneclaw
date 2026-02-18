// PhoneClaw TUI 설정 마법사 - 메인 오케스트레이터
import * as p from '@clack/prompts';
import { showBanner } from './ui/banner.js';
import { selectLanguage } from './steps/language.js';
import { collectCredentials } from './steps/credentials.js';
import { collectSettings } from './steps/settings.js';
import { writeEnvFile } from './steps/env-writer.js';
import { runHealthCheck } from './steps/health-check.js';
import { t } from './i18n.js';

async function main() {
  showBanner();

  // Step 1: 언어 선택
  const language = await selectLanguage();
  p.log.success(t(language, 'welcome'));

  // Step 2: 인증 설정
  const credentials = await collectCredentials(language);

  // Step 2.5: 건강 체크 (API 사전 검증)
  const healthOk = await runHealthCheck(language, credentials);
  if (!healthOk) {
    p.outro(t(language, 'cancelled'));
    return;
  }

  // Step 3: 선택 설정
  const settings = await collectSettings(language);

  // Step 4: .env 생성
  const envWritten = await writeEnvFile({ language, credentials, settings }, process.cwd());
  if (!envWritten) {
    p.outro(t(language, 'cancelled'));
    return;
  }

  // 완료
  p.log.success(t(language, 'setupComplete'));
  p.log.info(`  ${t(language, 'setupNextDev')}`);
  p.log.info(`  ${t(language, 'setupNextProd')}`);
  p.outro(t(language, 'done'));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
