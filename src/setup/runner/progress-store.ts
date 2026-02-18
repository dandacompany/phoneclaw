// 설정 마법사 진행 상태 저장/복원
import fs from 'fs';
import path from 'path';
import type { Language, SkillRunResult } from '../types.js';

export interface SetupProgress {
  /** 현재 단계: 'credentials' | 'settings' | 'env' | 'skills' | 'done' */
  currentStep: string;
  /** 선택된 언어 */
  language: Language;
  /** 완료된 스킬 이름 목록 */
  completedSkills: string[];
  /** 스킬 실행 결과 */
  skillResults: SkillRunResult[];
  /** 마지막 업데이트 시각 */
  updatedAt: string;
}

const PROGRESS_FILE = 'setup-progress.json';

function getProgressPath(cwd: string): string {
  const dataDir = path.join(cwd, 'data');
  fs.mkdirSync(dataDir, { recursive: true });
  return path.join(dataDir, PROGRESS_FILE);
}

/** 진행 상태 저장 */
export function saveProgress(cwd: string, progress: SetupProgress): void {
  const filePath = getProgressPath(cwd);
  fs.writeFileSync(filePath, JSON.stringify(progress, null, 2), 'utf-8');
}

/** 진행 상태 로드. 없으면 null */
export function loadProgress(cwd: string): SetupProgress | null {
  const filePath = getProgressPath(cwd);
  if (!fs.existsSync(filePath)) return null;

  try {
    const raw = fs.readFileSync(filePath, 'utf-8');
    return JSON.parse(raw) as SetupProgress;
  } catch {
    return null;
  }
}

/** 진행 상태 삭제 (설정 완료 시) */
export function clearProgress(cwd: string): void {
  const filePath = getProgressPath(cwd);
  if (fs.existsSync(filePath)) {
    fs.unlinkSync(filePath);
  }
}
