#!/usr/bin/env node
/**
 * test-watch.mjs — PostToolUse / Bash (async)
 *
 * When a Bash invocation ran tests (vitest/jest/npm test/bun test/pytest) and
 * exited non-zero, emit `test.fail` for qa. Detects flake patterns when the
 * same test name passes and then fails within an hour and emits `test.flake`.
 *
 * @p95ms 30
 * @maxBlockingScope none (async, non-blocking)
 *
 * @lifecycle PostToolUse
 * @matcher  Bash
 * @exits 0 = pass
 */

import { readFileSync, existsSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { logHookFailure } from './_lib/log.mjs';
import { emitRoleEvent } from '../roles/hook-emit.mjs';
import { doctorRoot } from '../config/xdg.mjs';

let input = {};
try { input = JSON.parse(readFileSync(0, 'utf8')); }
catch (err) { logHookFailure({ hook: 'test-watch', err, phase: 'parse' }); process.exit(0); }

const command = input?.tool_input?.command || '';
const exitCode = input?.tool_response?.exit_code ?? input?.tool_response?.exitCode;
const stdout = String(input?.tool_response?.stdout || '');
const stderr = String(input?.tool_response?.stderr || '');

const isTestCmd = /\b(vitest|jest|npm\s+test|bun\s+test|pnpm\s+test|yarn\s+test|pytest|cargo\s+test|go\s+test)\b/.test(command);
if (!isTestCmd) process.exit(0);
if (exitCode === 0 || exitCode === undefined) process.exit(0);

const combined = (stderr + '\n' + stdout).slice(-4000);
const failedNames = [...combined.matchAll(/(?:FAIL|×|✗)\s+([^\n]{3,160})/g)].slice(0, 5).map((m) => m[1].trim());
const summary = `Tests failed: ${failedNames.length || 'unknown'}; first: ${failedNames[0] || combined.split('\n').find(Boolean)?.slice(0, 160) || command}`;

emitRoleEvent({
  type: 'test.fail',
  summary,
  hookInput: input,
  context: { command, exitCode, failedNames },
});

const flakeTrackerPath = join(doctorRoot(), 'test-watch-state.json');
try {
  const state = existsSync(flakeTrackerPath) ? JSON.parse(readFileSync(flakeTrackerPath, 'utf8')) : {};
  const now = Date.now();
  for (const name of failedNames) {
    const prev = state[name];
    if (prev && prev.passedAt && now - prev.passedAt < 60 * 60 * 1000) {
      emitRoleEvent({
        type: 'test.flake',
        summary: `Flake suspected: ${name} (passed ${Math.round((now - prev.passedAt) / 60000)} min ago, now failing)`,
        hookInput: input,
        context: { name, prevPassedAt: prev.passedAt },
      });
    }
    state[name] = { failedAt: now };
  }
  const trimmed = {};
  for (const [k, v] of Object.entries(state)) {
    if ((v.failedAt || v.passedAt || 0) > now - 24 * 60 * 60 * 1000) trimmed[k] = v;
  }
  writeFileSync(flakeTrackerPath, JSON.stringify(trimmed));
} catch (err) {
  logHookFailure({ hook: 'test-watch', err, phase: 'flake-track' });
}

process.exit(0);
