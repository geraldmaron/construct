/**
 * lib/certification/artifact-fixtures.mjs — golden artifact fixtures per manifest type.
 *
 * Builds minimal valid markdown derived from registry/artifact-manifest.json
 * structure and visual requirements so release-gate tests can reference stable
 * fixtures under tests/fixtures/artifacts/<type>/. Depth markers mirror
 * lintArtifactDeliveryDepth contracts in lib/templates/visual-requirements.mjs.
 */

import fs from 'node:fs';
import path from 'node:path';
import { artifactTypes, getArtifactEntry } from '../artifact-manifest.mjs';
import { validateArtifactRelease } from '../artifact-release-gate.mjs';

function findConstructRoot(startPath = process.cwd()) {
  let current = path.resolve(startPath);
  while (true) {
    if (fs.existsSync(path.join(current, 'package.json')) && fs.existsSync(path.join(current, 'tests'))) return current;
    const parent = path.dirname(current);
    if (parent === current) return path.resolve(startPath);
    current = parent;
  }
}

function proseBlock(label, sentences = 3) {
  const parts = [];
  for (let i = 0; i < sentences; i += 1) {
    parts.push(`This paragraph supports the ${label} section with observable evidence. Source: [fixture source](https://example.com/fixture) (accessed 2026-06-22).`);
  }
  return parts.join(' ');
}

const WHY_NOW_TIMING_TABLE = [
  '| Timing dimension | Estimate / window | Source |',
  '|---|---|---|',
  '| Revenue at risk | unknown | [unverified] — owner: pm by 2026-08-15 |',
  '| Upside / opportunity window | unknown | [unverified] |',
  '| Market timing | unknown | [unverified] |',
  '| Cost of delay | support toil compounds | playbook |',
  '| Competitive window | unknown | see Competitive |',
  '| Compliance / legal deadline | PII on share grant | privacy |',
].join('\n');

const COMPETITIVE_FINANCIAL_BLOCK = [
  '### Competitive landscape',
  '',
  'Prose on alternatives, then a small matrix.',
  '',
  '| Competitor / alternative | Dimension | Their approach | Our stance | Source |',
  '|---|---|---|---|---|',
  '| Email | workflow | forks | differentiate | observed |',
  '',
  '### Financial considerations',
  '',
  'One short paragraph on structural economics.',
  '',
  '| Item | Low | Base | High | Source |',
  '|---|---|---|---|---|',
  '| Build / run cost | unknown | unknown | unknown | [unverified] — owner: eng by 2026-08-15 |',
  '| Unit economics | unknown | unknown | unknown | [unverified] |',
  '| Expected value / ROI | unknown | unknown | unknown | [unverified] |',
].join('\n');

function mermaidForDiagram(diagram) {
  if (diagram === 'sequenceDiagram') {
    return '```mermaid\nsequenceDiagram\n  Client->>Service: request\n  Service-->>Client: response\n```';
  }
  return '```mermaid\nflowchart LR\n  A[Start] --> B[End]\n```';
}

function tableForColumns(columns) {
  const header = `| ${columns.join(' | ')} |`;
  const sep = `| ${columns.map(() => '---').join(' | ')} |`;
  const row = `| ${columns.map((c) => `${c} value`).join(' | ')} |`;
  return [header, sep, row].join('\n');
}

function depthBodyForSection(type, section) {
  if ((type === 'prd' || type === 'prd-platform') && section === 'Why This Matters Now') {
    return [
      'Timing thesis with financially meaningful pressure.',
      '',
      WHY_NOW_TIMING_TABLE,
      '',
    ].join('\n');
  }
  if ((type === 'prd' || type === 'prd-platform') && section === 'Competitive Landscape & Financial Considerations') {
    return COMPETITIVE_FINANCIAL_BLOCK;
  }
  if ((type === 'prd' || type === 'prd-platform') && section === 'Phases') {
    return [
      '### Phase 1: Fixture delivery',
      '',
      '- **Why?**: Tenant billing owners need isolated ledgers so reconciliation stops cross-reading neighbor data.',
      '- **Goal**: Ship an isolated billing ledger per tenant.',
      '- **Status**: not started',
      '- **Requirements**: FR-1.1',
      '',
    ].join('\n');
  }
  if ((type === 'prd' || type === 'prd-platform') && section === 'Requirements') {
    return [
      '### Phase 1 — Fixture delivery',
      '',
      '**Why?** Billing operators need per-tenant isolation so invoices derive from one ledger.',
      '',
      '#### FR-1.1: Isolate tenant ledger',
      '',
      'Each tenant invoice derives only from that tenant ledger events.',
      '',
      '- **Phase**: 1',
      '- **Acceptance criteria**: AC-1.1.1',
      '',
    ].join('\n');
  }
  if ((type === 'prd' || type === 'prd-platform') && section === 'Acceptance Criteria') {
    return [
      '| AC id | FR id | Criterion (stranger-checkable) | Verification method |',
      '|---|---|---|---|',
      '| AC-1.1.1 | FR-1.1 | Reconciliation test passes without cross-tenant reads | automated |',
      '',
    ].join('\n');
  }
  if (type === 'meta-prd' && section === 'Phases') {
    return [
      '### Phase 1: Evidence gate',
      '',
      '- **Goal**: Require cited sources before review.',
      '- **Status**: not started',
      '- **Requirements**: MR-1.1, DR-1.1',
      '',
      '**Workflow**',
      '',
      '- **MR-1.1**: Workflow blocks review without two sources.',
      '  - *Acceptance*: Trace shows gate fired on missing citations.',
      '',
      '**Document + evaluation**',
      '',
      '- **DR-1.1**: Template requires a Sources table.',
      '  - *Acceptance*: Structural lint fails when Sources is absent.',
      '',
    ].join('\n');
  }
  if (type === 'prd-business' && section === 'Financial frame') {
    return [
      'Low / Base / High ranges for structural economics.',
      '',
      '| Item | Low | Base | High | Source |',
      '|---|---|---|---|---|',
      '| Build / run cost | unknown | unknown | unknown | [unverified] |',
      '| Unit economics | unknown | unknown | unknown | [unverified] |',
      '| Revenue model | unknown | unknown | unknown | [unverified] |',
      '',
    ].join('\n');
  }
  if (type === 'meta-prd' && section === 'Timing & stakes') {
    return [
      'Revenue at risk compounds if we defer the evidence gate; cost of delay includes reviewer toil.',
      '',
      '| Stake | Estimate | Source |',
      '|---|---|---|',
      '| Revenue at risk | unknown | [unverified] |',
      '| Cost of delay | reviewer toil compounds | playbook |',
      '| Competitive window | rivals ship ungoverned exports | observed |',
      '| Compliance / legal deadline | citation policy audit | compliance |',
      '',
    ].join('\n');
  }
  if (type === 'prd-business' && section === 'Kill criteria') {
    return [
      '| Leading indicator | Threshold | Action when crossed | Owner |',
      '|---|---|---|---|',
      '| Pilot conversion | below 5% after 90 days | abandon | pm |',
      '',
      'Kill criteria must be monitorable.',
      '',
    ].join('\n');
  }
  if (type === 'prd-business' && section === 'Risks') {
    return [
      '### Adversarial challenge (FMEA)',
      '',
      '| Failure mode | Effect | Cause | S×O×D (1–10) | Mitigation or accept-with-rationale |',
      '|---|---|---|---|---|',
      '| Wrong market segment | Burned runway | Weak thesis | 8×6×4 | Kill criteria above |',
      '',
    ].join('\n');
  }
  if (type === 'adr' && section === 'Adversarial challenge') {
    return [
      '| Challenge | Severity | Response |',
      '|---|---|---|',
      '| Decision is premature without load test | high | Accept with revisit trigger |',
      '',
    ].join('\n');
  }
  if (type === 'adr' && section === 'Rejected alternatives') {
    return [
      '| Alternative | What it is | Why rejected | Reconsider if |',
      '|---|---|---|---|',
      '| Option A | Shared ledger | Cross-tenant risk | Isolation proven |',
      '',
    ].join('\n');
  }
  if ((type === 'rfc' || type === 'rfc-platform') && section === 'Risks') {
    return [
      '### Adversarial challenge (FMEA)',
      '',
      '| Failure mode | Effect | Cause | S×O×D (1–10) | Mitigation or accept-with-rationale |',
      '|---|---|---|---|---|',
      '| Migration stalls | Dual-write forever | Weak consumer plan | 7×5×3 | Kill switch in rollout |',
      '',
    ].join('\n');
  }
  if (type === 'strategy' && section === 'Bets') {
    return [
      proseBlock('Bets', 2),
      '',
      '| Bet | Why | Leading indicator | Kill criterion | Owner |',
      '|---|---|---|---|---|',
      '| Focus on teams | Retention | Weekly active teams | Flat for 2 quarters | pm |',
      '',
    ].join('\n');
  }
  if (type === 'research-brief' && section === 'Sources') {
    return [
      '| Source | Type | Accessed | Link |',
      '|---|---|---|---|',
      '| Fixture corpus | internal | 2026-06-22 | [fixture source](https://example.com/fixture) |',
      '',
    ].join('\n');
  }
  if (type === 'research-brief' && section === 'Findings') {
    return [
      '### Finding 1: Fixture finding',
      '',
      '**Observation**: Sources state X.',
      '**Inference**: Therefore Y - labeled as inference.',
      '**Confidence**: medium: limited sample',
      '**Sources**: [fixture source](https://example.com/fixture)',
      '',
    ].join('\n');
  }
  if (type === 'research-brief' && section === 'References') {
    return [
      '- [Fixture source](https://example.com/fixture) (accessed 2026-06-22)',
      '',
    ].join('\n');
  }
  if (type === 'runbook' && section === 'Diagnostic steps') {
    return [
      '| Step | Check | How | Expected if healthy | If unhealthy → |',
      '|---|---|---|---|---|',
      '| D-1 | Error rate | Dashboard | <1% | Remediation R-1 |',
      '',
      '```mermaid',
      'flowchart LR',
      '  A[Alert] --> B[Diagnose]',
      '```',
      '',
    ].join('\n');
  }
  if (type === 'runbook' && section === 'Rollback') {
    return [
      '| Step | Action | Expected output | Last tested |',
      '|---|---|---|---|',
      '| RB-1 | Revert flag | Prior healthy rate | 2026-06-22 |',
      '',
    ].join('\n');
  }
  if (type === 'runbook' && section === 'Adversarial challenge') {
    return [
      '| Failure mode | Effect | Mitigation |',
      '|---|---|---|',
      '| Stale credentials | Operator stranded | Break-glass account |',
      '',
    ].join('\n');
  }
  return null;
}

export function goldenFixtureRelPath(type) {
  return path.join('tests', 'fixtures', 'artifacts', type, 'golden.md');
}

export function goldenFixturePath(type, { rootDir } = {}) {
  const root = findConstructRoot(rootDir);
  return path.join(root, goldenFixtureRelPath(type));
}

export function buildGoldenFixtureMarkdown(type, { rootDir } = {}) {
  const root = findConstructRoot(rootDir);
  const entry = getArtifactEntry(type, { rootDir: root });
  if (!entry) throw new Error(`unknown artifact type: ${type}`);

  const lines = [
    '---',
    `description: Golden ${type} fixture for artifact release-gate certification tests.`,
    `cx_fixture_type: ${type}`,
    `cx_fixture_source: ${entry.template}`,
    '---',
    '',
    `# Golden fixture: ${type}`,
    '',
  ];

  const proseMinimum = entry.releaseGate?.proseMinimum ?? 0;
  let proseAdded = 0;
  const sections = entry.structureRequirements ?? [];
  const hasReferencesSection = sections.some((s) => s.toLowerCase() === 'references');

  for (const section of sections) {
    lines.push(`## ${section}`, '');
    const depth = depthBodyForSection(type, section);
    if (depth) {
      lines.push(depth);
      proseAdded += 1;
    } else if (proseAdded < proseMinimum) {
      lines.push(proseBlock(section));
      proseAdded += 1;
    } else {
      lines.push(`Fixture content for ${section}.`);
    }
    lines.push('');
  }

  for (const visual of entry.visualRequirements ?? []) {
    if (visual.check === 'artifact-has-mermaid') {
      lines.push(mermaidForDiagram(visual.diagram ?? 'flowchart'), '');
    }
    if (visual.check === 'artifact-table-has-columns' && Array.isArray(visual.columns)) {
      lines.push(tableForColumns(visual.columns), '');
    }
  }

  while (proseAdded < proseMinimum) {
    lines.push(proseBlock('supplemental'), '');
    proseAdded += 1;
  }

  if (entry.releaseGate?.citationLint && !hasReferencesSection) {
    lines.push('## References', '', '- [Example fixture source](https://example.com/fixture-source) (accessed 2026-06-22)', '');
  } else if (entry.releaseGate?.citationLint && hasReferencesSection) {
    const joined = lines.join('\n');
    if (!/https?:\/\//.test(joined)) {
      lines.push('- [Example fixture source](https://example.com/fixture-source) (accessed 2026-06-22)', '');
    }
  }

  return `${lines.join('\n').trim()}\n`;
}

export function writeGoldenFixtures({ rootDir } = {}) {
  const root = findConstructRoot(rootDir);
  const written = [];
  const failures = [];

  for (const type of artifactTypes({ rootDir: root })) {
    const rel = goldenFixtureRelPath(type);
    const abs = path.join(root, rel);
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    const markdown = buildGoldenFixtureMarkdown(type, { rootDir: root });
    fs.writeFileSync(abs, markdown);
    const validation = validateArtifactRelease({ filePath: abs, type, rootDir: root });
    if (!validation.ok) failures.push({ type, errors: validation.errors });
    written.push({ type, path: rel, ok: validation.ok });
  }

  return { written, failures };
}

export function listGoldenFixturePaths({ rootDir } = {}) {
  const root = findConstructRoot(rootDir);
  return artifactTypes({ rootDir: root }).map((type) => ({
    type,
    path: goldenFixtureRelPath(type),
    exists: fs.existsSync(goldenFixturePath(type, { rootDir: root })),
  }));
}
