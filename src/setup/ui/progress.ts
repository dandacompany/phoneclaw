// 스킬 실행 진행률 표시
import * as p from '@clack/prompts';
import type { Language, SkillMeta, SkillRunResult } from '../types.js';
import { t } from '../i18n.js';

function formatDuration(ms: number): string {
  const sec = Math.round(ms / 1000);
  if (sec < 60) return `${sec}s`;
  const min = Math.floor(sec / 60);
  const remainSec = sec % 60;
  return `${min}m ${remainSec}s`;
}

const STATUS_ICONS = {
  success: '\u2713',  // ✓
  failed: '\u2717',   // ✗
  skipped: '\u2013',  // –
  running: '\u25CC',  // ◌
  pending: '\u25CB',  // ○
} as const;

export function logSkillStart(
  lang: Language,
  skill: SkillMeta,
  current: number,
  total: number,
): void {
  const progress = t(lang, 'skillProgress')(current, total);
  p.log.step(`[${progress}] ${skill.episode}: ${skill.title} - ${t(lang, 'skillRunning')}`);
}

export function logSkillResult(
  lang: Language,
  result: SkillRunResult,
): void {
  const duration = formatDuration(result.durationMs);
  if (result.success) {
    p.log.success(`${STATUS_ICONS.success} ${result.skill.episode}: ${result.skill.title} (${duration})`);
  } else if (result.error === 'skipped') {
    p.log.warn(`${STATUS_ICONS.skipped} ${result.skill.episode}: ${result.skill.title} - ${t(lang, 'skillSkipped')}`);
  } else {
    p.log.error(`${STATUS_ICONS.failed} ${result.skill.episode}: ${result.skill.title} - ${result.error ?? t(lang, 'skillFailed')}`);
  }
}

export function logRetryAttempt(
  lang: Language,
  skill: SkillMeta,
  attempt: number,
): void {
  p.log.warn(`${STATUS_ICONS.running} ${skill.episode}: ${t(lang, 'skillRetrying')} (${attempt}/2)`);
}

export function logTscFix(lang: Language, skill: SkillMeta): void {
  p.log.warn(`${STATUS_ICONS.running} ${skill.episode}: ${t(lang, 'skillTscFailed')}`);
}

export function showSummary(
  lang: Language,
  results: SkillRunResult[],
): void {
  const successCount = results.filter((r) => r.success).length;
  const failedCount = results.filter((r) => !r.success && r.error !== 'skipped').length;
  const skippedCount = results.filter((r) => r.error === 'skipped').length;
  const totalMs = results.reduce((sum, r) => sum + r.durationMs, 0);
  const totalSec = Math.round(totalMs / 1000);

  p.note(
    [
      t(lang, 'summarySuccess')(successCount),
      t(lang, 'summaryFailed')(failedCount),
      t(lang, 'summarySkipped')(skippedCount),
      t(lang, 'summaryDuration')(totalSec),
    ].join('\n'),
    t(lang, 'summaryTitle'),
  );

  if (failedCount === 0) {
    p.log.success(t(lang, 'summaryNextSteps'));
  }
}
