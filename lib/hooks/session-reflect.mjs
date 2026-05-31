#!/usr/bin/env node
/**
 * lib/hooks/session-reflect.mjs — Session end auto-reflect hook.
 *
 * Runs as a Stop hook. Reads the transcript, extracts a deterministic session
 * summary, and records it via the observation store so subsequent sessions
 * can search what happened. Closes the manual-reflect gap that left learning
 * to operator discipline.
 *
 * Hard 500ms wall-clock budget. Exits 0 on any failure — observation capture
 * is best-effort by design.
 *
 * Opt-out: CONSTRUCT_REFLECT_AUTO=off
 *
 * @p95ms 300
 * @maxBlockingScope Stop
 *
 * @lifecycle Stop
 * @matcher  *
 * @exits 0 = pass
 */
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const HARD_BUDGET_MS = 500;
const startedAt = Date.now();

// Opt-out before any heavy work — the env check is cheaper than parsing input.
if (process.env.CONSTRUCT_REFLECT_AUTO === 'off') process.exit(0);

let input = {};
try { input = JSON.parse(readFileSync(0, 'utf8')); } catch { process.exit(0); }

const cwd = input?.cwd || process.cwd();
const projectName = cwd.split('/').pop() || 'project';

// Only run for Construct projects — same gate as session-optimize.mjs.
if (projectName !== 'construct' && !existsSync(join(cwd, '.cx'))) process.exit(0);

const transcriptPath =
  input?.transcript_path ||
  input?.transcriptPath ||
  process.env.CLAUDE_TRANSCRIPT_PATH ||
  null;

if (!transcriptPath) process.exit(0);

// Wall-clock budget guard. If the extractor blows past the cap (it shouldn't
// — it's deterministic and O(n) over transcript lines), the parent process
// exits without writing. The next session-stop tries again.
const deadline = setTimeout(() => process.exit(0), HARD_BUDGET_MS);
deadline.unref();

try {
  const { runReflectAuto } = await import('../reflect.mjs');
  const sessionId = input?.session_id || input?.sessionId || null;
  const durationMs = input?.session_duration_ms || null;
  await runReflectAuto({ transcriptPath, cwd, sessionId, durationMs });
} catch {
  // Best-effort — observation capture must not affect session exit.
}

const elapsed = Date.now() - startedAt;
if (elapsed > HARD_BUDGET_MS) {
  // Log only if budget exceeded — surfaces in construct doctor if it becomes
  // a pattern. Otherwise silent.
  try {
    process.stderr.write(`[session-reflect] over budget: ${elapsed}ms\n`);
  } catch { /* stderr closed — nothing to do */ }
}

process.exit(0);
