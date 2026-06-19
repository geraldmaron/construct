/**
 * tests/functional/publish-template.functional.test.mjs — PDF template routing and metadata.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import {
  ARTIFACT_TEMPLATE_MAP,
  BRAND,
  resolvePdfTemplatePath,
  templateForArtifactType,
  parseArtifactMetadata,
  pandocMetadataArgs,
  formatPublishDate,
  preprocessMarkdownForPdfExport,
} from '../../lib/publish-template.mjs';
import {
  distributionDiagramDefaults,
  injectMermaidBrandTheme,
  preprocessMarkdownDiagrams,
  buildDistributionDiagramEnv,
} from '../../lib/diagram-export.mjs';

const REPO = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..', '..');
const GOLDEN = path.join(REPO, 'tests', 'fixtures', 'publish', 'golden-prd-platform.md');

test('BRAND uses violet accent not cyan', () => {
  assert.equal(BRAND.accent, '#8b5cf6');
  assert.notEqual(BRAND.accent, '#38bdf8');
});

test('templateForArtifactType routes prd-platform to construct-prd.typ', () => {
  assert.equal(templateForArtifactType('prd-platform'), 'construct-prd.typ');
  assert.equal(templateForArtifactType('research-brief'), 'construct-research.typ');
  assert.equal(templateForArtifactType('adr'), 'construct-decision.typ');
  assert.equal(templateForArtifactType('unknown-type'), 'construct-pdf.typ');
});

test('resolvePdfTemplatePath selects bundled type template', () => {
  const prdPath = resolvePdfTemplatePath({ artifactType: 'prd-platform', cwd: REPO, repoRoot: REPO });
  assert.ok(prdPath.endsWith('construct-prd.typ'));
  assert.ok(fs.existsSync(prdPath));
});

test('resolvePdfTemplatePath prefers project override', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'publish-theme-'));
  try {
    const override = path.join(dir, '.cx', 'publish-theme.typ');
    fs.mkdirSync(path.dirname(override), { recursive: true });
    fs.writeFileSync(override, '#set text(size: 12pt)\n$body$', 'utf8');
    const resolved = resolvePdfTemplatePath({ artifactType: 'prd-platform', cwd: dir, repoRoot: REPO });
    assert.equal(resolved, override);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('parseArtifactMetadata reads golden fixture fields', () => {
  const meta = parseArtifactMetadata(GOLDEN);
  assert.match(meta.title, /Enterprise Agentic Platform/);
  assert.equal(meta.status, 'draft');
  assert.equal(meta.owner, 'cx-product-manager');
  assert.equal(meta.artifactType, 'prd-platform');
  assert.equal(meta.date, '2026-06-19');
  assert.equal(meta.subtitle, '');
});

test('formatPublishDate normalizes Date objects to ISO dates', () => {
  assert.equal(formatPublishDate(new Date('2026-06-19T00:00:00.000Z')), '2026-06-19');
  assert.equal(formatPublishDate('2026-06-19'), '2026-06-19');
});

test('preprocessMarkdownForPdfExport strips duplicate cover title and metadata bullets', () => {
  const raw = fs.readFileSync(GOLDEN, 'utf8');
  const meta = parseArtifactMetadata(GOLDEN);
  const out = preprocessMarkdownForPdfExport(raw, meta);
  assert.doesNotMatch(out, /^#\s+Platform PRD/m);
  assert.doesNotMatch(out, /\*\*Owner\*\*:/);
  assert.match(out, /^>\s+Platform teams need/m);
  assert.match(out, /^## Problem/m);
});

test('pandocMetadataArgs forwards non-empty metadata', () => {
  const args = pandocMetadataArgs({ title: 'T', status: 'draft', owner: '', artifactType: 'prd-platform' });
  assert.deepEqual(args, ['-M', 'title=T', '-M', 'status=draft', '-M', 'artifactType=prd-platform']);
});

test('distribution diagram defaults use neutral theme', () => {
  const defaults = distributionDiagramDefaults();
  assert.equal(defaults.d2Theme, 'neutral');
  assert.equal(defaults.accent, BRAND.accent);
});

test('injectMermaidBrandTheme adds init preamble with brand accent', () => {
  const out = injectMermaidBrandTheme('flowchart TD\n  A --> B');
  assert.match(out, /%%\{init:/);
  assert.match(out, /8b5cf6/);
  assert.doesNotMatch(out, /sketch/i);
});

test('preprocessMarkdownDiagrams brands mermaid fences only', () => {
  const md = '# Doc\n\n```mermaid\nflowchart TD\n  A --> B\n```\n\n```d2\na -> b\n```\n';
  const out = preprocessMarkdownDiagrams(md);
  assert.match(out, /8b5cf6/);
  assert.match(out, /```d2/);
});

test('buildDistributionDiagramEnv sets CONSTRUCT_D2_THEME', () => {
  const env = buildDistributionDiagramEnv({});
  assert.equal(env.CONSTRUCT_D2_THEME, '0');
  assert.equal(env.CONSTRUCT_MERMAID_THEME, 'construct');
});

test('ARTIFACT_TEMPLATE_MAP covers all prd family types', () => {
  for (const type of ['prd', 'prd-platform', 'prd-business', 'meta-prd']) {
    assert.equal(ARTIFACT_TEMPLATE_MAP[type], 'construct-prd.typ');
  }
});
