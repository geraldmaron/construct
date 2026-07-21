/**
 * scripts/generate-distribution-examples.mjs — regenerate branded distribution gallery.
 *
 * Reads examples/distribution/manifest.json and exports PDF, HTML, deck, and PPTX
 * with figures into .tmp/distribution-examples/. Records optional Playwright cockpit
 * demos when manifest items declare `demo` with `demoSurface: dashboard`. Writes
 * index.html for local review.
 *
 * Run: npm run examples:distribution
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { exportMarkdown } from '../lib/document-export.mjs';
import { templateForArtifactType } from '../lib/publish-template.mjs';
import { runDemoRecord } from '../lib/demo.mjs';
import { loadDemoRecording } from '../lib/demo-recording.mjs';
import { recordPlaywrightDemo } from '../lib/playwright-demo.mjs';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const EXAMPLES_DIR = path.join(REPO, 'examples', 'distribution');
const MANIFEST_PATH = path.join(EXAMPLES_DIR, 'manifest.json');

function loadManifest() {
  const raw = JSON.parse(fs.readFileSync(MANIFEST_PATH, 'utf8'));
  const outDir = path.resolve(REPO, raw.outputDir || '.tmp/distribution-examples');
  return { items: raw.items || [], outDir };
}

function extForFormat(format) {
  if (format === 'deck') return 'html';
  return format;
}

function exportOne({ item, sourcePath, outDir, repoRoot }) {
  const results = [];
  for (const format of item.formats || []) {
    const ext = extForFormat(format);
    const basename = format === 'deck' ? `${item.id}-deck` : item.id;
    const outputPath = path.join(outDir, `${basename}.${ext}`);
    const result = exportMarkdown({
      inputPath: sourcePath,
      outputPath,
      format,
      figures: format === 'pdf' || format === 'html' || format === 'deck',
      artifactType: item.artifactType || null,
      repoRoot,
      cwd: repoRoot,
    });
    results.push({ format, outputPath, ...result });
  }
  return results;
}

function recordDemo({ item, outDir, repoRoot }) {
  const recordingName = item.recording || item.demo;
  if (!recordingName) return null;
  const format = item.demoFormat || 'mp4';
  const outputPath = path.join(outDir, `${recordingName}.${format}`);
  const artifactFile = item.demoArtifact || `${item.id}.pdf`;
  const surface = item.demoSurface || 'playwright';

  const recording = loadDemoRecording(recordingName, { cwd: repoRoot, repoRoot });
  if (!recording) {
    return { ok: false, format: 'demo', surface, outputPath, message: `Recording not found: ${recordingName}` };
  }

  if (recording.engine === 'playwright' || surface === 'playwright' || surface === 'dashboard') {
    const result = recordPlaywrightDemo(recording, {
      cwd: repoRoot,
      repoRoot,
      outputDir: outDir,
      outputPath,
      format,
      artifactDir: outDir,
      artifactFile,
    });
    return { format: 'demo', surface: 'playwright', outputPath, ...result };
  }

  const result = runDemoRecord(recordingName, {
    cwd: repoRoot,
    repoRoot,
    format,
    out: outputPath,
    required: false,
  });
  return { format: 'demo', surface, outputPath, ...result };
}

function demoLabel(row) {
  if (row.demoSurface === 'dashboard' || row.demoSurface === 'playwright') return 'Cockpit + PDF';
  return 'VHS terminal';
}

function writeIndexHtml(outDir, rows) {
  const items = rows.map((row) => {
    const exportLinks = row.exports
      .filter((e) => e.ok)
      .map((e) => {
        const rel = path.relative(outDir, e.outputPath);
        const label = e.format.toUpperCase();
        return `<li><a href="${rel}">${label}</a> <span class="meta">(${templateForArtifactType(row.artifactType)})</span></li>`;
      })
      .join('\n');
    const demoLink = row.demo?.ok
      ? `<li><a href="${path.relative(outDir, row.demo.outputPath)}">DEMO (${row.demoFormat || 'mp4'})</a> <span class="meta">(${demoLabel(row)})</span></li>`
      : '';
    const failed = [...row.exports.filter((e) => !e.ok), ...(row.demo && !row.demo.ok ? [row.demo] : [])];
    const failHtml = failed.length
      ? `<p class="fail">${failed.map((f) => `${f.format}: ${f.message}`).join('<br>')}</p>`
      : '';
    return `<section>
  <h2>${row.id}</h2>
  <p class="meta">${row.artifactType} · ${path.basename(row.source)}</p>
  <ul>${exportLinks}${demoLink || ''}${!exportLinks && !demoLink ? '<li class="fail">No exports succeeded</li>' : ''}</ul>
  ${failHtml}
</section>`;
  }).join('\n');

  const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Construct distribution examples</title>
  <style>
    :root { --ink: #1a1d24; --muted: #545b66; --hairline: #d5d8dd; --sans: 'Plus Jakarta Sans', system-ui, sans-serif; }
    body { font-family: var(--sans); max-width: 52rem; margin: 2rem auto; padding: 0 1.25rem; color: var(--ink); line-height: 1.5; }
    h1 { font-size: 1.75rem; font-weight: 600; margin-bottom: 0.25rem; }
    .lede { color: var(--muted); margin-bottom: 2rem; }
    section { border-top: 1px solid var(--hairline); padding: 1.25rem 0; }
    h2 { font-size: 1.125rem; margin: 0 0 0.5rem; }
    .meta { color: var(--muted); font-size: 0.875rem; }
    a { color: var(--ink); }
    .fail { color: #b42318; font-size: 0.875rem; }
    ul { margin: 0.5rem 0 0; padding-left: 1.25rem; }
  </style>
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link href="https://fonts.googleapis.com/css2?family=Space+Grotesk:wght@400;600&display=swap" rel="stylesheet">
</head>
<body>
  <h1>Construct distribution examples</h1>
  <p class="lede">Generated by <code>npm run examples:distribution</code> with figures enabled and optional cockpit + PDF demos. Regenerate after template or source changes.</p>
  ${items}
</body>
</html>`;
  const indexPath = path.join(outDir, 'index.html');
  fs.writeFileSync(indexPath, html, 'utf8');
  return indexPath;
}

function main() {
  const { items, outDir } = loadManifest();
  fs.mkdirSync(outDir, { recursive: true });

  const galleryRows = [];
  let failures = 0;

  for (const item of items) {
    const sourcePath = path.join(EXAMPLES_DIR, item.source);
    if (!fs.existsSync(sourcePath)) {
      process.stderr.write(`✗ ${item.id}: missing source ${item.source}\n`);
      failures += 1;
      continue;
    }
    const exports = exportOne({ item, sourcePath, outDir, repoRoot: REPO });
    const bad = exports.filter((e) => !e.ok);
    if (bad.length) {
      for (const b of bad) {
        process.stderr.write(`✗ ${item.id} (${b.format}): ${b.message}\n`);
      }
      failures += bad.length;
    }
    for (const e of exports.filter((x) => x.ok)) {
      const size = fs.statSync(e.outputPath).size;
      process.stdout.write(`✓ ${item.id}.${extForFormat(e.format)} (${size} bytes)\n`);
    }

    let demo = null;
    if (item.demo || item.recording) {
      demo = recordDemo({ item, outDir, repoRoot: REPO });
      const demoName = item.recording || item.demo;
      if (demo?.ok) {
        const size = fs.statSync(demo.outputPath).size;
        process.stdout.write(`✓ ${demoName}.${item.demoFormat || 'mp4'} (${size} bytes)\n`);
      } else if (demo) {
        process.stderr.write(`✗ ${item.id} (demo): ${demo.message}\n`);
        failures += 1;
      }
    }

    galleryRows.push({
      id: item.id,
      artifactType: item.artifactType,
      source: sourcePath,
      exports,
      demo,
      demoFormat: item.demoFormat,
      demoSurface: item.demoSurface,
    });
  }

  const indexPath = writeIndexHtml(outDir, galleryRows);
  process.stdout.write(`\nGallery: ${indexPath}\n`);
  process.stdout.write(`Open: open ${path.relative(REPO, indexPath)}\n`);

  if (failures > 0) process.exit(1);
}

main();
