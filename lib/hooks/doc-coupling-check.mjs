#!/usr/bin/env node
/**
 * lib/hooks/doc-coupling-check.mjs — PostToolUse hook: nudge when code edits aren't paired with doc updates.
 *
 * Maintains a session-scoped counter of code-file edits (lib/, bin/, src/, app/)
 * since the last documentation touch (CHANGELOG.md, docs/**, .construct/context.*).
 * Emits an advisory to stderr at thresholds 3, 5, 10 so the agent observation
 * surfaces the coupling reminder during the run rather than at commit time
 * (where the hard gate in .beads/hooks/pre-commit will refuse to commit).
 *
 * Non-blocking by design — this is the soft predecessor to the commit gate.
 *
 * @p95ms 15
 * @maxBlockingScope none (PostToolUse, non-blocking)
 *
 * @lifecycle PostToolUse
 * @matcher  Write|Edit|MultiEdit
 * @exits 0 = pass
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';

import { doctorRoot } from '../config/xdg.mjs';

const STATE_PATH = join(doctorRoot(), 'doc-coupling.json');
const CODE_RE = /^(lib|bin|src|app)\/.*\.(?:m?js|jsx?|tsx?|cjs)$/;
const DOC_RE = /^(?:CHANGELOG\.md|docs\/.+\.md|\.construct\/context\.(?:md|json))$/;
const THRESHOLDS = [3, 5, 10];

let filePath = process.env.TOOL_INPUT_FILE_PATH;
let cwd = process.env.CLAUDE_PROJECT_DIR || process.cwd();
if (!filePath) {
  try {
    const input = JSON.parse(readFileSync(0, 'utf8'));
    filePath = input?.tool_input?.file_path || input?.tool_input?.path;
    if (input?.cwd) cwd = input.cwd;
  } catch {}
}
if (!filePath) process.exit(0);

const rel = filePath.startsWith(cwd) ? filePath.slice(cwd.length).replace(/^\/+/, '') : filePath;

function readState() {
  try { return JSON.parse(readFileSync(STATE_PATH, 'utf8')); }
  catch { return { codeEdits: 0, notified: [] }; }
}

function writeState(state) {
  try {
    mkdirSync(dirname(STATE_PATH), { recursive: true });
    writeFileSync(STATE_PATH, JSON.stringify(state));
  } catch {}
}

const state = readState();

if (DOC_RE.test(rel)) {
  writeState({ codeEdits: 0, notified: [] });
  process.exit(0);
}

if (!CODE_RE.test(rel)) process.exit(0);

state.codeEdits = (state.codeEdits || 0) + 1;
const notified = new Set(state.notified || []);

let advisory = null;
for (const t of THRESHOLDS) {
  if (state.codeEdits >= t && !notified.has(t)) {
    notified.add(t);
    advisory = t;
  }
}

state.notified = [...notified];
writeState(state);

if (advisory != null) {
  process.stderr.write(
    `[doc-coupling] ${state.codeEdits} code file edit(s) this session under lib/|bin/|src/|app/; CHANGELOG.md / docs / .construct/context still not touched. Update docs before the next commit (the pre-commit gate will block otherwise).\n`,
  );
}

process.exit(0);
