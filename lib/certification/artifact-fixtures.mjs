/**
 * lib/certification/artifact-fixtures.mjs — golden artifact fixtures per manifest type.
 *
 * Builds minimal valid markdown derived from registry/artifact-manifest.json
 * structure and visual requirements so release-gate tests can reference stable
 * fixtures under tests/fixtures/artifacts/<type>/.
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
    parts.push(`This paragraph supports the ${label} section with observable evidence. Source: https://example.com/fixture (accessed 2026-06-22).`);
  }
  return parts.join(' ');
}

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

  for (const section of entry.structureRequirements ?? []) {
    lines.push(`## ${section}`, '');
    if (section === 'Phases' && type === 'prd') {
      lines.push('### Phase 1: Fixture delivery', '', '- **Goal**: Ship an isolated billing ledger per tenant.', '- **Status**: not started', '', '**Functional**', '', '- **FR-1.1**: Each tenant invoice derives only from that tenant ledger events.', '  - *Acceptance*: Reconciliation test passes without cross-tenant reads.', '');
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

  if (entry.releaseGate?.citationLint) {
    lines.push('## References', '', '- https://example.com/fixture-source (accessed 2026-06-22)', '');
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
