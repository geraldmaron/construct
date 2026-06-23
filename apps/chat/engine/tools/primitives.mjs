/**
 * apps/chat/engine/tools/primitives.mjs — zero-dep executors for the owned loop's
 * agent tools (read, write, edit, glob, grep, shell).
 *
 * These are the side-effecting primitives the loop calls; they are pure Node so
 * they are fully testable in a tmpdir with no model, network, or SDK. Path safety
 * is enforced here: every path resolves inside the workspace root unless the caller
 * passes `allowOutside` (set only by the danger-full-access sandbox). Search tools
 * walk the tree with a hard result/size cap and skip the usual heavy/ignored dirs
 * so a grep never hangs the loop. Shell reuses the bounded worker runner
 * (lib/worker/run.mjs) for the timeout + path policy already proven there.
 *
 * Every function returns a structured, JSON-serializable result (never throws for
 * an ordinary "not found"/"no match" outcome) so the result maps cleanly onto a
 * tool_update event and back to the model.
 */

import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { runJob } from '../../../../lib/worker/run.mjs';

const IGNORED_DIRS = new Set(['node_modules', '.git', '.cx', 'dist', 'build', '.next', 'coverage', '.cache']);
const MAX_READ_BYTES = 256 * 1024;
const MAX_WALK_FILES = 20000;

function resolveInside(cwd, target, { allowOutside = false } = {}) {
  const root = path.resolve(cwd);
  const resolved = path.resolve(root, target || '.');
  if (!allowOutside && resolved !== root && !resolved.startsWith(`${root}${path.sep}`)) {
    const err = new Error(`path '${target}' is outside the workspace; not permitted under the current sandbox`);
    err.code = 'PATH_OUTSIDE_WORKSPACE';
    throw err;
  }
  return resolved;
}

export function readFileTool({ cwd, path: target, maxBytes = MAX_READ_BYTES, allowOutside = false } = {}) {
  const file = resolveInside(cwd, target, { allowOutside });
  if (!fs.existsSync(file)) return { ok: false, error: `no such file: ${target}` };
  const stat = fs.statSync(file);
  if (stat.isDirectory()) return { ok: false, error: `${target} is a directory` };
  const buf = fs.readFileSync(file);
  const truncated = buf.length > maxBytes;
  return { ok: true, path: target, bytes: stat.size, truncated, content: buf.slice(0, maxBytes).toString('utf8') };
}

export function writeFileTool({ cwd, path: target, content = '', allowOutside = false } = {}) {
  const file = resolveInside(cwd, target, { allowOutside });
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, content, 'utf8');
  return { ok: true, path: target, bytes: Buffer.byteLength(content, 'utf8') };
}

export function editFileTool({ cwd, path: target, oldString, newString = '', replaceAll = false, allowOutside = false } = {}) {
  const file = resolveInside(cwd, target, { allowOutside });
  if (!fs.existsSync(file)) return { ok: false, error: `no such file: ${target}` };
  if (typeof oldString !== 'string' || oldString.length === 0) return { ok: false, error: 'oldString is required and must be non-empty' };
  const before = fs.readFileSync(file, 'utf8');
  const occurrences = before.split(oldString).length - 1;
  if (occurrences === 0) return { ok: false, error: 'oldString not found in file' };
  if (occurrences > 1 && !replaceAll) return { ok: false, error: `oldString is not unique (${occurrences} matches); pass replaceAll or add more context` };
  const after = replaceAll ? before.split(oldString).join(newString) : before.replace(oldString, newString);
  fs.writeFileSync(file, after, 'utf8');
  return { ok: true, path: target, replacements: replaceAll ? occurrences : 1 };
}

// Bounded depth-first walk yielding workspace-relative file paths, skipping the
// ignored dirs. Caps the number of files visited so a pathological tree cannot
// stall the loop.

function* walkFiles(root) {
  const stack = [root];
  let visited = 0;
  while (stack.length) {
    const dir = stack.pop();
    let entries;
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { continue; }
    for (const entry of entries) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (IGNORED_DIRS.has(entry.name) || entry.name.startsWith('.')) continue;
        stack.push(full);
      } else if (entry.isFile()) {
        if (++visited > MAX_WALK_FILES) return;
        yield full;
      }
    }
  }
}

// Translate a simple glob ("**/*.mjs", "src/*.ts", "lib/**") into a RegExp. Only
// the common operators are supported (no brace expansion), which covers what the
// loop needs without pulling a glob dependency.

function globToRegExp(pattern) {
  let re = '';
  for (let i = 0; i < pattern.length; i++) {
    const c = pattern[i];
    if (c === '*') {
      if (pattern[i + 1] === '*') { re += '.*'; i++; if (pattern[i + 1] === '/') i++; }
      else re += '[^/]*';
    } else if (c === '?') re += '[^/]';
    else if ('.+^${}()|[]\\'.includes(c)) re += `\\${c}`;
    else re += c;
  }
  return new RegExp(`^${re}$`);
}

export function globTool({ cwd, pattern, limit = 200, allowOutside = false } = {}) {
  const root = resolveInside(cwd, '.', { allowOutside });
  if (!pattern) return { ok: false, error: 'pattern is required' };
  const rx = globToRegExp(pattern);
  const matches = [];
  for (const file of walkFiles(root)) {
    const rel = path.relative(root, file);
    if (rx.test(rel)) {
      matches.push(rel);
      if (matches.length >= limit) break;
    }
  }
  return { ok: true, pattern, matches, truncated: matches.length >= limit };
}

export function grepTool({ cwd, pattern, glob = null, limit = 200, caseInsensitive = false, allowOutside = false } = {}) {
  const root = resolveInside(cwd, '.', { allowOutside });
  if (!pattern) return { ok: false, error: 'pattern is required' };
  let rx;
  try { rx = new RegExp(pattern, caseInsensitive ? 'i' : ''); } catch (err) { return { ok: false, error: `invalid pattern: ${err.message}` }; }
  const globRx = glob ? globToRegExp(glob) : null;
  const matches = [];
  for (const file of walkFiles(root)) {
    const rel = path.relative(root, file);
    if (globRx && !globRx.test(rel)) continue;
    let text;
    try {
      const stat = fs.statSync(file);
      if (stat.size > MAX_READ_BYTES) continue;
      text = fs.readFileSync(file, 'utf8');
    } catch { continue; }
    if (text.includes('\u0000')) continue;
    const lines = text.split('\n');
    for (let i = 0; i < lines.length; i++) {
      if (rx.test(lines[i])) {
        matches.push({ file: rel, line: i + 1, text: lines[i].slice(0, 300) });
        if (matches.length >= limit) return { ok: true, pattern, matches, truncated: true };
      }
    }
  }
  return { ok: true, pattern, matches, truncated: false };
}

export async function shellTool({ cwd, command, timeoutSeconds = 60, allowOutside = false } = {}) {
  if (!command || typeof command !== 'string') return { ok: false, error: 'command is required' };
  const root = path.resolve(cwd);
  const result = await runJob({
    rootDir: root,
    job: {
      jobId: `chat-${randomUUID()}`,
      command,
      timeoutSeconds,
      workspaceRef: root,
      allowedPaths: allowOutside ? [] : [root],
    },
  });
  let stdout = '';
  let stderr = '';
  try { stdout = fs.readFileSync(result.stdoutPath, 'utf8'); } catch { /* no stdout */ }
  try { stderr = fs.readFileSync(result.stderrPath, 'utf8'); } catch { /* no stderr */ }
  return {
    ok: result.status === 'passed',
    status: result.status,
    exitCode: result.exitCode,
    durationMs: result.durationMs,
    stdout: stdout.slice(0, MAX_READ_BYTES),
    stderr: stderr.slice(0, MAX_READ_BYTES),
  };
}

export const __test__ = { resolveInside, globToRegExp };
