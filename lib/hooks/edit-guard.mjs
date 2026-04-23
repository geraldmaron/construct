#!/usr/bin/env node
/**
 * lib/hooks/edit-guard.mjs — Edit guard hook — validates old_string exists in target file before allowing edits.
 *
 * Runs as PreToolUse on Edit. Re-reads the target file and checks that old_string is present to prevent no-op or mismatched edits. Exits 2 (block) when not found.
 *
 * @p95ms 20
 * @maxBlockingScope PreToolUse
 */
import { readFileSync, existsSync } from 'fs';
import { createHash } from 'crypto';
import { join, resolve } from 'path';
import { homedir } from 'os';

const HASH_STORE = join(homedir(), '.cx', 'file-hashes.json');

function storedHash(absPath) {
  try {
    const store = JSON.parse(readFileSync(HASH_STORE, 'utf8'));
    return store[absPath] || null;
  } catch { return null; }
}

function fileHash(content) {
  return createHash('sha256').update(content).digest('hex').slice(0, 16);
}

let input = {};
try { input = JSON.parse(readFileSync(0, 'utf8')); } catch { process.exit(0); }

const toolName = input?.tool_name || '';
const ti = input?.tool_input || {};
const cwd = input?.cwd || process.cwd();

function absOf(p) { return p.startsWith('/') ? p : resolve(cwd, p); }

if (toolName === 'Edit') {
  const { file_path, old_string } = ti;
  if (!file_path || !old_string) process.exit(0);

  const abs = absOf(file_path);
  let content;
  try { content = readFileSync(abs, 'utf8'); } catch { process.exit(0); }

  // Hard block: old_string must exist verbatim
  if (!content.includes(old_string)) {
    const preview = old_string.split('\n').slice(0, 3).map(l => l.trimEnd()).join('↵');
    process.stderr.write(
      `[edit-guard] BLOCKED: old_string not found in ${file_path}\n` +
      `[edit-guard] Preview: "${preview.slice(0, 120)}"\n` +
      `[edit-guard] Fix: re-read the file, copy the exact text including whitespace.\n`
    );
    process.exit(2);
  }

  // Soft warn: hash mismatch means file changed since last Read
  const stored = storedHash(abs);
  if (stored && stored.hash !== fileHash(content)) {
    process.stderr.write(
      `[edit-guard] WARNING: ${file_path} changed since last Read (hash ${stored.hash} → ${fileHash(content)}). ` +
      `old_string found — proceeding.\n`
    );
  }
}

if (toolName === 'MultiEdit') {
  const { file_path, edits } = ti;
  if (!file_path || !Array.isArray(edits)) process.exit(0);

  const abs = absOf(file_path);
  let content;
  try { content = readFileSync(abs, 'utf8'); } catch { process.exit(0); }

  const missing = edits.filter(e => e.old_string && !content.includes(e.old_string));
  if (missing.length > 0) {
    const previews = missing.map(e => `  • "${e.old_string.split('\n')[0].slice(0, 80)}"`).join('\n');
    process.stderr.write(
      `[edit-guard] BLOCKED: ${missing.length}/${edits.length} old_string(s) not found in ${file_path}\n` +
      `${previews}\n` +
      `[edit-guard] Re-read the file and use exact content from the current version.\n`
    );
    process.exit(2);
  }

  const stored = storedHash(abs);
  if (stored && stored.hash !== fileHash(content)) {
    process.stderr.write(`[edit-guard] WARNING: ${file_path} changed since last Read. old_strings verified — proceeding.\n`);
  }
}

if (toolName === 'Write') {
  const { file_path } = ti;
  if (!file_path) process.exit(0);
  const abs = absOf(file_path);
  if (!existsSync(abs)) process.exit(0);

  try {
    const content = readFileSync(abs, 'utf8');
    const stored = storedHash(abs);
    if (stored && stored.hash !== fileHash(content)) {
      process.stderr.write(
        `[edit-guard] WARNING: ${file_path} was modified since last Read. ` +
        `Verify this full-file Write is intentional — it will overwrite those changes.\n`
      );
    }
  } catch { /* best effort */ }
}

process.exit(0);
