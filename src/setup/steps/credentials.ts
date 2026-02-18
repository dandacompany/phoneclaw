// Step 2: 인증 설정
import * as p from '@clack/prompts';
import type { Language, WizardState } from '../types.js';
import { t } from '../i18n.js';

// Telegram Bot Token: 숫자:영문숫자+하이픈+언더스코어
const TELEGRAM_TOKEN_PATTERN = /^\d+:[A-Za-z0-9_-]+$/;
// Anthropic API Key: sk-ant- 접두사
const ANTHROPIC_KEY_PREFIX = 'sk-ant-';

export async function collectCredentials(
  lang: Language,
): Promise<WizardState['credentials']> {
  p.log.step(t(lang, 'credentialsTitle'));

  const telegramBotToken = await p.password({
    message: t(lang, 'enterTelegramToken'),
    validate(value) {
      if (!value) return t(lang, 'telegramTokenRequired');
      if (!TELEGRAM_TOKEN_PATTERN.test(value)) return t(lang, 'telegramTokenInvalid');
    },
  });

  if (p.isCancel(telegramBotToken)) {
    p.cancel(t(lang, 'cancelled'));
    process.exit(0);
  }

  const anthropicApiKey = await p.password({
    message: t(lang, 'enterAnthropicKey'),
    validate(value) {
      if (!value) return t(lang, 'anthropicKeyRequired');
      if (!value.startsWith(ANTHROPIC_KEY_PREFIX)) return t(lang, 'anthropicKeyInvalid');
    },
  });

  if (p.isCancel(anthropicApiKey)) {
    p.cancel(t(lang, 'cancelled'));
    process.exit(0);
  }

  return { telegramBotToken, anthropicApiKey };
}
