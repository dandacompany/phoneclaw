// 인증 정보 사전 검증 (Telegram Bot Token + Anthropic API Key)
import * as p from '@clack/prompts';
import type { Language, WizardState } from '../types.js';
import { t } from '../i18n.js';

interface HealthCheckResult {
  telegram: { ok: boolean; botName?: string; error?: string };
  anthropic: { ok: boolean; error?: string };
}

/** Telegram Bot Token 검증 - getMe API 호출 */
async function validateTelegram(token: string): Promise<HealthCheckResult['telegram']> {
  try {
    const res = await fetch(`https://api.telegram.org/bot${token}/getMe`, {
      signal: AbortSignal.timeout(10_000),
    });
    const data = await res.json() as { ok: boolean; result?: { first_name: string }; description?: string };

    if (data.ok && data.result) {
      return { ok: true, botName: data.result.first_name };
    }
    return { ok: false, error: data.description || 'Unknown error' };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : 'Network error' };
  }
}

/** Anthropic API Key 검증 - 최소 요청으로 인증 확인 */
async function validateAnthropic(
  apiKey: string,
  baseUrl?: string,
): Promise<HealthCheckResult['anthropic']> {
  const url = baseUrl
    ? `${baseUrl.replace(/\/$/, '')}/v1/messages`
    : 'https://api.anthropic.com/v1/messages';

  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 1,
        messages: [{ role: 'user', content: 'hi' }],
      }),
      signal: AbortSignal.timeout(15_000),
    });

    if (res.ok) {
      return { ok: true };
    }

    // 401 = 잘못된 키, 403 = 권한 없음
    if (res.status === 401 || res.status === 403) {
      const data = await res.json().catch(() => null) as { error?: { message?: string } } | null;
      return { ok: false, error: data?.error?.message || `HTTP ${res.status}` };
    }

    // 429 = 속도 제한이지만 키 자체는 유효
    if (res.status === 429) {
      return { ok: true };
    }

    // 다른 에러 (500 등)도 키 자체가 인증은 된 것
    if (res.status >= 500) {
      return { ok: true };
    }

    return { ok: false, error: `HTTP ${res.status}` };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : 'Network error' };
  }
}

/** 건강 체크 실행 - 인증 정보 수집 직후 호출 */
export async function runHealthCheck(
  lang: Language,
  credentials: WizardState['credentials'],
  baseUrl?: string,
): Promise<boolean> {
  p.log.step(t(lang, 'healthCheckTitle'));

  const s = p.spinner();
  s.start(t(lang, 'healthCheckRunning'));

  const [telegram, anthropic] = await Promise.all([
    validateTelegram(credentials.telegramBotToken),
    validateAnthropic(credentials.anthropicApiKey, baseUrl),
  ]);

  s.stop(t(lang, 'healthCheckDone'));

  // Telegram 결과
  if (telegram.ok) {
    const msgFn = t(lang, 'healthCheckTelegramOk');
    p.log.success(msgFn(telegram.botName ?? 'Bot'));
  } else {
    const msgFn = t(lang, 'healthCheckTelegramFail');
    p.log.error(msgFn(telegram.error ?? 'Unknown'));
  }

  // Anthropic 결과
  if (anthropic.ok) {
    p.log.success(t(lang, 'healthCheckAnthropicOk'));
  } else {
    const msgFn = t(lang, 'healthCheckAnthropicFail');
    p.log.error(msgFn(anthropic.error ?? 'Unknown'));
  }

  // 하나라도 실패 시 계속 진행할지 확인
  if (!telegram.ok || !anthropic.ok) {
    const proceed = await p.confirm({
      message: t(lang, 'healthCheckContinue'),
    });

    if (p.isCancel(proceed) || !proceed) {
      return false;
    }
  }

  return true;
}
