/**
 * tests/functional/document-assets.functional.test.mjs — rich-media asset manifest and preservation
 * pipeline (construct-d1r7.10).
 *
 * The manifest is derived from the RichDocument IR (ADR-0071), generated on import and consumed on
 * export. These assert the four acceptance criteria against real files on disk: a manifest is built
 * from ingested-style markdown (import side), a broken local media ref fails validation and blocks
 * export, captions/alt text survive the serialization a target preserves, and the fixtures cover a
 * raster photo, a screenshot, a diagram, and a missing-asset failure. Engine-embedding (data-URI
 * inlining via Pandoc) is asserted only when the engine is present; the fragment path proves
 * caption/alt survival with no engine at all.
 */

import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import {
  makeRichDocument, makeSection, makeHeadingBlock, makeRun, makeFigureBlock, makeMediaRef, makeDiagramBlock, markdownToRichDocument,
} from '../../lib/rich-document.mjs';
import { buildAssetManifest, validateAssetManifest, resolveDocAssets } from '../../lib/document-assets.mjs';
import { exportRichDocument } from '../../lib/rich-document-export.mjs';
import { externalizeEmbeddedImages } from '../../lib/document-ingest.mjs';
import { rmTmpDir } from '../helpers/cleanup.mjs';

const PNG_B64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAAC0lEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
const tmpDirs = [];
after(() => { for (const dir of tmpDirs) rmTmpDir(dir); });

function tmpDir() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'doc-assets-'));
  tmpDirs.push(dir);
  return dir;
}

function fig(uri, alt, caption) {
  return makeFigureBlock({ media: makeMediaRef({ kind: 'image', uri, mimeType: 'image/png' }), caption: [makeRun({ text: caption })], altText: alt });
}

function mediaDoc(dir) {
  fs.writeFileSync(path.join(dir, 'photo.png'), Buffer.from(PNG_B64, 'base64'));
  fs.writeFileSync(path.join(dir, 'screenshot-login.png'), Buffer.from(PNG_B64, 'base64'));
  return makeRichDocument({ title: 'Media' }, [makeSection({ id: 's', level: 1, blocks: [
    makeHeadingBlock({ level: 1, runs: [makeRun({ text: 'Media' })] }),
    fig('photo.png', 'a red photo', 'Photo caption'),
    fig('screenshot-login.png', 'the login screen', 'Screenshot caption'),
    fig('https://example.com/remote.png', 'remote image', 'Remote caption'),
    makeDiagramBlock({ lang: 'mermaid', source: 'flowchart TD\nA-->B' }),
  ] })]);
}

test('manifest classifies photo/screenshot/diagram and hashes local assets', () => {
  const dir = tmpDir();
  const manifest = buildAssetManifest(mediaDoc(dir), { baseDir: dir });
  const byRole = Object.fromEntries(manifest.assets.map((a) => [a.id, a]));
  assert.equal(manifest.assets.length, 4);
  assert.equal(byRole['asset-1'].role, 'photo');
  assert.equal(byRole['asset-2'].role, 'screenshot');
  assert.equal(byRole['asset-3'].role, 'photo');
  assert.equal(byRole['asset-3'].policy, 'link', 'a remote ref is link-policy, not embed');
  assert.equal(byRole['asset-4'].role, 'diagram');
  assert.match(byRole['asset-1'].hash, /^[0-9a-f]{64}$/, 'local asset is content-hashed');
  assert.ok(byRole['asset-1'].bytes > 0);
  assert.equal(byRole['asset-1'].caption, 'Photo caption');
  assert.equal(byRole['asset-1'].altText, 'a red photo');
});

test('a broken local media ref fails validation and blocks export before any engine runs', () => {
  const dir = tmpDir();
  const doc = makeRichDocument({ title: 'Broken' }, [makeSection({ id: 's', level: 1, blocks: [fig('missing.png', 'x', 'y')] })]);
  const check = validateAssetManifest(buildAssetManifest(doc, { baseDir: dir }));
  assert.equal(check.ok, false);
  assert.deepEqual(check.missing, ['missing.png']);

  const target = path.join(dir, 'broken.html');
  const result = exportRichDocument({ doc, format: 'html', outputPath: target, assetBaseDir: dir });
  assert.equal(result.ok, false);
  assert.deepEqual(result.brokenAssets, ['missing.png']);
  assert.equal(fs.existsSync(target), false, 'a failed asset gate must not leave an output file');
});

test('captions and alt text survive the fragment serialization with no engine', () => {
  const dir = tmpDir();
  const target = path.join(dir, 'frag.html');
  const result = exportRichDocument({ doc: mediaDoc(dir), format: 'htmlfrag', outputPath: target, assetBaseDir: dir });
  assert.equal(result.ok, true, result.message);
  const frag = fs.readFileSync(target, 'utf8');
  assert.match(frag, /alt="a red photo"/);
  assert.match(frag, /<figcaption>Photo caption<\/figcaption>/);
  assert.equal(result.assets.length, 4, 'the manifest travels on the export result');
});

test('local assets embed on export when the engine is present, else an actionable diagnostic', () => {
  const dir = tmpDir();
  const target = path.join(dir, 'out.html');
  const result = exportRichDocument({ doc: mediaDoc(dir), format: 'html', outputPath: target, assetBaseDir: dir });
  if (result.ok) {
    const html = fs.readFileSync(target, 'utf8');
    assert.match(html, /data:image\/png;base64/, 'local asset was not embedded');
    assert.match(html, /a red photo/, 'alt text lost through the engine');
    assert.match(html, /Photo caption/, 'caption lost through the engine');
  } else {
    assert.match(result.message, /install|missing/i);
  }
});

test('resolveDocAssets rewrites local refs to absolute paths and leaves remote refs intact', () => {
  const dir = tmpDir();
  const doc = mediaDoc(dir);
  const resolved = resolveDocAssets(doc, { baseDir: dir });
  const blocks = resolved.sections[0].blocks;
  assert.equal(blocks[1].media.uri, path.resolve(dir, 'photo.png'));
  assert.equal(blocks[3].media.uri, 'https://example.com/remote.png');
});

test('import side: a manifest is generated from ingested-style markdown with externalized images', () => {
  const dir = tmpDir();
  const mdPath = path.join(dir, 'report.docx.md');
  const md = `# Report\n\nIntro paragraph.\n\n![a captured screen](data:image/png;base64,${PNG_B64})\n`;
  const { markdown, assets } = externalizeEmbeddedImages(md, { mdPath });
  assert.equal(assets.length, 1, 'ingest externalized the embedded image to disk');

  const doc = markdownToRichDocument(markdown, { title: 'Report' });
  const manifest = buildAssetManifest(doc, { baseDir: dir });
  assert.equal(manifest.assets.length, 1);
  const asset = manifest.assets[0];
  assert.equal(asset.local, true);
  assert.equal(asset.exists, true);
  assert.match(asset.hash, /^[0-9a-f]{64}$/);
  assert.equal(validateAssetManifest(manifest).ok, true);
});
