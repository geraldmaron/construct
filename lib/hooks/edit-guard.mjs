#!/usr/bin/env node
/**
 * lib/hooks/edit-guard.mjs — Edit guard hook — validates old_string exists in target file before allowing edits.
 *
 * Runs as PreToolUse on Edit. Re-reads the target file and checks that old_string is present to prevent no-op or mismatched edits. Exits 2 (block) when not found.
 *
 * @p95ms 20
 * @maxBlockingScope PreToolUse
 *
 * @lifecycle PreToolUse
 * @matcher  Edit|MultiEdit|Write
 * @exits 0 = pass | 2 = block tool call
 */
import { readFileSync, existsSync } from 'fs';
import { createHash } from 'crypto';
import { join, resolve } from 'path';
import { logHookFailure } from './_lib/log.mjs';
import { doctorRoot } from '../config/xdg.mjs';

const HASH_STORE = join(doctorRoot(), 'file-hashes.json');

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
try { input = JSON.parse(readFileSync(0, 'utf8')); }
catch (err) { logHookFailure({ hook: 'edit-guard', err, phase: 'parse' }); process.exit(0); }

const toolName = input?.tool_name || '';
const ti = input?.tool_input || {};
const cwd = input?.cwd || process.cwd();

function absOf(p) { return p.startsWith('/') ? p : resolve(cwd, p); }

// Role-fence check: if the most recently dispatched persona is one we manage
// (cx-operations, cx-qa, cx-security) and the dispatch is fresh, emit an
// advisory stderr warning when the edit target is outside the fence.
// Hard-block only when the fence returns "outside-fence" (default-deny case);
// "needs-approval" routes to existing commit-approval flow.

if ((toolName === 'Edit' || toolName === 'Write' || toolName === 'MultiEdit') && process.env.CONSTRUCT_ROLES !== 'off') {
  try {
    const lastAgentPath = join(doctorRoot(), 'last-agent.json');
    if (existsSync(lastAgentPath)) {
      const last = JSON.parse(readFileSync(lastAgentPath, 'utf8'));
      const lastTs = last?.ts ? Date.parse(last.ts) : 0;
      const fresh = lastTs && (Date.now() - lastTs) < 10 * 60 * 1000;
      const id = String(last?.agent || '').replace(/^cx-/, '');
      const ONBOARDED = new Set(['operations', 'qa', 'security']);
      const targetPath = ti.file_path || ti.path || '';
      if (fresh && ONBOARDED.has(id) && targetPath) {
        const { checkAction } = await import('../roles/fence.mjs');
        const rel = targetPath.startsWith(cwd + '/') ? targetPath.slice(cwd.length + 1) : targetPath;
        const verdict = checkAction({ personaId: id, action: 'edit', target: rel });
        if (!verdict.allowed && verdict.reason === 'outside-fence') {
          process.stderr.write(
            `[fence] cx-${id} cannot edit ${rel} — outside declared fence.\n` +
            `Allowed paths: see agents/role-manifests.json → ${id} → fence.allowedPaths.\n`
          );
          process.exit(2);
        }
        if (!verdict.allowed && verdict.approval) {
          process.stderr.write(
            `[fence] cx-${id} editing ${rel} requires user approval (outside fence, approval-required class).\n`
          );
          const { recordApprovalRequest } = await import('../roles/approval-surface.mjs');
          await recordApprovalRequest({ personaId: id, action: 'edit', target: rel, reason: verdict.reason || 'needs-approval' });
        }
      }
    }
  } catch { /* best effort — fence check never blocks for internal errors */ }
}

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
