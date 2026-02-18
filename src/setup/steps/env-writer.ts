// Step 4: .env 파일 생성
import fs from 'fs';
import path from 'path';
import * as p from '@clack/prompts';
import type { Language, WizardState } from '../types.js';
import { t } from '../i18n.js';

function buildEnvContent(state: WizardState): string {
  const lines: string[] = [
    '# === 필수 설정 ===',
    `TELEGRAM_BOT_TOKEN=${state.credentials.telegramBotToken}`,
    `ANTHROPIC_API_KEY=${state.credentials.anthropicApiKey}`,
    '',
    '# === 선택 설정 ===',
    `BOT_NAME=${state.settings.botName}`,
    `ANTHROPIC_MODEL=${state.settings.anthropicModel}`,
    `ANTHROPIC_BASE_URL=${state.settings.anthropicBaseUrl}`,
    `ADMIN_USER_IDS=${state.settings.adminUserIds}`,
    `LOG_LEVEL=${state.settings.logLevel}`,
    `AGENT_TIMEOUT=${state.settings.agentTimeout}`,
    `MAX_CONCURRENT_AGENTS=${state.settings.maxConcurrentAgents}`,
    `TZ=${state.settings.timezone}`,
    '',
  ];
  return lines.join('\n');
}

function maskValue(value: string): string {
  if (value.length <= 8) return '***';
  return value.slice(0, 8) + '***';
}

export async function writeEnvFile(
  state: WizardState,
  cwd: string,
): Promise<boolean> {
  p.log.step(t(state.language, 'envTitle'));

  const envPath = path.join(cwd, '.env');

  // 기존 .env 존재 시 백업 후 확인
  if (fs.existsSync(envPath)) {
    const overwrite = await p.confirm({
      message: t(state.language, 'envExists'),
    });

    if (p.isCancel(overwrite) || !overwrite) {
      p.log.warn(t(state.language, 'cancelled'));
      return false;
    }

    // 기존 파일 백업
    const backupPath = envPath + '.bak';
    fs.copyFileSync(envPath, backupPath);
  }

  const content = buildEnvContent(state);
  fs.writeFileSync(envPath, content, { encoding: 'utf-8', mode: 0o600 });

  // 설정 요약 표시
  p.note(
    [
      `TELEGRAM_BOT_TOKEN = ${maskValue(state.credentials.telegramBotToken)}`,
      `ANTHROPIC_API_KEY  = ${maskValue(state.credentials.anthropicApiKey)}`,
      `BOT_NAME           = ${state.settings.botName}`,
      `ANTHROPIC_MODEL    = ${state.settings.anthropicModel}`,
      `LOG_LEVEL          = ${state.settings.logLevel}`,
      `TZ                 = ${state.settings.timezone}`,
      state.settings.adminUserIds ? `ADMIN_USER_IDS     = ${state.settings.adminUserIds}` : '',
    ].filter(Boolean).join('\n'),
    t(state.language, 'envSettingSummary'),
  );

  p.log.success(t(state.language, 'envCreated'));
  return true;
}
