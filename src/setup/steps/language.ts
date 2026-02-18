// Step 1: 언어 선택
import * as p from '@clack/prompts';
import type { Language } from '../types.js';

export async function selectLanguage(): Promise<Language> {
  const result = await p.select({
    message: '언어를 선택하세요 / Select language',
    options: [
      { value: 'ko' as const, label: '한국어' },
      { value: 'en' as const, label: 'English' },
    ],
  });

  if (p.isCancel(result)) {
    p.cancel('Setup cancelled.');
    process.exit(0);
  }

  return result;
}
