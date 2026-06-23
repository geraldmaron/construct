/**
 * emit-beads.mjs — turn findings.json into a dependency-ordered bd backlog.
 *
 * Clusters findings by (phase, type) so each bead is one self-contained concern with its
 * full item list, a deterministic acceptance command (re-run the owning phase harness; the
 * type's count must reach 0), and a model-tier label. Idempotent: a cluster already emitted
 * is updated in place via the mapping in audit-artifacts/emitted-beads.json, never duplicated.
 *
 * Run: node scripts/audit/emit-beads.mjs [--epic=construct-ij31] [--dry-run]
 */

import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { readJson, writeJson } from './lib/artifacts.mjs';

const SEVERITY_PRIORITY = { critical: '0', high: '1', medium: '2', low: '3', info: '4' };
const SEVERITY_RANK = { critical: 0, high: 1, medium: 2, low: 3, info: 4 };

const PHASE_HARNESS = {
  '01-smoke': 'scripts/audit/01-smoke.mjs',
  '02-deadcode': 'scripts/audit/02-deadcode.mjs',
  '03-docs': 'scripts/audit/03-docs.mjs',
  '03b-naming': 'scripts/audit/03b-naming.mjs',
  '03d-brand': 'scripts/audit/03d-brand.mjs',
  '03c-root-layout': 'scripts/audit/03c-root-layout.mjs',
  '06-audit': 'scripts/audit/06-audit.mjs',
};

function bd(args) {
  return execFileSync('bd', args, { encoding: 'utf8' });
}

function clusterKey(f) {
  return `${f.phase}::${f.type}`;
}

function buildClusters(findings) {
  const groups = new Map();
  for (const f of findings) {
    if (f.status !== 'open') continue;
    const key = clusterKey(f);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(f);
  }
  const clusters = [];
  for (const [key, items] of groups) {
    const [phase, type] = key.split('::');
    const worst = items.slice().sort((a, b) => SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity])[0];
    const tier = items.some((i) => i.tier === 'judgment') ? 'judgment' : (items.some((i) => i.tier === 'opus') ? 'opus' : 'mechanical');
    const harness = PHASE_HARNESS[phase] || `scripts/audit/${phase}.mjs`;
    const list = items.map((i) => `- ${i.target}${i.evidence ? ` — ${i.evidence}` : ''}`).join('\n');
    const title = `[${type}] remediate ${items.length} item(s) (${phase})`;
    const description = [
      `Remediate ${items.length} \`${type}\` finding(s) from audit ${phase}.`,
      '',
      `Recommendation: ${worst.recommendation || 'see items'}`,
      '',
      'Items:',
      list,
      '',
      `Acceptance: \`node ${harness}\` reports 0 \`${type}\` findings (verify in audit-artifacts/findings.json).`,
    ].join('\n');
    clusters.push({ key, phase, type, tier, severity: worst.severity, title, description, count: items.length });
  }
  return clusters.sort((a, b) => SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity] || a.key.localeCompare(b.key));
}

function main() {
  const argv = process.argv.slice(2);
  const epic = (argv.find((a) => a.startsWith('--epic=')) || '--epic=construct-ij31').split('=')[1];
  const dryRun = argv.includes('--dry-run');

  const ledger = readJson('findings.json');
  if (!ledger) { process.stdout.write('[emit-beads] no findings.json yet — run a phase first.\n'); return; }
  const emitted = readJson('emitted-beads.json') || {};
  const clusters = buildClusters(ledger.findings);

  let created = 0;
  let updated = 0;
  for (const c of clusters) {
    const priority = SEVERITY_PRIORITY[c.severity] || '2';
    if (emitted[c.key]) {
      if (!dryRun) {
        bd(['update', emitted[c.key], '--description', c.description, '--priority', priority]);
      }
      updated += 1;
      continue;
    }
    if (dryRun) { process.stdout.write(`[emit-beads] would create: ${c.title} [P${priority} tier:${c.tier}]\n`); created += 1; continue; }
    const out = bd(['create', '--parent', epic, '--title', c.title, '--description', c.description,
      '--type', 'task', '--priority', priority, '--labels', `audit,tier:${c.tier}`]);
    const id = (out.match(/construct-[a-z0-9.]+/) || [])[0];
    if (id) { emitted[c.key] = id; created += 1; }
  }

  if (!dryRun) writeJson('emitted-beads.json', emitted);
  process.stdout.write(`[emit-beads] ${clusters.length} cluster(s): ${created} created, ${updated} updated${dryRun ? ' (dry-run)' : ''}.\n`);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) main();
