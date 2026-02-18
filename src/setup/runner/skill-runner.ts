// 스킬 순차 실행 엔진 + 에이전틱 에러 복구
import fs from 'fs';
import path from 'path';
import { execFileSync } from 'child_process';
import * as p from '@clack/prompts';
import { query } from '@anthropic-ai/claude-code';
import type { Language, SkillMeta, SkillRunResult } from '../types.js';
import { t } from '../i18n.js';
import { logSkillStart, logSkillResult, logRetryAttempt, logTscFix } from '../ui/progress.js';
import { saveProgress, type SetupProgress } from './progress-store.js';
import { SKILL_SYSTEM_CONTEXT } from './skill-context.js';

// 스킬 실행 순서 (의존성 그래프 기반)
export const SKILL_ORDER: SkillMeta[] = [
  { name: 'phoneclaw-scaffold',       episode: 'EP01', title: '프로젝트 기반 구축' },
  { name: 'phoneclaw-telegram',       episode: 'EP02', title: 'Telegram 봇 연결' },
  { name: 'phoneclaw-database',       episode: 'EP03', title: 'SQLite 데이터베이스' },
  { name: 'phoneclaw-agent-local',    episode: 'EP04', title: 'Claude Agent' },
  { name: 'phoneclaw-message-loop',   episode: 'EP05', title: '메인 처리 루프' },
  { name: 'phoneclaw-mcp-tools',      episode: 'EP06', title: 'MCP 도구' },
  { name: 'phoneclaw-session-memory', episode: 'EP07', title: '대화 기억' },
  { name: 'phoneclaw-scheduler',      episode: 'EP08', title: '예약 작업' },
  { name: 'phoneclaw-multi-chat',     episode: 'EP09', title: '다중 채팅' },
  { name: 'phoneclaw-admin-commands', episode: 'EP10', title: '관리 명령어' },
  { name: 'phoneclaw-production',     episode: 'EP11', title: '프로덕션 배포' },
];

const MAX_AUTO_RETRIES = 2;

/** tsc --noEmit 실행 후 에러 출력 반환. 성공 시 null */
function runTypeCheck(cwd: string): string | null {
  try {
    execFileSync('npx', ['tsc', '--noEmit'], { cwd, stdio: 'pipe', timeout: 60_000 });
    return null;
  } catch (err: unknown) {
    if (err && typeof err === 'object') {
      // tsc는 에러를 stdout으로 출력하지만, 일부 환경에서 stderr로 갈 수 있음
      const e = err as { stdout?: Buffer; stderr?: Buffer };
      const stdout = e.stdout?.toString().trim() || '';
      const stderr = e.stderr?.toString().trim() || '';
      return stdout || stderr || 'TypeScript compilation failed';
    }
    return 'TypeScript compilation failed';
  }
}

/** SDK query()로 스킬 1개 실행 */
async function executeSkill(
  skill: SkillMeta,
  cwd: string,
  promptText: string,
  sessionId?: string,
): Promise<{ resultText: string; newSessionId?: string }> {
  let resultText = '';
  let newSessionId: string | undefined;

  for await (const message of query({
    prompt: promptText,
    options: {
      cwd,
      resume: sessionId,
      appendSystemPrompt: SKILL_SYSTEM_CONTEXT,
      allowedTools: ['Read', 'Write', 'Edit', 'Glob', 'Grep', 'Bash'],
      permissionMode: 'bypassPermissions',
      maxTurns: 50,
    },
  })) {
    if (message.type === 'system' && message.subtype === 'init') {
      newSessionId = message.session_id;
    }
    if (message.type === 'result') {
      const text = 'result' in message ? (message as { result?: string }).result : null;
      if (text) resultText = text;
    }
  }

  return { resultText, newSessionId };
}

/** 사용자에게 에러 복구 방법을 묻는다 */
async function askUserDecision(
  lang: Language,
  skill: SkillMeta,
  error: string,
): Promise<'retry' | 'skip' | 'abort'> {
  const msgFn = t(lang, 'errorRecoveryMessage');
  p.log.error(msgFn(skill.name, error));

  const result = await p.select({
    message: t(lang, 'errorRecoveryTitle'),
    options: [
      { value: 'retry' as const, label: t(lang, 'errorRetry') },
      { value: 'skip' as const, label: t(lang, 'errorSkip') },
      { value: 'abort' as const, label: t(lang, 'errorAbort') },
    ],
  });

  if (p.isCancel(result)) return 'abort';
  return result;
}

/** 스킬 1개 실행 + 에러 복구 */
async function runSingleSkill(
  skill: SkillMeta,
  lang: Language,
  cwd: string,
): Promise<SkillRunResult> {
  const startTime = Date.now();
  const skillPath = path.join(cwd, '.claude', 'skills', skill.name, 'SKILL.md');

  if (!fs.existsSync(skillPath)) {
    return {
      skill,
      success: false,
      durationMs: Date.now() - startTime,
      error: `SKILL.md not found: ${skillPath}`,
      retryCount: 0,
    };
  }

  const skillContent = fs.readFileSync(skillPath, 'utf-8');
  const initialPrompt = [
    '다음 스킬의 지시에 따라 코드를 생성/수정하세요.',
    '완료 후 검증 단계를 실행하여 결과를 확인하세요.',
    '',
    '---',
    skillContent,
  ].join('\n');

  let retryCount = 0;
  let sessionId: string | undefined;
  let lastError = '';

  // 최초 실행
  try {
    const { newSessionId } = await executeSkill(skill, cwd, initialPrompt);
    sessionId = newSessionId;

    // tsc 체크
    const tscError = runTypeCheck(cwd);
    if (!tscError) {
      return {
        skill,
        success: true,
        durationMs: Date.now() - startTime,
        retryCount: 0,
      };
    }
    lastError = tscError;
  } catch (err) {
    lastError = err instanceof Error ? err.message : String(err);
  }

  // 자동 복구 루프 (Layer 1 + Layer 2 통합, 최대 MAX_AUTO_RETRIES회)
  while (retryCount < MAX_AUTO_RETRIES) {
    retryCount++;
    logRetryAttempt(lang, skill, retryCount);

    const retryPrompt = lastError.includes('compilation')
      ? `TypeScript 컴파일 오류를 수정하세요:\n${lastError}`
      : [
          '이전 스킬 실행 중 다음 오류가 발생했습니다:',
          lastError,
          '오류를 분석하고 수정하세요.',
        ].join('\n');

    try {
      await executeSkill(skill, cwd, retryPrompt, sessionId);
      const checkError = runTypeCheck(cwd);
      if (!checkError) {
        return {
          skill,
          success: true,
          durationMs: Date.now() - startTime,
          retryCount,
        };
      }
      lastError = checkError;
    } catch (err) {
      lastError = err instanceof Error ? err.message : String(err);
    }
  }

  // Layer 3: 사용자 선택
  const decision = await askUserDecision(lang, skill, lastError);
  if (decision === 'retry') {
    try {
      await executeSkill(skill, cwd, initialPrompt);
      const finalCheck = runTypeCheck(cwd);
      return {
        skill,
        success: !finalCheck,
        durationMs: Date.now() - startTime,
        error: finalCheck ?? undefined,
        retryCount: retryCount + 1,
      };
    } catch (err) {
      return {
        skill,
        success: false,
        durationMs: Date.now() - startTime,
        error: err instanceof Error ? err.message : String(err),
        retryCount: retryCount + 1,
      };
    }
  }
  if (decision === 'skip') {
    return {
      skill,
      success: false,
      durationMs: Date.now() - startTime,
      error: 'skipped',
      retryCount,
    };
  }
  // abort
  return {
    skill,
    success: false,
    durationMs: Date.now() - startTime,
    error: 'aborted',
    retryCount,
  };
}

/** 11개 스킬 전체 순차 실행 (재개 지원) */
export async function runAllSkills(
  lang: Language,
  cwd: string,
  completedSkills: string[] = [],
  previousResults: SkillRunResult[] = [],
): Promise<SkillRunResult[]> {
  p.log.step(t(lang, 'skillsTitle'));
  p.log.info(t(lang, 'skillsStart'));

  const results: SkillRunResult[] = [...previousResults];
  const total = SKILL_ORDER.length;

  // 재개 시 완료된 스킬 건너뛰기
  if (completedSkills.length > 0) {
    const msgFn = t(lang, 'resumeSkillsFrom');
    p.log.info(msgFn(completedSkills.length));
  }

  for (let i = 0; i < total; i++) {
    const skill = SKILL_ORDER[i];

    // 이미 완료된 스킬 건너뛰기
    if (completedSkills.includes(skill.name)) {
      continue;
    }

    logSkillStart(lang, skill, i + 1, total);

    const result = await runSingleSkill(skill, lang, cwd);
    results.push(result);
    logSkillResult(lang, result);

    // 진행 상태 저장
    const currentCompleted = results
      .filter((r) => r.success)
      .map((r) => r.skill.name);

    const progress: SetupProgress = {
      currentStep: 'skills',
      language: lang,
      completedSkills: currentCompleted,
      skillResults: results,
      updatedAt: new Date().toISOString(),
    };
    saveProgress(cwd, progress);

    // abort 시 나머지 스킬 중단
    if (result.error === 'aborted') {
      break;
    }
  }

  return results;
}
