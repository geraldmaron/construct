#!/usr/bin/env node
/**
 * scripts/visual-terminal-replay.mjs — paced construct replay in a real terminal.
 *
 * Run inside Terminal.app (or iTerm) so ANSI colors and the chat banner render
 * natively. Opened automatically when you pass --terminal to visual-live-runner.
 */

import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { defaultSpawnEnv } from '../tests/visual/lib/session-runner.mjs';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PACE_MS = Number(process.env.CONSTRUCT_VISUAL_PACE_MS || 900);

const STAGES = [
  { name: 'help', lines: ['/help', '/exit'] },
  { name: 'layers', lines: ['/layers', '/exit'] },
  { name: 'settings', lines: ['/settings', '/exit'] },
  { name: 'context', lines: ['/context', '/exit'] },
  { name: 'host', lines: ['/host', '/exit'] },
  { name: 'usage', lines: ['/usage', '/exit'] },
  { name: 'skills', lines: ['/skills suggest prd', '/exit'] },
];

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function main() {
  const env = defaultSpawnEnv();
  console.log('\n\x1b[1mConstruct visual terminal replay\x1b[0m');
  console.log(`Pace: ${PACE_MS}ms between commands · Ctrl+C to abort\n`);

  for (const stage of STAGES) {
    console.log(`\x1b[36m── stage: ${stage.name} ──\x1b[0m\n`);
    const child = spawn(process.execPath, ['bin/construct'], {
      cwd: REPO_ROOT,
      env,
      stdio: ['pipe', 'inherit', 'inherit'],
    });

    await sleep(400);
    for (const line of stage.lines) {
      console.log(`\x1b[35m▶ you ▸ ${line}\x1b[0m`);
      child.stdin.write(`${line}\n`);
      await sleep(PACE_MS);
    }

    await new Promise((resolve) => {
      child.on('close', resolve);
      setTimeout(() => child.kill('SIGTERM'), 30_000);
    });
    await sleep(300);
  }

  console.log('\n\x1b[32mReplay complete.\x1b[0m\n');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
