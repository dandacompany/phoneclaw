// Sequential skill execution engine + agentic error recovery
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

// Skill execution order (based on dependency graph)
export const SKILL_ORDER: SkillMeta[] = [
  { name: 'phoneclaw-scaffold',       episode: 'EP01', title: 'Project Scaffolding' },
  { name: 'phoneclaw-telegram',       episode: 'EP02', title: 'Telegram Bot Connection' },
  { name: 'phoneclaw-database',       episode: 'EP03', title: 'SQLite Database' },
  { name: 'phoneclaw-agent-local',    episode: 'EP04', title: 'Claude Agent' },
  { name: 'phoneclaw-message-loop',   episode: 'EP05', title: 'Main Message Loop' },
  { name: 'phoneclaw-mcp-tools',      episode: 'EP06', title: 'MCP Tools' },
  { name: 'phoneclaw-session-memory', episode: 'EP07', title: 'Session Memory' },
  { name: 'phoneclaw-scheduler',      episode: 'EP08', title: 'Scheduled Tasks' },
  { name: 'phoneclaw-multi-chat',     episode: 'EP09', title: 'Multi-Chat Support' },
  { name: 'phoneclaw-admin-commands', episode: 'EP10', title: 'Admin Commands' },
  { name: 'phoneclaw-production',     episode: 'EP11', title: 'Production Deployment' },
];

const MAX_AUTO_RETRIES = 2;

/** Run tsc --noEmit and return error output. Returns null on success. */
function runTypeCheck(cwd: string): string | null {
  try {
    execFileSync('npx', ['tsc', '--noEmit'], { cwd, stdio: 'pipe', timeout: 60_000 });
    return null;
  } catch (err: unknown) {
    if (err && typeof err === 'object') {
      // tsc outputs errors to stdout, but may use stderr in some environments
      const e = err as { stdout?: Buffer; stderr?: Buffer };
      const stdout = e.stdout?.toString().trim() || '';
      const stderr = e.stderr?.toString().trim() || '';
      return stdout || stderr || 'TypeScript compilation failed';
    }
    return 'TypeScript compilation failed';
  }
}

/** Execute a single skill via SDK query() */
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

/** Ask user how to handle error recovery */
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

/** Execute a single skill + error recovery */
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
    'Follow the instructions in this skill to generate/modify code.',
    'After completion, run the verification steps to confirm the results.',
    '',
    '---',
    skillContent,
  ].join('\n');

  let retryCount = 0;
  let sessionId: string | undefined;
  let lastError = '';

  // Initial execution
  try {
    const { newSessionId } = await executeSkill(skill, cwd, initialPrompt);
    sessionId = newSessionId;

    // tsc check
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

  // Auto-recovery loop (Layer 1 + Layer 2 unified, max MAX_AUTO_RETRIES)
  while (retryCount < MAX_AUTO_RETRIES) {
    retryCount++;
    logRetryAttempt(lang, skill, retryCount);

    const retryPrompt = lastError.includes('compilation')
      ? `Fix the TypeScript compilation errors:\n${lastError}`
      : [
          'The following error occurred during the previous skill execution:',
          lastError,
          'Analyze and fix the error.',
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

  // Layer 3: User decision
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

/** Execute all 11 skills sequentially (with resume support) */
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

  // Skip completed skills on resume
  if (completedSkills.length > 0) {
    const msgFn = t(lang, 'resumeSkillsFrom');
    p.log.info(msgFn(completedSkills.length));
  }

  for (let i = 0; i < total; i++) {
    const skill = SKILL_ORDER[i];

    // Skip already completed skills
    if (completedSkills.includes(skill.name)) {
      continue;
    }

    logSkillStart(lang, skill, i + 1, total);

    const result = await runSingleSkill(skill, lang, cwd);
    results.push(result);
    logSkillResult(lang, result);

    // Save progress
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

    // Stop remaining skills on abort
    if (result.error === 'aborted') {
      break;
    }
  }

  return results;
}
