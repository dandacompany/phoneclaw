// 스킬 실행 전 사전 검증 (파일 존재 + 의존성 경고)
import fs from 'fs';
import path from 'path';
import * as p from '@clack/prompts';
import type { Language, SkillMeta } from '../types.js';
import { t } from '../i18n.js';
import { SKILL_ORDER } from './skill-runner.js';

/** SKILL.md에서 "EP01~EP04 완료 필수" 패턴의 의존성 파싱 */
function parseDependencies(skillContent: string): string[] {
  // "EP01 완료 필수", "EP01~EP04 완료 필수", "EP01~EP10 완료 필수" 패턴 매칭
  const rangePattern = /EP(\d+)~EP(\d+)\s+완료\s*필수/g;
  const singlePattern = /EP(\d+)\s+완료\s*필수/g;
  const deps: string[] = [];

  let match;
  while ((match = rangePattern.exec(skillContent)) !== null) {
    const start = parseInt(match[1], 10);
    const end = parseInt(match[2], 10);
    for (let i = start; i <= end; i++) {
      const ep = `EP${String(i).padStart(2, '0')}`;
      if (!deps.includes(ep)) deps.push(ep);
    }
  }

  while ((match = singlePattern.exec(skillContent)) !== null) {
    const ep = `EP${String(parseInt(match[1], 10)).padStart(2, '0')}`;
    if (!deps.includes(ep)) deps.push(ep);
  }

  return deps;
}

export interface ValidationResult {
  valid: boolean;
  missingSkills: SkillMeta[];
  dependencyWarnings: Array<{ skill: SkillMeta; missingDeps: string[] }>;
}

/** 스킬 실행 전 전체 검증 */
export function validateSkills(
  cwd: string,
  completedSkills: string[] = [],
): ValidationResult {
  const missingSkills: SkillMeta[] = [];
  const dependencyWarnings: ValidationResult['dependencyWarnings'] = [];

  for (const skill of SKILL_ORDER) {
    const skillPath = path.join(cwd, '.claude', 'skills', skill.name, 'SKILL.md');

    if (!fs.existsSync(skillPath)) {
      missingSkills.push(skill);
      continue;
    }

    // 의존성 파싱
    const content = fs.readFileSync(skillPath, 'utf-8');
    const deps = parseDependencies(content);

    // 이 스킬 이전의 에피소드 중 SKILL_ORDER에 포함된 것들 확인
    const currentIdx = SKILL_ORDER.indexOf(skill);

    // 의존 에피소드가 SKILL_ORDER에서 현재보다 뒤에 있으면 순서 경고
    const orderViolations = deps.filter((dep) => {
      const depSkill = SKILL_ORDER.find((s) => s.episode === dep);
      if (!depSkill) return false;
      return SKILL_ORDER.indexOf(depSkill) > currentIdx;
    });

    if (orderViolations.length > 0) {
      dependencyWarnings.push({ skill, missingDeps: orderViolations });
    }
  }

  return {
    valid: missingSkills.length === 0 && dependencyWarnings.length === 0,
    missingSkills,
    dependencyWarnings,
  };
}

/** 검증 결과를 TUI로 표시 */
export function showValidationResult(
  lang: Language,
  result: ValidationResult,
): void {
  if (result.missingSkills.length > 0) {
    const names = result.missingSkills
      .map((s) => `  - ${s.episode}: ${s.name}`)
      .join('\n');
    const msgFn = t(lang, 'validationMissing');
    p.log.warn(msgFn(names));
  }

  if (result.dependencyWarnings.length > 0) {
    for (const warn of result.dependencyWarnings) {
      const msgFn = t(lang, 'validationDepWarning');
      p.log.warn(msgFn(warn.skill.episode, warn.missingDeps.join(', ')));
    }
  }

  if (result.valid) {
    p.log.success(t(lang, 'validationOk'));
  }
}
