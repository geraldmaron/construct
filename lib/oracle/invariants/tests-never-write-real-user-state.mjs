/**
 * lib/oracle/invariants/tests-never-write-real-user-state.mjs — Layer 1 deterministic
 * invariant: every production write target under `doctorRoot()` must be covered by the
 * sterile-host-env test guard's fingerprint, or a leaking test's write into real user
 * state goes undetected.
 *
 * Per the oracle-miss-report's row 42: "Oracle's read model doesn't audit test-suite
 * hygiene at all... extend the existing sterile-host-env.mjs fingerprint from
 * hygiene at all... extend the existing sterile-host-env.mjs fingerprint from
 * audit-trail.jsonl to every state file class." That extension already covers
 * (audit-trail.jsonl) to ~13 directory/file classes (sandboxes, performance-reviews,
 * scheduler/logs, runtime, runtime/oracle, cost-ledger.json, model-pricing.json,
 * pricing-cache.json, cost-watcher-state.json, bd-watch-seen.json,
 * contract-violations.jsonl) plus two count-based markers (audit-trail.jsonl,
 * approvals/queue.jsonl) — see that file's own header for the citation trail.
 *
 * A live static scan of this repo's `lib/` tree for `join(doctorRoot(...), '<segment>')`
 * call sites (2026-07-16) found the guard's extension covers only a fraction of the real
 * surface: over 50 distinct doctorRoot()-scoped state-file classes exist in production
 * code (session-cost.jsonl, session-efficiency.json, events.jsonl, role-pending.jsonl,
 * doctor-log.jsonl, intake/*, cache/embeddings, sync.lock, hook-health/*, and dozens more
 * under lib/hooks/) with zero fingerprint coverage — a test that leaks a write into any
 * of them today would go completely undetected by `assertRealConfigsUnchanged`. This
 * invariant makes that gap a standing, mechanically-checkable fact instead of a one-time
 * audit finding: it re-derives the guard's actual covered-segment set from the real
 * `fingerprintRealConfigs()` export (not a duplicated hardcoded list, so the invariant
 * can never silently drift out of sync with the guard it is checking) and diffs it
 * against every doctorRoot()-scoped write call site discovered in `lib/`.
 *
 * The scan is a best-effort static pattern match (direct `join(doctorRoot(...), '...')`
 * call sites, plus a second pass tracking `const X = doctorRoot(...)` local aliases used
 * in a later `join(X, '...')` on the same file) — it cannot resolve dynamic segments
 * built from template literals or runtime values, so it under-counts rather than
 * over-counts; a real uncovered write site it does find is never a false positive.
 */

import { readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

export const id = 'tests-never-write-real-user-state';
export const layer = 1;
export const description =
  "Every production doctorRoot()-scoped write target must be covered by the sterile-host-env test guard's fingerprint, or a test leak into real user state goes undetected.";

const DIRECT_JOIN_RE = /(?:path\.)?join\(\s*doctorRoot\([^)]*\)\s*,\s*['"]([^'"]+)['"]/g;
const VAR_ASSIGN_RE = /const\s+(\w+)\s*=\s*(?:process\.env\.\w+\s*\|\|\s*)?doctorRoot\(/g;

function walkMjsFiles(dir, out = []) {
  let entries;
  try {
    entries = readdirSync(dir);
  } catch {
    return out;
  }
  for (const entry of entries) {
    if (entry === 'node_modules' || entry.startsWith('.')) continue;
    const p = path.join(dir, entry);
    let st;
    try {
      st = statSync(p);
    } catch {
      continue;
    }
    if (st.isDirectory()) walkMjsFiles(p, out);
    else if (entry.endsWith('.mjs')) out.push(p);
  }
  return out;
}

// lib/oracle/invariants/ (this module's own directory) documents doctorRoot()-shaped
// example patterns in prose — real invariant source, not a production write call site —
// so it is excluded from the scan to avoid the invariant flagging its own docstrings.

const SELF_EXCLUDED_DIR = path.join('lib', 'oracle', 'invariants');

/**
 * @param {string} libDir absolute path to the `lib/` tree to scan
 * @returns {Map<string, string[]>} first-path-segment -> ["file:line", ...] occurrences
 */
export function scanLibForDoctorRootSegments(libDir) {
  const segments = new Map();
  const record = (seg, file, index) => {
    if (!segments.has(seg)) segments.set(seg, []);
    segments.get(seg).push(`${path.relative(path.dirname(libDir), file)}:${index}`);
  };

  for (const file of walkMjsFiles(libDir)) {
    if (file.split(path.sep).join('/').includes(SELF_EXCLUDED_DIR.split(path.sep).join('/'))) continue;
    const src = readFileSync(file, 'utf8');

    DIRECT_JOIN_RE.lastIndex = 0;
    let m;
    while ((m = DIRECT_JOIN_RE.exec(src))) {
      const lineNo = src.slice(0, m.index).split('\n').length;
      record(m[1].split('/')[0], file, lineNo);
    }

    const aliases = [];
    VAR_ASSIGN_RE.lastIndex = 0;
    while ((m = VAR_ASSIGN_RE.exec(src))) aliases.push(m[1]);
    for (const alias of aliases) {
      const re = new RegExp(`(?:path\\.)?join\\(\\s*${alias}\\s*,\\s*['"]([^'"]+)['"]`, 'g');
      let am;
      while ((am = re.exec(src))) {
        const lineNo = src.slice(0, am.index).split('\n').length;
        record(am[1].split('/')[0], file, lineNo);
      }
    }
  }

  return segments;
}

/**
 * Re-derives the sterile guard's covered-segment set from its real exports rather than
 * a hardcoded duplicate, so this invariant tracks the guard's actual behavior.
 *
 * @param {string} cwd repo root containing tests/helpers/sterile-host-env.mjs
 */
export async function loadCoveredSegments(cwd) {
  const helperPath = path.join(cwd, 'tests', 'helpers', 'sterile-host-env.mjs');
  const source = readFileSync(helperPath, 'utf8');
  const mod = await import(pathToFileURL(helperPath).href);
  const fp = mod.fingerprintRealConfigs('/nonexistent-fake-home-for-coverage-probe');

  const covered = new Set();
  for (const key of Object.keys(fp)) {
    if (key.startsWith('doctorRoot:')) covered.add(key.slice('doctorRoot:'.length).split(':')[0]);
  }

  // audit-trail.jsonl and approvals/queue.jsonl are covered via a record-count marker
  // (countAuditTrailTestLeaks/countApprovalQueueTestLeaks), not a fingerprintRealConfigs
  // key — credit them only if those functions are still actually present in the guard,
  // so a regression that removes the marker also removes the credit.
  if (/countAuditTrailTestLeaks/.test(source)) covered.add('audit-trail.jsonl');
  if (/countApprovalQueueTestLeaks/.test(source)) covered.add('approvals');

  return covered;
}

/**
 * @param {{cwd?: string, libDir?: string, loadCoveredSegments?: Function, scanSegments?: Function}} [opts]
 */
export async function check({
  cwd = process.cwd(),
  libDir = path.join(cwd, 'lib'),
  loadCoveredSegments: loadCovered = loadCoveredSegments,
  scanSegments = scanLibForDoctorRootSegments,
} = {}) {
  let covered;
  try {
    covered = await loadCovered(cwd);
  } catch (err) {
    return {
      status: 'collection-error',
      detail: `failed to load sterile guard coverage: ${err.message || err}`,
      evaluated: 0,
      violations: [],
      unresolved: [],
      results: [],
    };
  }

  let found;
  try {
    found = scanSegments(libDir);
  } catch (err) {
    return {
      status: 'collection-error',
      detail: `failed to scan lib/ for doctorRoot() write sites: ${err.message || err}`,
      evaluated: 0,
      violations: [],
      unresolved: [],
      results: [],
    };
  }

  const results = [];
  for (const [segment, locations] of [...found.entries()].sort(([a], [b]) => a.localeCompare(b))) {
    const isCovered = covered.has(segment);
    results.push({
      segment,
      locations,
      status: isCovered ? 'passed' : 'failed',
      violation: !isCovered,
      detail: isCovered
        ? `'${segment}' is covered by the sterile-host-env guard's fingerprint`
        : `'${segment}' is written by production code (${locations[0]}${locations.length > 1 ? ` +${locations.length - 1} more` : ''}) but has no coverage in the sterile-host-env guard's fingerprint`,
    });
  }

  const violations = results.filter((r) => r.status === 'failed');
  return {
    status: violations.length > 0 ? 'failed' : 'passed',
    evaluated: results.length,
    violations,
    unresolved: [],
    results,
  };
}
