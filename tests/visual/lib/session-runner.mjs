/**
 * tests/visual/lib/session-runner.mjs — spawn construct chat with scripted stdin.
 *
 * Drives slash commands and short interactions against the real binary in an
 * isolated HOME. Used for hermetic visual stages and witness-mode replays.
 */

import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { stripAnsi } from './depth-rubric.mjs';
import { isolationEnv } from '../../helpers/isolation-contract.mjs';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..');

export function createVisualHome() {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'construct-visual-'));
  fs.mkdirSync(path.join(home, '.config', 'construct'), { recursive: true });
  return home;
}

export function defaultSpawnEnv(extra = {}) {
  const home = extra.HOME || createVisualHome();
  return isolationEnv(home, {
    CONSTRUCT_SKIP_BOOTSTRAP_PROBE: '1',
    BOOTSTRAP_CHECKED: '1',
    TERM: 'xterm-256color',
    ...extra,
    HOME: home,
    CX_HOME_OVERRIDE: home,
  });
}

export function runConstructScript(lines, {
  cwd = REPO_ROOT,
  env = null,
  timeoutMs = 45_000,
  witness = null,
} = {}) {
  const input = `${lines.filter(Boolean).join('\n')}\n`;
  const spawnEnv = env || defaultSpawnEnv();

  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ['bin/construct'], {
      cwd,
      env: spawnEnv,
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    let stdout = '';
    let stderr = '';
    const guard = setTimeout(() => {
      child.kill('SIGKILL');
    }, timeoutMs);

    child.stdout.on('data', (chunk) => {
      const text = chunk.toString();
      stdout += text;
      if (witness?.onOutput) witness.onOutput('stdout', text);
    });
    child.stderr.on('data', (chunk) => {
      const text = chunk.toString();
      stderr += text;
      if (witness?.onOutput) witness.onOutput('stderr', text);
    });

    for (const line of lines) {
      if (witness?.onAction) witness.onAction('type', line);
    }
    child.stdin.write(input);
    child.stdin.end();

    child.on('error', (err) => {
      clearTimeout(guard);
      reject(err);
    });
    child.on('close', (code) => {
      clearTimeout(guard);
      resolve({
        code,
        stdout,
        stderr,
        plain: stripAnsi(`${stdout}\n${stderr}`),
        timedOut: code === null,
      });
    });
  });
}

export async function runSlashMatrix(witness = null, { paceMs = 0 } = {}) {
  const home = createVisualHome();
  const spawnEnv = defaultSpawnEnv({ HOME: home });
  const stages = [
    { name: 'help', lines: ['/help', '/exit'] },
    { name: 'layers', lines: ['/layers', '/exit'] },
    { name: 'settings', lines: ['/settings', '/exit'] },
    { name: 'context', lines: ['/context', '/exit'] },
    { name: 'host', lines: ['/host', '/exit'] },
    { name: 'usage', lines: ['/usage', '/exit'] },
    { name: 'skills', lines: ['/skills suggest prd', '/exit'] },
  ];

  const results = [];
  for (const stage of stages) {
    if (witness?.stage) witness.stage(stage.name);
    const result = await runConstructScript(stage.lines, { env: spawnEnv, witness });
    results.push({ ...stage, ...result, ok: result.code === 0 });
    if (witness?.stageResult) witness.stageResult(stage.name, result.code === 0);
    if (paceMs > 0) await new Promise((r) => setTimeout(r, paceMs));
  }
  try {
    fs.rmSync(home, { recursive: true, force: true });
  } catch { /* best-effort */ }
  return results;
}
