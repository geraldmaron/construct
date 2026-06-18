/**
 * 02-deadcode.mjs — Phase 2: lib modules with no inbound reference.
 *
 * Builds the import graph over the whole repo (static `from`/side-effect imports and
 * dynamic `import('<literal>')`) and reports lib modules nothing references. Construct
 * dispatches heavily through dynamic imports, so the graph must include those or it would
 * flag live code; modules reachable only by a computed (non-literal) import path can't be
 * proven dead and are reported separately, never as a hard finding.
 *
 * Entries excluded from the dead set (reached by mechanism, not by import edge):
 *   - bin/construct and the package `exports` map;
 *   - lib/hooks/** (the dispatcher loads these by constructed path);
 *   - index.mjs / mod entry files.
 *
 * Read-only. Run: node scripts/audit/02-deadcode.mjs
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { REPO_ROOT } from './lib/handlers.mjs';
import { writeJson } from './lib/artifacts.mjs';
import { recordFindings } from './lib/findings.mjs';

const SRC_DIRS = ['lib', 'bin', 'scripts', 'tests'];

// lib/server/static is the compiled Next.js dashboard (hashed build chunks), not source.

const EXCLUDE = /(node_modules|\.git|audit-artifacts|lib\/server\/static)/;

// bin/construct is the primary importer (124 dynamic imports) but has no extension, so it
// must be added explicitly or every lazily-imported module looks dead.

const EXTRA_SOURCES = ['bin/construct'];

function walk(dir, exts) {
  const out = [];
  if (!fs.existsSync(dir)) return out;
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, e.name);
    if (EXCLUDE.test(full)) continue;
    if (e.isDirectory()) out.push(...walk(full, exts));
    else if (exts.some((x) => e.name.endsWith(x))) out.push(full);
  }
  return out;
}

function resolveSpec(fromFile, spec) {
  if (!spec.startsWith('.')) return null;
  let abs = path.resolve(path.dirname(fromFile), spec);
  if (fs.existsSync(abs) && fs.statSync(abs).isFile()) return abs;
  for (const ext of ['.mjs', '.js']) if (fs.existsSync(abs + ext)) return abs + ext;
  for (const idx of ['index.mjs', 'index.js']) if (fs.existsSync(path.join(abs, idx))) return path.join(abs, idx);
  return null;
}

export function runDeadCode() {
  const sources = [
    ...SRC_DIRS.flatMap((d) => walk(path.join(REPO_ROOT, d), ['.mjs', '.js'])),
    ...EXTRA_SOURCES.map((f) => path.join(REPO_ROOT, f)).filter((f) => fs.existsSync(f)),
  ];
  const libFiles = sources.filter((f) => f.startsWith(path.join(REPO_ROOT, 'lib') + path.sep) && /\.mjs$/.test(f));

  const referenced = new Set();
  let hasComputedImport = false;
  const computedImporters = new Set();
  const corpusByFile = new Map();
  for (const file of sources) {
    const src = fs.readFileSync(file, 'utf8');
    corpusByFile.set(file, src);
    for (const m of src.matchAll(/(?:from|import)\s*\(?\s*['"]([^'"]+)['"]/g)) {
      const resolved = resolveSpec(file, m[1]);
      if (resolved) referenced.add(resolved);
    }
    if (/import\(\s*[^'"`)]/.test(src)) { hasComputedImport = true; computedImporters.add(path.relative(REPO_ROOT, file)); }
  }

  // Construct also dispatches modules as subprocesses (runNodeScript / spawn with a path
  // built from segments), so a module whose basename appears as a string in any OTHER
  // source file is reachable even with no import edge.

  const referencedByName = (f) => {
    const base = path.basename(f);
    for (const [src, content] of corpusByFile) {
      if (src === f) continue;
      if (content.includes(base)) return true;
    }
    return false;
  };

  const isEntry = (f) => /\/lib\/hooks\//.test(f) || /\/index\.mjs$/.test(f) ||
    f === path.join(REPO_ROOT, 'lib', 'embedded-contract', 'index.mjs');

  const dead = libFiles
    .filter((f) => !referenced.has(f) && !isEntry(f) && !referencedByName(f))
    .map((f) => path.relative(REPO_ROOT, f));

  const testOnly = libFiles
    .filter((f) => referenced.has(f) && !isEntry(f))
    .filter((f) => {
      const importers = sources.filter((s) => {
        const src = fs.readFileSync(s, 'utf8');
        return [...src.matchAll(/(?:from|import)\s*\(?\s*['"]([^'"]+)['"]/g)].some((m) => resolveSpec(s, m[1]) === f);
      });
      return importers.length > 0 && importers.every((s) => /\/tests\//.test(s) || s === f);
    })
    .map((f) => path.relative(REPO_ROOT, f));

  return { libCount: libFiles.length, dead, testOnly, hasComputedImport, computedImporters: [...computedImporters].length };
}

function toFindings(report) {
  const rows = [];
  for (const f of report.dead) {
    rows.push({ type: 'dead-module', target: f, severity: 'medium', tier: 'judgment',
      evidence: 'no inbound static or dynamic-literal import anywhere in lib/bin/scripts/tests',
      recommendation: 'Confirm not reached via a computed import path, then remove it (or wire it up).' });
  }
  for (const f of report.testOnly) {
    rows.push({ type: 'module-test-only', target: f, severity: 'low', tier: 'judgment',
      evidence: 'imported only by tests, never by production code',
      recommendation: 'Confirm whether this is production code with only test callers (possible dead-on-ship) or a test helper.' });
  }
  return rows;
}

function main() {
  const report = runDeadCode();
  const findings = toFindings(report);
  recordFindings('02-deadcode', findings);
  writeJson('dead-code.json', report);
  process.stdout.write(`[audit:02] ${report.libCount} lib modules: ${report.dead.length} with no inbound reference, ` +
    `${report.testOnly.length} test-only. (${report.computedImporters} files use computed imports — manual confirm before deleting.)\n`);
  if (report.dead.length) process.stdout.write(`[audit:02] dead candidates: ${report.dead.join(', ')}\n`);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) main();
