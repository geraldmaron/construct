/**
 * lib/decisions/registry.mjs — machine-readable index of load-bearing decisions.
 *
 * The registry is a derived VIEW computed from source on every call, never a
 * committed snapshot — the same discipline as lib/doctor/watchers/consistency.mjs.
 * A snapshot would itself drift; computing from source keeps the ADRs, rules, and
 * contracts as the single source of truth.
 *
 * Three decision sources are indexed:
 *   - ADRs           docs/decisions/adr/*.md            (status + supersedes parsed from body)
 *   - Contracts      registry (executable postconditions = enforcement)
 *   - Rules          rules/**\/*.md            (enforcement link via frontmatter; bead wvbf.4)
 *
 * Enforcement bindings are discovered by scanning tests/ and lib/hooks/ for an
 * `@enforces <decision-id>` marker. A decision with no binding is `advisory: true`.
 * Orphan detection (binding ↔ decision) is owned by bead wvbf.2; supersede-chain
 * validation by bead wvbf.3. This module supplies the data both build on.
 *
 * Pure and deterministic: same tree → same registry, ordered by id.
 */

import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join, dirname, resolve, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

import { readRuleFile } from '../rules-read.mjs';
import { loadRegistry } from '../registry/loader.mjs';

export const DECISION_STATUSES = ['proposed', 'accepted', 'superseded', 'deprecated'];

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');

// The binding marker is a dedicated annotation line, not a mid-sentence mention:
// a line whose only content (after a comment leader) is `@enforces <decision-id>`.
// Anchoring to the whole line keeps prose that merely names the marker from
// registering as a false binding.

const ENFORCES_LINE_RE = /^(?:\/\/|#|\*)?\s*@enforces\s+(\S+)\s*$/;

// The body carries Status and Supersedes as markdown definition lines, not
// frontmatter; parse them positionally.

// ADR field styles vary across the lane: inline bold (`- **Status**: x`,
// `**Status:** X`) and heading-then-value (`## Status` followed by the value on
// the next line). Extract a field across all three rather than pinning one style.

function extractField(body, field) {
  const inline = body.match(new RegExp(`\\*\\*${field}:?\\*\\*:?\\s*(.+)`, 'i'));
  if (inline && inline[1].trim()) return inline[1].trim();
  const lines = body.split('\n');
  const headingIdx = lines.findIndex((l) => new RegExp(`^#{1,6}\\s*${field}\\s*$`, 'i').test(l));
  if (headingIdx !== -1) {
    for (let i = headingIdx + 1; i < lines.length; i++) {
      const v = lines[i].trim();
      if (!v) continue;
      if (/^#{1,6}\s/.test(v)) break;
      return v.replace(/^[-*]\s*/, '');
    }
  }
  return null;
}

function parseAdr(body) {
  const heading = body.match(/^#\s+ADR[-\s]?\d+:\s*(.+)$/m);
  const title = heading ? heading[1].trim() : null;
  const statusRaw = extractField(body, 'Status');
  const status = statusRaw ? statusRaw.split('|')[0].trim().replace(/[*_`]/g, '').toLowerCase() : null;
  let supersedes = extractField(body, 'Supersedes');
  if (supersedes && /^none$/i.test(supersedes)) supersedes = null;
  const supersededMatch = supersedes && supersedes.match(/ADR[-\s]?(\d+)/);
  const supersedesId = supersededMatch ? `ADR-${supersededMatch[1].padStart(4, '0')}` : null;
  return { title, status, supersedes: supersedesId };
}

function parseFrontmatter(text) {
  if (!text.startsWith('---\n')) return {};
  const end = text.indexOf('\n---\n', 4);
  if (end === -1) return {};
  const block = text.slice(4, end);
  const out = {};
  for (const line of block.split('\n')) {
    const m = line.match(/^([A-Za-z0-9_]+):\s*(.*)$/);
    if (m) out[m[1]] = m[2].replace(/^["']|["']$/g, '').trim();
  }
  return out;
}

// Walk a directory tree collecting files that match a predicate.

function walk(dir, predicate, acc = []) {
  if (!existsSync(dir)) return acc;
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    const st = statSync(full);
    if (st.isDirectory()) walk(full, predicate, acc);
    else if (predicate(full)) acc.push(full);
  }
  return acc;
}

// Build the @enforces binding map: decision-id → [ "relpath:line", ... ].
// Scans the surfaces where enforcement actually lives: tests and hooks.

function collectEnforcementBindings({ repoRoot }) {
  const bindings = new Map();
  const files = [
    ...walk(join(repoRoot, 'tests'), (f) => f.endsWith('.mjs') || f.endsWith('.js')),
    ...walk(join(repoRoot, 'lib', 'hooks'), (f) => f.endsWith('.mjs')),
  ];
  for (const file of files) {
    const lines = readFileSync(file, 'utf8').split('\n');
    lines.forEach((line, i) => {
      const stripped = line.trim().replace(/^(?:\/\/|#|\*)\s?/, '');
      const m = stripped.match(ENFORCES_LINE_RE);
      if (!m) return;
      const id = m[1];
      if (!bindings.has(id)) bindings.set(id, []);
      bindings.get(id).push(`${relative(repoRoot, file)}:${i + 1}`);
    });
  }
  return bindings;
}

function adrDecisions({ repoRoot, bindings }) {
  const dir = join(repoRoot, 'docs', 'decisions', 'adr');
  const out = [];
  if (!existsSync(dir)) return out;
  for (const name of readdirSync(dir)) {
    if (!name.endsWith('.md') || name === '_template.md' || name === 'README.md') continue;
    const numMatch = name.match(/^(\d{4})-/);
    if (!numMatch) continue;
    const id = `ADR-${numMatch[1]}`;
    const file = join(dir, name);
    const text = readFileSync(file, 'utf8');
    const fm = parseFrontmatter(text);
    const { title, status, supersedes } = parseAdr(text);
    const enforcingTests = bindings.get(id) || [];
    out.push({
      id,
      kind: 'adr',
      title,
      status,
      supersedes,
      supersededBy: null,
      file: relative(repoRoot, file),
      lastVerifiedAt: fm.last_verified_at || null,
      enforcingTests,
      enforcingChecks: [],
      advisory: enforcingTests.length === 0,
    });
  }
  return out;
}

function contractDecisions({ repoRoot, bindings }) {
  const registryFile = join('registry', 'worker-profiles');
  let contractsArray;
  try {
    contractsArray = Object.values(loadRegistry({ rootDir: repoRoot, skipValidation: true }).contracts || {});
  } catch {
    return [];
  }
  const out = [];
  for (const c of contractsArray) {
    const checks = [];
    let advisoryPostconditions = 0;
    for (const pc of c.postconditions || []) {
      if (typeof pc !== 'object' || pc === null) { advisoryPostconditions += 1; continue; }
      if (pc.check) checks.push(pc.id || pc.check);
      else if (pc.postconditionType === 'advisory' || !pc.postconditionType) advisoryPostconditions += 1;
    }
    const enforcingTests = bindings.get(c.id) || [];
    out.push({
      id: c.id,
      kind: 'contract',
      title: `${c.producer} → ${c.consumer}`,
      status: 'accepted',
      supersedes: null,
      supersededBy: null,
      file: registryFile,
      lastVerifiedAt: null,
      enforcingTests,
      enforcingChecks: checks,
      advisoryPostconditions,
      advisory: checks.length === 0 && enforcingTests.length === 0,
    });
  }
  return out;
}

function ruleDecisions({ repoRoot, bindings }) {
  const dir = join(repoRoot, 'rules');
  const out = [];
  for (const file of walk(dir, (f) => f.endsWith('.md'))) {
    const rel = relative(repoRoot, file);
    const text = readRuleFile(rel, { rootDir: repoRoot, source: 'validation', callerContext: 'decisions-registry' });
    const fm = parseFrontmatter(text);
    const id = `rule:${relative(join(repoRoot, 'rules'), file).replace(/\.md$/, '')}`;
    const enforcedBy = fm.enforced_by ? fm.enforced_by.split(',').map((s) => s.trim()).filter(Boolean) : [];
    const enforcingTests = bindings.get(id) || [];
    out.push({
      id,
      kind: 'rule',
      title: fm.description || rel,
      status: 'accepted',
      supersedes: null,
      supersededBy: null,
      file: rel,
      lastVerifiedAt: null,
      enforcedBy,
      adrReference: fm.adr_reference || null,
      precedenceTier: fm.precedence_tier || null,
      enforcingTests,
      enforcingChecks: [],
      advisory: enforcedBy.length === 0 && enforcingTests.length === 0,
    });
  }
  return out;
}

/**
 * Build the full decision registry from source. Returns { decisions, byId }.
 * `supersededBy` is back-filled by inverting each decision's `supersedes` edge.
 */
export function buildRegistry({ repoRoot = REPO_ROOT } = {}) {
  const bindings = collectEnforcementBindings({ repoRoot });
  const decisions = [
    ...adrDecisions({ repoRoot, bindings }),
    ...contractDecisions({ repoRoot, bindings }),
    ...ruleDecisions({ repoRoot, bindings }),
  ].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));

  const byId = new Map(decisions.map((d) => [d.id, d]));
  for (const d of decisions) {
    if (d.supersedes && byId.has(d.supersedes)) byId.get(d.supersedes).supersededBy = d.id;
  }
  return { decisions, byId };
}

/**
 * Structural validation of the registry itself: every ADR id is well-formed and
 * every declared status is in the canonical enum. Binding-orphan checks (wvbf.2)
 * and supersede-chain checks (wvbf.3) are deliberately out of scope here.
 */
export function validateRegistry({ repoRoot = REPO_ROOT } = {}) {
  const { decisions } = buildRegistry({ repoRoot });
  const errors = [];
  for (const d of decisions) {
    if (d.status && !DECISION_STATUSES.includes(d.status)) {
      errors.push(`${d.id}: invalid status "${d.status}" (expected one of ${DECISION_STATUSES.join(', ')})`);
    }
    if (d.kind === 'adr' && !/^ADR-\d{4}$/.test(d.id)) {
      errors.push(`${d.id}: ADR id is not in ADR-NNNN form (${d.file})`);
    }
  }
  return { ok: errors.length === 0, errors, count: decisions.length };
}

const BASELINE_FILE = join(REPO_ROOT, 'lib', 'decisions', 'enforced-baseline.json');

// A decision is enforced when something mechanical guards it: an @enforces test
// binding, an executable contract check, or a declared rule enforcer. Kept in
// lockstep with the `advisory` flag set per decision in the builders.

function isEnforced(d) {
  return (d.enforcingTests && d.enforcingTests.length > 0)
    || (d.enforcingChecks && d.enforcingChecks.length > 0)
    || (d.enforcedBy && d.enforcedBy.length > 0);
}

export function enforcedIds({ repoRoot = REPO_ROOT } = {}) {
  return buildRegistry({ repoRoot }).decisions.filter(isEnforced).map((d) => d.id).sort();
}

function loadBaseline(repoRoot) {
  const file = repoRoot === REPO_ROOT ? BASELINE_FILE : join(repoRoot, 'lib', 'decisions', 'enforced-baseline.json');
  if (!existsSync(file)) return [];
  return JSON.parse(readFileSync(file, 'utf8')).enforced || [];
}

/**
 * The durability gate (bead wvbf.2). Two failure classes, each a silent reversal
 * of a decision:
 *   - dangling: an @enforces marker points at a decision id absent from the
 *     registry (a typo, or a binding that outlived its decision).
 *   - regression: a decision in the enforced baseline lacks enforcement in the
 *     live tree (its enforcing test or contract check is gone). This is the
 *     ratchet — the baseline is the floor; enforcement may only be added by
 *     regenerating it, and dropping below it fails the gate.
 */
export function checkBindings({ repoRoot = REPO_ROOT } = {}) {
  const { decisions, byId } = buildRegistry({ repoRoot });
  const dangling = [];
  const bindings = collectEnforcementBindings({ repoRoot });
  for (const [id, locations] of bindings) {
    if (!byId.has(id)) dangling.push({ id, locations });
  }

  const enforcedNow = new Set(decisions.filter(isEnforced).map((d) => d.id));
  const regressions = loadBaseline(repoRoot).filter((id) => !enforcedNow.has(id));

  return { ok: dangling.length === 0 && regressions.length === 0, dangling, regressions };
}

/**
 * Supersede-chain validation (bead wvbf.3), pure over a decisions array so the
 * failure cases are testable without fixtures on disk. Four violation classes:
 *   - a Supersedes pointing at an unknown decision;
 *   - a superseding edge whose target is not marked status `superseded`;
 *   - a decision marked `superseded` that nothing supersedes (a dangling claim);
 *   - a cycle in the supersede graph.
 */
export function checkSupersessionOn(decisions) {
  const byId = new Map(decisions.map((d) => [d.id, d]));
  const supersededByMap = new Map();
  for (const d of decisions) {
    if (d.supersedes && byId.has(d.supersedes)) supersededByMap.set(d.supersedes, d.id);
  }
  const violations = [];

  for (const d of decisions) {
    if (!d.supersedes) continue;
    const target = byId.get(d.supersedes);
    if (!target) {
      violations.push(`${d.id} supersedes unknown decision ${d.supersedes}`);
      continue;
    }
    if (target.status !== 'superseded') {
      violations.push(`${d.id} supersedes ${target.id}, but ${target.id} status is "${target.status || 'n/a'}" (expected superseded)`);
    }
  }

  for (const d of decisions) {
    if (d.status === 'superseded' && !supersededByMap.has(d.id)) {
      violations.push(`${d.id} is marked superseded but no decision supersedes it`);
    }
  }

  for (const start of decisions) {
    const seen = new Set();
    let cur = start;
    while (cur && cur.supersedes) {
      if (seen.has(cur.id)) {
        violations.push(`supersede cycle through ${cur.id}`);
        break;
      }
      seen.add(cur.id);
      cur = byId.get(cur.supersedes);
    }
  }

  return { ok: violations.length === 0, violations: [...new Set(violations)] };
}

export function checkSupersession({ repoRoot = REPO_ROOT } = {}) {
  return checkSupersessionOn(buildRegistry({ repoRoot }).decisions);
}

// A rule may declare its enforcer in frontmatter (enforced_by: path[, path],
// adr_reference: ADR-NNNN). Declaring it is optional; declaring it wrong is not.

function looksLikePath(value) {
  return value.includes('/') || /\.(mjs|js|json|sh)$/.test(value);
}

/**
 * Validate rule → enforcer linkage (bead wvbf.4). For every rule that declares
 * `enforced_by`, each path-like reference must exist; a declared `adr_reference`
 * must resolve to a known ADR. Broken linkage fails; absent linkage does not.
 */
export function checkRuleLinkage({ repoRoot = REPO_ROOT } = {}) {
  const { decisions, byId } = buildRegistry({ repoRoot });
  const violations = [];
  for (const d of decisions) {
    if (d.kind !== 'rule') continue;
    for (const ref of d.enforcedBy || []) {
      if (looksLikePath(ref) && !existsSync(resolve(repoRoot, ref))) {
        violations.push(`${d.id}: enforced_by path not found: ${ref}`);
      }
    }
    if (d.adrReference) {
      const refs = String(d.adrReference).split(',').map((s) => s.trim()).filter(Boolean);
      for (const ref of refs) {
        if (!byId.has(ref)) {
          violations.push(`${d.id}: adr_reference ${ref} does not resolve to a known decision`);
        }
      }
    }
  }
  return { ok: violations.length === 0, violations };
}

function summarize(decisions) {
  const byKind = {};
  let advisory = 0;
  for (const d of decisions) {
    byKind[d.kind] = (byKind[d.kind] || 0) + 1;
    if (d.advisory) advisory += 1;
  }
  return { total: decisions.length, byKind, advisory, enforced: decisions.length - advisory };
}

/**
 * CLI entry: `construct decisions [list|validate|json]`.
 * list (default) prints a table; validate runs validateRegistry and exits 1 on
 * error; json emits the full registry for downstream tooling.
 */
export async function runDecisionsCli(args = []) {
  const sub = args[0] && !args[0].startsWith('-') ? args[0] : 'list';

  if (sub === 'json' || args.includes('--json')) {
    const { decisions } = buildRegistry();
    process.stdout.write(JSON.stringify({ decisions, summary: summarize(decisions) }, null, 2) + '\n');
    return;
  }

  if (sub === 'validate') {
    const { ok, errors, count } = validateRegistry();
    if (ok) {
      process.stdout.write(`✓ decision registry valid — ${count} decisions\n`);
      return;
    }
    process.stderr.write(`✗ decision registry has ${errors.length} error(s):\n`);
    for (const e of errors) process.stderr.write(`  - ${e}\n`);
    process.exit(1);
  }

  if (sub === 'check') {
    const { validatePrecedenceTiersOn } = await import('./precedence.mjs');
    const bindings = checkBindings();
    const supersession = checkSupersession();
    const linkage = checkRuleLinkage();
    const precedence = validatePrecedenceTiersOn(buildRegistry().decisions);
    if (bindings.ok && supersession.ok && linkage.ok && precedence.ok) {
      process.stdout.write('✓ decision graph intact — bindings bound, supersede chains valid, rule linkage resolves, precedence tiers valid\n');
      return;
    }
    for (const d of bindings.dangling) {
      process.stderr.write(`✗ dangling @enforces "${d.id}" at ${d.locations.join(', ')}\n`);
    }
    for (const id of bindings.regressions) {
      process.stderr.write(`✗ enforcement regression: "${id}" is in the baseline but no longer enforced\n`);
    }
    for (const v of supersession.violations) {
      process.stderr.write(`✗ supersede: ${v}\n`);
    }
    for (const v of linkage.violations) {
      process.stderr.write(`✗ rule-linkage: ${v}\n`);
    }
    for (const v of precedence.violations) {
      process.stderr.write(`✗ precedence: ${v}\n`);
    }
    process.exit(1);
  }

  if (sub === 'golden') {
    const { runGoldenCli } = await import('./golden.mjs');
    return runGoldenCli(args.slice(1));
  }

  if (sub === 'baseline') {
    const enforced = enforcedIds();
    if (args.includes('--write')) {
      const { writeFileSync } = await import('node:fs');
      writeFileSync(BASELINE_FILE, JSON.stringify({ enforced }, null, 2) + '\n');
      process.stdout.write(`✓ wrote enforced baseline — ${enforced.length} decisions\n`);
      return;
    }
    process.stdout.write(JSON.stringify({ enforced }, null, 2) + '\n');
    return;
  }

  const { decisions } = buildRegistry();
  const s = summarize(decisions);
  process.stdout.write(`Decisions: ${s.total} (${s.enforced} enforced, ${s.advisory} advisory)\n`);
  process.stdout.write(`  by kind: ${Object.entries(s.byKind).map(([k, n]) => `${k}=${n}`).join(' ')}\n\n`);
  for (const d of decisions) {
    const mark = d.advisory ? '○' : '●';
    const sup = d.supersededBy ? ` superseded-by ${d.supersededBy}` : '';
    process.stdout.write(`${mark} ${d.id}  [${d.kind}/${d.status || 'n/a'}]  ${d.title || ''}${sup}\n`);
  }
}
