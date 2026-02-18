import fs from 'fs';
import path from 'path';

import { CHATS_DIR } from '../config.js';
import { logger } from '../logger.js';

const PERSONA_FILENAME = 'PERSONA.md';

/**
 * PERSONA.md 경로를 반환한다.
 */
export function personaPath(chatFolder: string): string {
  return path.join(CHATS_DIR, chatFolder, PERSONA_FILENAME);
}

/**
 * 상견례(bootstrap)가 완료되었는지 확인한다.
 * PERSONA.md가 존재하고, 기본 템플릿이 아닌 실제 내용이 있으면 true.
 */
export function isBootstrapped(chatFolder: string): boolean {
  const filePath = personaPath(chatFolder);
  if (!fs.existsSync(filePath)) return false;
  const content = fs.readFileSync(filePath, 'utf-8').trim();
  // 빈 파일이거나 기본 템플릿만 있으면 미완료
  return content.length > 0 && !content.startsWith('<!-- BOOTSTRAP_PENDING -->');
}

/**
 * PERSONA.md 내용을 로드한다. 없으면 빈 문자열 반환.
 */
export function loadPersona(chatFolder: string): string {
  const filePath = personaPath(chatFolder);
  if (!fs.existsSync(filePath)) return '';
  return fs.readFileSync(filePath, 'utf-8');
}

/**
 * PERSONA.md를 저장한다. 에이전트가 상견례 후 호출.
 */
export function savePersona(chatFolder: string, content: string): void {
  const filePath = personaPath(chatFolder);
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, content, 'utf-8');
  logger.info({ chatFolder }, '페르소나 저장 완료');
}

/**
 * 빈 PERSONA.md (부트스트랩 대기 상태) 생성.
 * registerChat 시 호출.
 */
export function createPendingPersona(chatFolder: string): void {
  const filePath = personaPath(chatFolder);
  if (fs.existsSync(filePath)) return;
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, '<!-- BOOTSTRAP_PENDING -->\n', 'utf-8');
  logger.debug({ chatFolder }, '페르소나 부트스트랩 대기 생성');
}
