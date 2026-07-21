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

test('BRAND uses field-notebook slate-teal accent', () => {
  assert.equal(BRAND.accent, '#1f5c61');
  assert.notEqual(BRAND.accent, '#38bdf8');
  assert.notEqual(BRAND.accent, '#0a0c10');
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
    'PlusJakartaSans-Regular.ttf',
    'PlusJakartaSans-Medium.ttf',
    'PlusJakartaSans-SemiBold.ttf',
    'PlusJakartaSans-Bold.ttf',
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
  assert.match(out, /Platform teams need a governed layer/);
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
  assert.equal(defaults.accent, '#1f5c61');
});

test('injectMermaidBrandTheme adds handDrawn init with field-notebook ink and handwritten font', () => {
  const out = injectMermaidBrandTheme('flowchart TD\n  A --> B');
  assert.match(out, /%%\{init:/);
  assert.match(out, /handDrawn/);
  assert.match(out, /htmlLabels/);
  assert.match(out, /Caveat/);
  assert.match(out, /1a1d24/);
  assert.doesNotMatch(out, /8b5cf6/);
});

test('preprocessMarkdownDiagrams brands mermaid and d2 fences field-notebook', () => {
  const md = '# Doc\n\n```mermaid\nflowchart TD\n  A --> B\n```\n\n```d2\na -> b\n```\n';
  const out = preprocessMarkdownDiagrams(md);
  assert.match(out, /1a1d24/);
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

test('construct-brand.typ de-brands the PDF running footer', () => {
  const brand = fs.readFileSync(path.join(REPO, 'templates', 'distribution', 'construct-brand.typ'), 'utf8');
  assert.match(brand, /#footer-label/);
  assert.doesNotMatch(brand, /\[CONSTRUCT\]/);
  assert.doesNotMatch(brand, /Construct brief/);
});

test('construct-brand.typ omits pre-2.0 compat color token shims', () => {
  const brand = fs.readFileSync(path.join(REPO, 'templates', 'distribution', 'construct-brand.typ'), 'utf8');
  assert.doesNotMatch(brand, /brand-warm|brand-violet|brand-accent-deep|brand-surface-warm/);
});

test('construct-brand.typ uses field-notebook hand-drawn visual system', () => {
  const brand = fs.readFileSync(path.join(REPO, 'templates', 'distribution', 'construct-brand.typ'), 'utf8');
  assert.match(brand, /construct-font-sans = \("Plus Jakarta Sans",\)/);
  assert.match(brand, /set par\(justify: false, leading: 1\.02em, spacing: 1\.35em\)/);
  assert.doesNotMatch(brand, /Libertinus|SourceSerif|Geist|IBM Plex Sans|"Inter"|"Space Grotesk"/);
  assert.match(brand, /fill: surface/);
  assert.match(brand, /construct-status-label/);
  assert.match(brand, /#upper\(status\)/);
  assert.match(brand, /construct-meta-grid/);
  assert.match(brand, /section-counter/);
  assert.match(brand, /stroke: \(paint: accent, thickness: 2\.2pt, dash: "dashed"\)/);
  assert.doesNotMatch(brand, /construct-status-pill/);
  assert.doesNotMatch(brand, /construct-meta-chips/);
  assert.doesNotMatch(brand, /line\(length: 46pt/);
  assert.doesNotMatch(brand, /line\(length: 26pt, stroke: 1\.5pt \+ ink\)/);
  assert.match(brand, /construct-figure-max-width = 94%/);
  assert.match(brand, /construct-figure-max-height = 3\.6in/);
  assert.match(brand, /measure\(it\.body\)/);
  assert.match(brand, /scale\(x: f \* 100%, y: f \* 100%, reflow: true/);
  assert.doesNotMatch(brand, /fit: "contain"/);
  assert.match(brand, /set enum\(numbering: "1\."/);
  assert.match(brand, /#let horizontalrule = block/);
  assert.doesNotMatch(brand, /show enum\.item:/, 'ordered lists must keep native Typst numbering context');
  assert.match(brand, /show figure\.where\(kind: table\): set block\(breakable: true\)/);
  assert.match(brand, /block\(sticky: true, above: 2em, below: 0\.85em/);
  assert.doesNotMatch(brand, /v\(0\.6em, weak: true\)/);
  assert.match(brand, /set list\(.*indent: 0\.3em, body-indent: 0\.7em, spacing: 1\.05em\)/);
  assert.match(brand, /set enum\(numbering: "1\.", indent: 0\.3em, body-indent: 0\.7em, spacing: 1\.05em\)/);
  assert.match(brand, /set terms\(/);
  assert.match(brand, /fill: \(x, y\) => if y == 0 \{ accent-soft \}/);
});

test('construct-deck.html and construct-web.html use Plus Jakarta Sans brand stack', () => {
  const dist = path.join(REPO, 'templates', 'distribution');
  for (const file of ['construct-deck.html', 'construct-web.html']) {
    const html = fs.readFileSync(path.join(dist, file), 'utf8');
    assert.match(html, /Plus Jakarta Sans/, `${file} must reference Plus Jakarta Sans`);
    assert.match(html, /JetBrains Mono/, `${file} must reference JetBrains Mono`);
    assert.doesNotMatch(html, /Space Grotesk|Geist|IBM Plex|Libertinus/i, `${file} must not cite retired fonts`);
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
  assert.match(brand, /#let construct-page-margin = \(left: 2\.4cm/);
  for (const file of ['construct-pdf.typ', 'construct-prd.typ', 'construct-research.typ', 'construct-decision.typ']) {
    const tpl = fs.readFileSync(path.join(dist, file), 'utf8');
    assert.match(tpl, /paper: construct-page-paper/, `${file} must use the shared paper token`);
    assert.match(tpl, /margin: construct-page-margin/, `${file} must use the shared margin token`);
    assert.match(tpl, /doc-id: "\$if\(docId\)/, `${file} must pass doc-id to running footer`);
    assert.doesNotMatch(tpl, /margin:\s*\(x:\s*\d/, `${file} must not hardcode margins`);
  }
});

test('ARTIFACT_TEMPLATE_MAP covers all prd family types', () => {
  for (const type of ['prd', 'prd-platform', 'prd-business', 'meta-prd']) {
    assert.equal(ARTIFACT_TEMPLATE_MAP[type], 'construct-prd.typ');
  }
});
