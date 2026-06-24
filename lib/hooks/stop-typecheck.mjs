#!/usr/bin/env node
/**
 * lib/hooks/stop-typecheck.mjs — Stop typecheck hook — runs TypeScript type-check at session end and records result.
 *
 * Runs as a Stop hook. Invokes tsc --noEmit on the project and records pass/fail to ~/.cx/pending-typecheck.txt for the next session-start hook to surface.
 *
 * @p95ms 2000
 * @maxBlockingScope Stop
 *
 * @lifecycle Stop
 * @matcher  *
 * @exits 0 = pass
 */
import { readFileSync, writeFileSync, existsSync } from 'fs';
import { execSync } from 'child_process';
import { homedir } from 'os';
import { join, dirname } from 'path';
import { doctorRoot } from '../config/xdg.mjs';

// Stop hooks must echo stdin to stdout
let raw = '';
try { raw = readFileSync(0, 'utf8'); } catch { /* no stdin */ }
if (raw) process.stdout.write(raw);

const home = homedir();
const tcPath = join(doctorRoot(home), 'pending-typecheck.txt');
const tsResultPath = join(doctorRoot(home), 'ts-result.txt');
const warnFlagsPath = join(doctorRoot(home), 'warn-flags.txt');

// Read pending files
const pending = existsSync(tcPath)
  ? readFileSync(tcPath, 'utf8').split('\n').filter(Boolean)
  : [];

// No files queued means no typecheck ran this turn — record 'unchecked', not a
// misleading 'pass'. A stale 'pass' here is what made stop-notify fire a bare
// "TS OK" banner on every no-op turn.
if (pending.length === 0) {
  try { writeFileSync(tsResultPath, 'unchecked'); } catch { /* best effort */ }
  process.exit(0);
}

// Clear pending list immediately (don't re-run on next session if this run crashes)
try { writeFileSync(tcPath, ''); } catch { /* best effort */ }

// Find nearest tsconfig.json by walking up from first pending file's directory
function findTsConfig(startDir) {
  let dir = startDir;
  for (let i = 0; i < 10; i++) {
    const candidate = join(dir, 'tsconfig.json');
    if (existsSync(candidate)) return candidate;
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return null;
}

const startDir = dirname(pending[0]);
const tsconfig = findTsConfig(startDir);

// Files were edited but no tsconfig governs them — the typecheck couldn't run,
// so the honest state is 'unchecked', not 'pass'.
if (!tsconfig) {
  try { writeFileSync(tsResultPath, 'unchecked'); } catch { /* best effort */ }
  process.exit(0);
}

const projectDir = dirname(tsconfig);

try {
  execSync('npx tsc --noEmit --pretty false', {
    cwd: projectDir,
    stdio: 'pipe',
    timeout: 90_000,
  });
  try { writeFileSync(tsResultPath, 'pass'); } catch { /* best effort */ }
} catch (e) {
  const output = (e.stdout?.toString() || '') + (e.stderr?.toString() || '');
  const errorLines = output.split('\n').filter(l => /error TS\d+:/.test(l));
  const count = errorLines.length || 1;

  try { writeFileSync(tsResultPath, `${count} error${count !== 1 ? 's' : ''}`); } catch { /* best effort */ }

  try {
    const existing = existsSync(warnFlagsPath) ? readFileSync(warnFlagsPath, 'utf8') : '';
    writeFileSync(warnFlagsPath, existing + `TypeScript: ${count} error${count !== 1 ? 's' : ''}\n`);
  } catch { /* best effort */ }

  process.stderr.write(
    `[stop-typecheck] TypeScript found ${count} error${count !== 1 ? 's' : ''} that need attention. The code runs but won't compile cleanly. Review before releasing.\n`
  );

  try {
    const { emitRoleEvent } = await import('../roles/hook-emit.mjs');
    emitRoleEvent({
      type: 'test.fail',
      summary: `TypeScript: ${count} error${count !== 1 ? 's' : ''}\n${errorLines.slice(0, 3).join('\n')}`,
      hookInput: { cwd: projectDir },
      context: { tool: 'tsc', count },
    });
  } catch { /* best effort */ }
}

process.exit(0);
