#!/usr/bin/env node
















import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import path from 'node:path';
import process from 'node:process';

const ROOT = path.resolve(import.meta.dirname, '..');
const args = process.argv.slice(2);
const has = (flag) => args.includes(flag);
const valueOf = (flag, fallback) => {
  const index = args.indexOf(flag);
  return index >= 0 && args[index + 1] ? args[index + 1] : fallback;
};

const skipBuild = has('--skip-build');
const fixtureOnly = has('--fixture-only');
const windowMs = valueOf('--window', '10000');


function run(command, commandArgs, env = {}) {
  const label = [command, ...commandArgs].join(' ');
  console.log(`\n> ${label}\n`);
  const result = spawnSync(command, commandArgs, {
    cwd: ROOT,
    stdio: 'inherit',
    env: { ...process.env, ...env },
    shell: false,
  });
  if (result.error) {
    console.error(`Failed to run ${label}: ${result.error.message}`);
    process.exit(1);
  }
  if (result.status !== 0) process.exit(result.status ?? 1);
}

const pnpm = process.platform === 'win32' ? 'pnpm.cmd' : 'pnpm';

if (!skipBuild) {
  run(pnpm, ['exec', 'wxt', 'build']);
  run(pnpm, ['exec', 'wxt', 'build'], { DI_E2E: '1' });
} else {
  for (const dir of ['.output/chrome-mv3', '.output-e2e/chrome-mv3']) {
    if (!existsSync(path.join(ROOT, dir))) {
      console.error(`--skip-build was passed but ${dir} does not exist. Run without it once.`);
      process.exit(1);
    }
  }
}

const scratch =
  process.env.CLAUDE_SCRATCH ?? path.join(ROOT, 'test-results', 'perf');

run(
  pnpm,
  [
    'exec',
    'playwright',
    'test',
    'e2e/perf-profile.spec.ts',
    '--reporter=list',
    '--output',
    path.join(scratch, 'pw-perf-profile'),
  ],
  {
    PERF_WRITE: '1',
    PERF_FULL: fixtureOnly ? '0' : '1',
    PERF_WINDOW_MS: windowMs,
    CLAUDE_SCRATCH: scratch,
  },
);

console.log('\nWrote store/PERF.md\n');
