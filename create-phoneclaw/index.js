#!/usr/bin/env node

// create-phoneclaw — degit 방식 프로젝트 스캐폴딩 CLI
// npx create-phoneclaw [directory]

import { execFileSync } from 'node:child_process';
import { existsSync, rmSync, mkdirSync, writeFileSync, unlinkSync } from 'node:fs';
import { resolve, basename, join } from 'node:path';
import { tmpdir } from 'node:os';

// ─── 설정 ────────────────────────────────────────
const REPO = 'dandacompany/phoneclaw';
const BRANCH = 'main';
const TARBALL_URL = `https://github.com/${REPO}/archive/refs/heads/${BRANCH}.tar.gz`;

// ─── ANSI 색상 ───────────────────────────────────
const bold = (s) => `\x1b[1m${s}\x1b[0m`;
const green = (s) => `\x1b[32m${s}\x1b[0m`;
const cyan = (s) => `\x1b[36m${s}\x1b[0m`;
const red = (s) => `\x1b[31m${s}\x1b[0m`;
const dim = (s) => `\x1b[2m${s}\x1b[0m`;

// ─── 메인 ────────────────────────────────────────
async function main() {
  const targetName = process.argv[2] || 'phoneclaw';
  const targetDir = resolve(targetName);

  console.log();
  console.log(bold('  PhoneClaw') + dim(' — AI assistant bot for your phone'));
  console.log();

  // 1. 디렉토리 존재 확인
  if (existsSync(targetDir)) {
    console.error(red(`  ✗ Directory "${targetName}" already exists.`));
    console.error(dim('    Choose a different name or remove the existing directory.'));
    process.exit(1);
  }

  // 2. tarball 다운로드 (Node 20+ built-in fetch)
  console.log(dim(`  Downloading from ${REPO}...`));

  let tarballBuffer;
  try {
    const res = await fetch(TARBALL_URL, { redirect: 'follow' });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    tarballBuffer = Buffer.from(await res.arrayBuffer());
  } catch (err) {
    console.error(red(`  ✗ Download failed: ${err.message}`));
    console.error(dim(`    Check that ${REPO} exists and is accessible.`));
    process.exit(1);
  }

  // 3. 임시 파일에 저장 후 tar 압축 해제 (execFileSync로 셸 인젝션 방지)
  const tmpFile = join(tmpdir(), `phoneclaw-${Date.now()}.tar.gz`);

  try {
    writeFileSync(tmpFile, tarballBuffer);
    mkdirSync(targetDir, { recursive: true });

    execFileSync('tar', ['xzf', tmpFile, '--strip-components=1', '-C', targetDir], {
      stdio: 'pipe',
      timeout: 30_000,
    });
  } catch (err) {
    rmSync(targetDir, { recursive: true, force: true });
    console.error(red(`  ✗ Extraction failed: ${err.message}`));
    process.exit(1);
  } finally {
    if (existsSync(tmpFile)) unlinkSync(tmpFile);
  }

  // 4. 정리 — 스캐폴딩 CLI 자체와 개발 전용 파일 제거
  const cleanup = ['create-phoneclaw', 'CLAUDE.md'];
  for (const name of cleanup) {
    const p = resolve(targetDir, name);
    if (existsSync(p)) {
      rmSync(p, { recursive: true, force: true });
    }
  }

  // 5. 완료 안내
  const relativeDir = basename(targetDir);

  console.log(green('  ✓ PhoneClaw created successfully!'));
  console.log();
  console.log('  Next steps:');
  console.log();
  console.log(cyan(`    cd ${relativeDir}`));
  console.log(cyan('    npm install'));
  console.log(cyan('    npm run setup'));
  console.log();
  console.log(dim('  The setup wizard will guide you through'));
  console.log(dim('  Telegram bot token, API key, and skill execution.'));
  console.log();
}

main().catch((err) => {
  console.error(red(`  ✗ ${err.message}`));
  process.exit(1);
});
