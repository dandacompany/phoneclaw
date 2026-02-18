// PhoneClaw TUI 설정 마법사 - 메인 오케스트레이터
import * as p from '@clack/prompts';
import { showBanner } from './ui/banner.js';
import { showSummary } from './ui/progress.js';
import { selectLanguage } from './steps/language.js';
import { collectCredentials } from './steps/credentials.js';
import { collectSettings } from './steps/settings.js';
import { writeEnvFile } from './steps/env-writer.js';
import { runHealthCheck } from './steps/health-check.js';
import { runAllSkills } from './runner/skill-runner.js';
import { loadProgress, clearProgress } from './runner/progress-store.js';
import { validateSkills, showValidationResult } from './runner/skill-validator.js';
import { t } from './i18n.js';
import type { Language, WizardState } from './types.js';

async function main() {
  showBanner();

  const cwd = process.cwd();

  // 이전 진행 상태 확인
  const savedProgress = loadProgress(cwd);
  if (savedProgress && savedProgress.completedSkills.length > 0) {
    p.log.info(t(savedProgress.language, 'resumeFound'));

    const resumeChoice = await p.select({
      message: t(savedProgress.language, 'resumeAsk'),
      options: [
        { value: 'resume' as const, label: t(savedProgress.language, 'resumeYes') },
        { value: 'restart' as const, label: t(savedProgress.language, 'resumeNo') },
      ],
    });

    if (!p.isCancel(resumeChoice) && resumeChoice === 'resume') {
      return await resumeFromProgress(savedProgress, cwd);
    }

    // 처음부터 시작 → 진행 상태 삭제
    clearProgress(cwd);
  }

  // === 신규 설정 플로우 ===

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
  const envWritten = await writeEnvFile({ language, credentials, settings }, cwd);
  if (!envWritten) {
    p.outro(t(language, 'cancelled'));
    return;
  }

  // Step 4.5: 스킬 파일 검증
  const validation = validateSkills(cwd);
  showValidationResult(language, validation);

  // Step 5: 스킬 순차 실행
  const results = await runAllSkills(language, cwd);

  // 완료 → 진행 상태 삭제
  clearProgress(cwd);

  // 완료 요약
  showSummary(language, results);
  p.outro(t(language, 'done'));
}

/** 이전 진행 상태에서 스킬 실행 재개 */
async function resumeFromProgress(
  saved: NonNullable<ReturnType<typeof loadProgress>>,
  cwd: string,
): Promise<void> {
  const lang: Language = saved.language;

  // 스킬 파일 검증
  const validation = validateSkills(cwd, saved.completedSkills);
  showValidationResult(lang, validation);

  // 스킬 실행 재개
  const results = await runAllSkills(
    lang,
    cwd,
    saved.completedSkills,
    saved.skillResults,
  );

  // 완료 → 진행 상태 삭제
  clearProgress(cwd);

  showSummary(lang, results);
  p.outro(t(lang, 'done'));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
