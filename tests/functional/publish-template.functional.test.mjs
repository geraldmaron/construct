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
  resolvePuppeteerExecutable,
} from '../../lib/diagram-export.mjs';
import { pdfEngineFontOpts } from '../../lib/document-export.mjs';

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
  assert.match(meta.subtitle, /Governed agentic platform/);
  assert.equal(meta.version, '0.1');
  assert.equal(meta.docId, 'PRD-PLATFORM-001');
});

test('bundled distribution fonts ship with templates', () => {
  const fontDir = path.join(REPO, 'templates', 'distribution', 'fonts');
  for (const file of [
    'Geist-Regular.ttf',
    'Geist-SemiBold.ttf',
    'GeistMono-Regular.ttf',
  ]) {
    assert.ok(fs.existsSync(path.join(fontDir, file)), `missing font ${file}`);
  }
});

test('construct-prd.typ imports brand and omits stale style helper calls', () => {
  const prd = fs.readFileSync(path.join(REPO, 'templates', 'distribution', 'construct-prd.typ'), 'utf8');
  assert.match(prd, /construct-masthead/);
  assert.doesNotMatch(prd, /construct-body-text/);
  assert.doesNotMatch(prd, /construct-heading-style/);
  assert.doesNotMatch(prd, /pagebreak/);
  assert.doesNotMatch(prd, /construct-hero/);
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
  const args = pandocMetadataArgs({
    title: 'T',
    status: 'draft',
    owner: '',
    artifactType: 'prd-platform',
    version: '0.1',
    docId: 'DOC-1',
  });
  assert.deepEqual(args, [
    '-M', 'title=T',
    '-M', 'status=draft',
    '-M', 'artifactType=prd-platform',
    '-M', 'version=0.1',
    '-M', 'docId=DOC-1',
  ]);
});

test('distribution diagram defaults use compact hand-drawn sizing', () => {
  const defaults = distributionDiagramDefaults();
  assert.equal(defaults.d2Theme, 'neutral');
  assert.equal(defaults.d2Sketch, true);
  assert.equal(defaults.d2Scale, 0.9);
  assert.equal(defaults.d2FontSize, 15);
  assert.equal(defaults.figureMaxWidth, '74%');
  assert.equal(defaults.mermaidLook, 'handDrawn');
  assert.equal(defaults.mermaidWidth, 640);
  assert.equal(defaults.mermaidScale, 2);
  assert.equal(defaults.accent, '#0a0c10');
});

test('injectMermaidBrandTheme adds handDrawn init with monochrome ink and handwritten font', () => {
  const out = injectMermaidBrandTheme('flowchart TD\n  A --> B');
  assert.match(out, /%%\{init:/);
  assert.match(out, /handDrawn/);
  assert.match(out, /Caveat/);
  assert.match(out, /0a0c10/);
  assert.doesNotMatch(out, /8b5cf6/);
});

test('preprocessMarkdownDiagrams brands mermaid and d2 fences monochrome', () => {
  const md = '# Doc\n\n```mermaid\nflowchart TD\n  A --> B\n```\n\n```d2\na -> b\n```\n';
  const out = preprocessMarkdownDiagrams(md);
  assert.match(out, /0a0c10/);
  assert.doesNotMatch(out, /8b5cf6/);
  assert.match(out, /style\.font-size: 15/);
  assert.match(out, /```d2/);
});

test('buildDistributionDiagramEnv sets CONSTRUCT_D2_THEME and sketch flag', () => {
  const env = buildDistributionDiagramEnv({});
  assert.equal(env.CONSTRUCT_D2_THEME, '0');
  assert.equal(env.CONSTRUCT_D2_SCALE, '0.9');
  assert.equal(env.CONSTRUCT_D2_SKETCH, '1');
  assert.equal(env.CONSTRUCT_MERMAID_THEME, 'construct');
  assert.equal(env.CONSTRUCT_MERMAID_WIDTH, '640');
});

test('construct-brand.typ uses Geist family names for body prose', () => {
  const brand = fs.readFileSync(path.join(REPO, 'templates', 'distribution', 'construct-brand.typ'), 'utf8');
  assert.match(brand, /construct-font-sans = \("Geist",\)/);
  assert.match(brand, /set text\(font: construct-font-sans[\s\S]*justify: false/);
  assert.doesNotMatch(brand, /Libertinus|SourceSerif|Inter Display|IBM Plex/);
  assert.match(brand, /construct-figure-max-width = 74%/);
  assert.match(brand, /fit: "contain"/);
});

test('pdfEngineFontOpts passes typst font-path and ignore-system-fonts', () => {
  const opts = pdfEngineFontOpts(REPO);
  assert.match(opts.join(' '), /--font-path=.*templates\/distribution\/fonts/);
  assert.match(opts.join(' '), /--ignore-system-fonts/);
  assert.match(opts.join(' '), /--ignore-embedded-fonts/);
});

test('buildDistributionDiagramEnv sets Chrome path when available', () => {
  const chrome = resolvePuppeteerExecutable(process.env);
  const env = buildDistributionDiagramEnv({});
  assert.equal(env.CONSTRUCT_D2_SKETCH, '1');
  if (chrome) assert.equal(env.PUPPETEER_EXECUTABLE_PATH, chrome);
});

test('ARTIFACT_TEMPLATE_MAP covers all prd family types', () => {
  for (const type of ['prd', 'prd-platform', 'prd-business', 'meta-prd']) {
    assert.equal(ARTIFACT_TEMPLATE_MAP[type], 'construct-prd.typ');
  }
});
