// Step 3: 선택 설정
import * as p from '@clack/prompts';
import type { Language, WizardState } from '../types.js';
import { t } from '../i18n.js';

export async function collectSettings(
  lang: Language,
): Promise<WizardState['settings']> {
  p.log.step(t(lang, 'settingsTitle'));

  const botName = await p.text({
    message: t(lang, 'enterBotName'),
    defaultValue: 'PhoneClaw',
    placeholder: 'PhoneClaw',
  });
  if (p.isCancel(botName)) {
    p.cancel(t(lang, 'cancelled'));
    process.exit(0);
  }

  const anthropicModel = await p.select({
    message: t(lang, 'selectModel'),
    options: [
      { value: 'claude-sonnet-4-20250514', label: 'Claude Sonnet 4' },
      { value: 'claude-haiku-4-20250414', label: 'Claude Haiku 4' },
      { value: 'claude-opus-4-20250514', label: 'Claude Opus 4' },
    ],
  });
  if (p.isCancel(anthropicModel)) {
    p.cancel(t(lang, 'cancelled'));
    process.exit(0);
  }

  const anthropicBaseUrl = await p.text({
    message: t(lang, 'enterBaseUrl'),
    defaultValue: '',
    placeholder: 'https://...',
  });
  if (p.isCancel(anthropicBaseUrl)) {
    p.cancel(t(lang, 'cancelled'));
    process.exit(0);
  }

  const adminUserIds = await p.text({
    message: t(lang, 'enterAdminIds'),
    defaultValue: '',
    placeholder: '123456789,987654321',
  });
  if (p.isCancel(adminUserIds)) {
    p.cancel(t(lang, 'cancelled'));
    process.exit(0);
  }

  const logLevel = await p.select({
    message: t(lang, 'selectLogLevel'),
    options: [
      { value: 'info', label: 'info' },
      { value: 'debug', label: 'debug' },
      { value: 'warn', label: 'warn' },
      { value: 'error', label: 'error' },
      { value: 'trace', label: 'trace' },
    ],
  });
  if (p.isCancel(logLevel)) {
    p.cancel(t(lang, 'cancelled'));
    process.exit(0);
  }

  const timezone = await p.text({
    message: t(lang, 'enterTimezone'),
    defaultValue: 'Asia/Seoul',
    placeholder: 'Asia/Seoul',
  });
  if (p.isCancel(timezone)) {
    p.cancel(t(lang, 'cancelled'));
    process.exit(0);
  }

  return {
    botName,
    anthropicModel,
    anthropicBaseUrl,
    adminUserIds,
    logLevel,
    agentTimeout: '300000',
    maxConcurrentAgents: '1',
    timezone,
  };
}
