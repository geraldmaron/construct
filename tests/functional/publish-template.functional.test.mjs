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
  puppeteerExecutableUsable,
  resolvePuppeteerExecutable,
} from '../../lib/diagram-export.mjs';
import { pdfEngineFontOpts } from '../../lib/document-export.mjs';
import { rmTmpDir } from '../helpers/cleanup.mjs';

const REPO = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..', '..');
const GOLDEN = path.join(REPO, 'tests', 'fixtures', 'publish', 'golden-prd-platform.md');

test('BRAND uses monochrome ink accent', () => {
  assert.equal(BRAND.accent, '#0a0c10');
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
    const override = path.join(dir, '.construct', 'publish-theme.typ');
    fs.mkdirSync(path.dirname(override), { recursive: true });
    fs.writeFileSync(override, '#set text(size: 12pt)\n$body$', 'utf8');
    const resolved = resolvePdfTemplatePath({ artifactType: 'prd-platform', cwd: dir, repoRoot: REPO });
    assert.equal(resolved, override);
  } finally {
    rmTmpDir(dir);
  }
});

test('parseArtifactMetadata reads golden fixture fields', () => {
  const meta = parseArtifactMetadata(GOLDEN);
  assert.match(meta.title, /Enterprise Agentic Platform/);
  assert.equal(meta.status, 'draft');
  assert.equal(meta.owner, 'product-manager');
  assert.equal(meta.artifactType, 'prd-platform');
  assert.equal(meta.date, '2026-06-19');
  assert.match(meta.subtitle, /Governed agentic platform/);
  assert.equal(meta.version, '0.1');
  assert.equal(meta.docId, 'PRD-PLATFORM-001');
});

test('bundled distribution fonts ship with templates', () => {
  const fontDir = path.join(REPO, 'templates', 'distribution', 'fonts');
  for (const file of [
    'SpaceGrotesk-Variable.ttf',
    'JetBrainsMono-Regular.ttf',
    'JetBrainsMono-Medium.ttf',
    'JetBrainsMono-SemiBold.ttf',
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
  assert.equal(defaults.d2Scale, 0.72);
  assert.equal(defaults.d2FontSize, 14);
  assert.equal(defaults.figureMaxWidth, '92%');
  assert.equal(defaults.mermaidLook, 'handDrawn');
  assert.equal(defaults.mermaidWidth, 2400);
  assert.equal(defaults.mermaidScale, 2);
  assert.equal(defaults.accent, '#0a0c10');
});

test('injectMermaidBrandTheme adds handDrawn init with monochrome ink and handwritten font', () => {
  const out = injectMermaidBrandTheme('flowchart TD\n  A --> B');
  assert.match(out, /%%\{init:/);
  assert.match(out, /handDrawn/);
  assert.match(out, /htmlLabels/);
  assert.match(out, /Caveat/);
  assert.match(out, /0a0c10/);
  assert.doesNotMatch(out, /8b5cf6/);
});

test('preprocessMarkdownDiagrams brands mermaid and d2 fences monochrome', () => {
  const md = '# Doc\n\n```mermaid\nflowchart TD\n  A --> B\n```\n\n```d2\na -> b\n```\n';
  const out = preprocessMarkdownDiagrams(md);
  assert.match(out, /0a0c10/);
  assert.doesNotMatch(out, /8b5cf6/);
  assert.match(out, /style\.font-size: 14/);
  assert.match(out, /```d2/);
});

test('buildDistributionDiagramEnv sets CONSTRUCT_D2_THEME and sketch flag', () => {
  const env = buildDistributionDiagramEnv({});
  assert.equal(env.CONSTRUCT_D2_THEME, '0');
  assert.equal(env.CONSTRUCT_D2_SCALE, '0.72');
  assert.equal(env.CONSTRUCT_D2_SKETCH, '1');
  assert.equal(env.CONSTRUCT_MERMAID_THEME, 'construct');
  assert.equal(env.CONSTRUCT_MERMAID_MIME, 'image/png');
  assert.equal(env.CONSTRUCT_MERMAID_WIDTH, '2400');
  assert.equal(env.CONSTRUCT_MERMAID_SCALE, '2');
  assert.match(env.CONSTRUCT_MERMAID_PPTR_CONFIG || '', /templates\/distribution\/mermaid-puppeteer\.json$/);
});

test('construct-brand.typ uses Space Grotesk family names for body prose', () => {
  const brand = fs.readFileSync(path.join(REPO, 'templates', 'distribution', 'construct-brand.typ'), 'utf8');
  assert.match(brand, /construct-font-sans = \("Space Grotesk",\)/);
  assert.match(brand, /set text\(font: construct-font-sans[\s\S]*justify: false/);
  assert.doesNotMatch(brand, /Libertinus|SourceSerif|Geist|IBM Plex Sans|"Inter"/);
  assert.match(brand, /construct-figure-max-width = 92%/);
  assert.match(brand, /construct-figure-max-height = 3\.4in/);

  // Figures scale by measured natural size (no reserved-height letterbox):
  // forcing width+height with fit:contain floated small diagrams in dead space.

  assert.match(brand, /measure\(it\.body\)/);
  assert.match(brand, /scale\(x: f \* 100%, y: f \* 100%, reflow: true/);
  assert.doesNotMatch(brand, /fit: "contain"/);
  assert.match(brand, /set par\(justify: false, leading: 0\.9em, spacing: 1\.24em\)/);
  assert.match(brand, /set enum\(numbering: "1\."/);
  assert.match(brand, /#let horizontalrule = block/);
  assert.doesNotMatch(brand, /show enum\.item:/, 'ordered lists must keep native Typst numbering context');

  // Tables must flow across pages: figures stay unbreakable even when a show
  // rule replaces their body, so the lift needs an explicit breakable block.

  assert.match(brand, /show figure\.where\(kind: table\): set block\(breakable: true\)/);

  // Heading boundary spacing must live on block(above/below) — a trailing weak
  // v() inside the block is trimmed at the boundary and never renders.

  assert.match(brand, /block\(sticky: true, above: 1\.8em, below: 0\.9em/);
  assert.doesNotMatch(brand, /v\(0\.6em, weak: true\)/);

  // Lists share one em-based text column across bullets and numbers.

  assert.match(brand, /set list\(.*indent: 0\.25em, body-indent: 0\.65em, spacing: 1em\)/);
  assert.match(brand, /set enum\(numbering: "1\.", indent: 0\.25em, body-indent: 0\.65em, spacing: 1em\)/);
  assert.match(brand, /set terms\(/);
});

test('construct-deck.html and construct-web.html use Space Grotesk brand stack', () => {
  const dist = path.join(REPO, 'templates', 'distribution');
  for (const file of ['construct-deck.html', 'construct-web.html']) {
    const html = fs.readFileSync(path.join(dist, file), 'utf8');
    assert.match(html, /Space Grotesk/, `${file} must reference Space Grotesk`);
    assert.match(html, /JetBrains Mono/, `${file} must reference JetBrains Mono`);
    assert.doesNotMatch(html, /Plus Jakarta|Geist|IBM Plex|Libertinus/i, `${file} must not cite retired fonts`);
  }
});

test('pdfEngineFontOpts passes typst font-path and ignore-system-fonts', () => {
  const opts = pdfEngineFontOpts(REPO);
  assert.match(opts.join(' '), /--font-path=.*templates\/distribution\/fonts/);
  assert.match(opts.join(' '), /--ignore-system-fonts/);
  assert.match(opts.join(' '), /--ignore-embedded-fonts/);
});

test('buildDistributionDiagramEnv sets Chrome path when available', () => {
  const chrome = puppeteerExecutableUsable(process.env)
    ? resolvePuppeteerExecutable(process.env)
    : null;
  const env = buildDistributionDiagramEnv({});
  assert.equal(env.CONSTRUCT_D2_SKETCH, '1');
  assert.equal(env.PUPPETEER_EXECUTABLE_PATH, chrome ?? undefined);
});

test('all PDF layout wrappers share the brand page-geometry tokens', () => {
  const dist = path.join(REPO, 'templates', 'distribution');
  const brand = fs.readFileSync(path.join(dist, 'construct-brand.typ'), 'utf8');
  assert.match(brand, /#let construct-page-paper = "a4"/);
  assert.match(brand, /#let construct-page-margin = \(/);
  for (const file of ['construct-pdf.typ', 'construct-prd.typ', 'construct-research.typ', 'construct-decision.typ']) {
    const tpl = fs.readFileSync(path.join(dist, file), 'utf8');
    assert.match(tpl, /paper: construct-page-paper/, `${file} must use the shared paper token`);
    assert.match(tpl, /margin: construct-page-margin/, `${file} must use the shared margin token`);
    assert.doesNotMatch(tpl, /margin:\s*\(x:\s*\d/, `${file} must not hardcode margins`);
  }
});

test('ARTIFACT_TEMPLATE_MAP covers all prd family types', () => {
  for (const type of ['prd', 'prd-platform', 'prd-business', 'meta-prd']) {
    assert.equal(ARTIFACT_TEMPLATE_MAP[type], 'construct-prd.typ');
  }
});
