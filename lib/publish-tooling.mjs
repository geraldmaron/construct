/**
 * lib/publish-tooling.mjs — detect optional binaries for the publish pipeline.
 *
 * Composes export (Pandoc/Typst), diagram (D2/mmdc), and terminal demo (VHS)
 * probes for `construct tools detect`, `construct publish --strict`, and doctor
 * one-shot checks.
 */

import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { detect as detectExport } from './document-export.mjs';
import { locateRenderer } from './diagram.mjs';
import { locateRecorder } from './demo.mjs';
import { detectIngestPipeline } from './ingest-tooling.mjs';
import { resolvePuppeteerExecutable } from './diagram-export.mjs';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

export function diagramFilterPath() {
  return path.join(REPO_ROOT, 'vendor', 'pandoc-ext', 'diagram.lua');
}

function whichBin(name) {
  const cmd = process.platform === 'win32' ? 'where' : 'which';
  const result = spawnSync(cmd, [name], { encoding: 'utf8' });
  if (result.status !== 0) return null;
  return (result.stdout || '').trim().split('\n')[0] || null;
}

export function detectFigureBinaries(env = process.env) {
  const d2 = whichBin('d2');
  const mmdc = whichBin('mmdc');
  const dot = whichBin('dot');
  const chrome = resolvePuppeteerExecutable(env);
  const filter = fs.existsSync(diagramFilterPath());
  const missing = [];
  if (!filter) missing.push('diagram.lua (vendor/pandoc-ext/diagram.lua)');
  if (!d2 && !dot) missing.push('d2 or graphviz dot');
  if (!mmdc) missing.push('mmdc (@mermaid-js/mermaid-cli)');
  if (mmdc && !chrome) missing.push('Chrome for mermaid-cli (set PUPPETEER_EXECUTABLE_PATH or install Google Chrome)');
  return {
    ok: true,
    present: missing.length === 0,
    filter,
    d2,
    dot,
    mmdc,
    chrome,
    missing,
    message: missing.length === 0
      ? 'Figure tooling ready (pandoc-ext/diagram + d2/mmdc)'
      : `Install figure tooling: ${missing.join('; ')}`,
  };
}

export function detectPublishPipeline({
  format = 'pdf',
  includeFigures = true,
  includeTerminalDemo = false,
  includeIngest = true,
  cwd = process.cwd(),
  repoRoot = REPO_ROOT,
  env = process.env,
} = {}) {
  const steps = {};
  const missing = [];

  const exportDetect = detectExport(format, env, { figures: includeFigures, cwd, repoRoot });
  steps.export = exportDetect;
  if (!exportDetect.present) missing.push(...(exportDetect.missing || []));

  if (includeIngest) {
    steps.ingest = detectIngestPipeline({ cwd, env, repoRoot });
  }

  if (includeFigures) {
    const figures = detectFigureBinaries(env);
    steps.figures = figures;
    if (!figures.present) missing.push(...figures.missing);
  }

  if (includeTerminalDemo) {
    const recorder = locateRecorder();
    steps.terminalDemo = {
      present: Boolean(recorder),
      engine: recorder?.engine || null,
      missing: recorder ? [] : ['vhs or asciinema'],
    };
    if (!recorder) missing.push('vhs');
  }

  const uniqueMissing = [...new Set(missing)];
  return {
    ok: true,
    present: uniqueMissing.length === 0,
    format,
    steps,
    missing: uniqueMissing,
    message: uniqueMissing.length === 0
      ? 'Publish pipeline ready'
      : `Missing: ${uniqueMissing.join(', ')}`,
  };
}

export function formatToolsDetectReport(detection, { json = false } = {}) {
  if (json) return JSON.stringify(detection, null, 2);
  const lines = [`Publish pipeline: ${detection.present ? 'ready' : 'degraded'}`];
  for (const [key, step] of Object.entries(detection.steps || {})) {
    lines.push(`  ${key}: ${step.present ? 'ok' : 'missing'}${step.message ? ` — ${step.message}` : ''}`);
  }
  if (detection.missing?.length) lines.push(`Install: ${detection.missing.join('; ')}`);
  return lines.join('\n');
}
