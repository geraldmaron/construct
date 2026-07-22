#!/usr/bin/env node
/**
 * readme-age-check.mjs — Stop hook (async)
 *
 * On session end, scans tracked READMEs whose last commit is older than 90
 * days and emits `readme.stale` for cx-docs-keeper. Rate-limited via
 * ~/.construct/readme-age-state.json so the same README isn't reported more than
 * once per week.
 *
 * @p95ms 1500
 * @maxBlockingScope none (async, non-blocking)
 *
 * @lifecycle Stop
 * @matcher  *
 * @exits 0 = pass
 */

import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { execSync } from 'node:child_process';
import { join } from 'node:path';
import { emitRoleEvent } from '../roles/hook-emit.mjs';
import { doctorRoot } from '../config/xdg.mjs';

const STATE_PATH = join(doctorRoot(), 'readme-age-state.json');
const STALE_DAYS = 90;
const SUPPRESS_DAYS = 7;

const cwd = process.cwd();

function listReadmes() {
  try {
    const out = execSync(
      "git ls-files | grep -E '(^|/)README\\.md$' | head -50",
      { cwd, timeout: 2000, shell: '/bin/sh' }
    ).toString();
    return out.split('\n').filter(Boolean);
  } catch {
    return [];
  }
}

function lastCommitTs(file) {
  try {
    const out = execSync(`git log -1 --format=%at -- "${file}"`, { cwd, timeout: 2000 }).toString().trim();
    return parseInt(out, 10) * 1000;
  } catch {
    return 0;
  }
}

function loadState() {
  try { return JSON.parse(readFileSync(STATE_PATH, 'utf8')); } catch { return {}; }
}
function saveState(state) {
  try { writeFileSync(STATE_PATH, JSON.stringify(state)); } catch { /* best effort */ }
}

const readmes = listReadmes();
if (readmes.length === 0) process.exit(0);

const state = loadState();
const now = Date.now();
const staleThreshold = now - STALE_DAYS * 24 * 60 * 60 * 1000;
const suppressUntil = now - SUPPRESS_DAYS * 24 * 60 * 60 * 1000;

for (const file of readmes) {
  const ts = lastCommitTs(file);
  if (!ts || ts >= staleThreshold) continue;
  const prev = state[file] || 0;
  if (prev > suppressUntil) continue;
  emitRoleEvent({
    type: 'readme.stale',
    summary: `${file} last updated ${Math.round((now - ts) / (24 * 60 * 60 * 1000))} days ago`,
    hookInput: { cwd },
    context: { file, lastCommitTs: ts },
  });
  state[file] = now;
}

saveState(state);
process.exit(0);
