/**
 * 03d-brand.mjs — Phase 3d: visual, voice, and naming brand drift.
 *
 * Flags retired typography, marketing voice in governed prose surfaces,
 * hardcoded dashboard intake titles, and Construct/cli naming drift in docs.
 * Retired CLI aliases are owned by 03b-naming.
 *
 * Read-only. Run: node scripts/audit/03d-brand.mjs
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  scanRepoBrandProse,
} from '../../lib/brand-prose.mjs';
import { REPO_ROOT } from './lib/handlers.mjs';
import { writeJson } from './lib/artifacts.mjs';
import { recordFindings } from './lib/findings.mjs';

const DASHBOARD_INTAKE_TITLE_RE = /title=["']Intake queue["']/;

function walkDashboard(dir) {
  const out = [];
  if (!fs.existsSync(dir)) return out;
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, e.name);
    if (/node_modules|\.next|\/out\//.test(full)) continue;
    if (e.isDirectory()) out.push(...walkDashboard(full));
    else if (e.name.endsWith('.tsx')) out.push(full);
  }
  return out;
}

function dashboardIntakeTitleDrift() {
  const hits = [];
  const dashDir = path.join(REPO_ROOT, 'apps', 'dashboard', 'app');
  for (const file of walkDashboard(dashDir)) {
    const rel = path.relative(REPO_ROOT, file);
    const lines = fs.readFileSync(file, 'utf8').split('\n');
    lines.forEach((line, i) => {
      if (!DASHBOARD_INTAKE_TITLE_RE.test(line)) return;
      hits.push({ file: rel, line: i + 1, text: line.trim().slice(0, 140) });
    });
  }
  return hits;
}

function retiredFontDriftFromScan(proseHits) {
  return proseHits
    .filter((h) => h.kind === 'retired-font')
    .map((h) => ({ file: h.file, line: h.line, text: h.text }));
}

function marketingVoiceDrift(proseHits) {
  return proseHits
    .filter((h) => h.kind === 'marketing-voice')
    .map((h) => ({ file: h.file, line: h.line, text: h.text }));
}

function constructNamingDrift(proseHits) {
  return proseHits
    .filter((h) => h.kind === 'construct-naming')
    .map((h) => ({ file: h.file, line: h.line, text: h.text, detail: h.detail }));
}

export function runBrandSweep() {
  const proseHits = scanRepoBrandProse(REPO_ROOT);
  return {
    retiredFontDrift: retiredFontDriftFromScan(proseHits),
    marketingVoiceDrift: marketingVoiceDrift(proseHits),
    constructNamingDrift: constructNamingDrift(proseHits),
    dashboardIntakeTitleDrift: dashboardIntakeTitleDrift(),
    initTemplateMarketingVoice: marketingVoiceDrift(proseHits).filter((h) =>
      h.file.startsWith('templates/docs/')),
  };
}

export function brandFindings() {
  return toFindings(runBrandSweep());
}

function toFindings(report) {
  const rows = [];
  for (const h of report.retiredFontDrift) {
    rows.push({
      type: 'brand-retired-font',
      target: `${h.file}:${h.line}`,
      severity: 'high',
      tier: 'mechanical',
      evidence: `Retired font reference: ${h.text}`,
      recommendation: 'Use Plus Jakarta Sans + JetBrains Mono per lib/brand-tokens.mjs; see docs/guides/reference/branding.md.',
    });
  }
  for (const h of report.dashboardIntakeTitleDrift) {
    rows.push({
      type: 'brand-hardcoded-intake-title',
      target: `${h.file}:${h.line}`,
      severity: 'medium',
      tier: 'mechanical',
      evidence: `Hardcoded intake page title: ${h.text}`,
      recommendation: 'Render title from /api/intake/list or /api/intake/config rebrand fields (getRebrand).',
    });
  }
  for (const h of report.marketingVoiceDrift) {
    rows.push({
      type: 'brand-marketing-voice',
      target: `${h.file}:${h.line}`,
      severity: 'low',
      tier: 'judgment',
      evidence: `Marketing voice token: ${h.text}`,
      recommendation: 'Rewrite per docs/STYLE.md — no marketing adjectives in shipped prose.',
    });
  }
  for (const h of report.constructNamingDrift) {
    rows.push({
      type: 'brand-construct-naming',
      target: `${h.file}:${h.line}`,
      severity: 'medium',
      tier: 'mechanical',
      evidence: h.detail ? `${h.text} (${h.detail})` : h.text,
      recommendation: 'Product name is Construct; CLI invocations use lowercase `construct` in backticks — see docs/guides/reference/branding.md.',
    });
  }
  return rows;
}

function main() {
  const report = runBrandSweep();
  const findings = toFindings(report);
  recordFindings('03d-brand', findings);
  writeJson('brand-drift.json', report);
  process.stdout.write(
    `[audit:03d] retired fonts: ${report.retiredFontDrift.length}, ` +
      `marketing voice: ${report.marketingVoiceDrift.length}, ` +
      `construct naming: ${report.constructNamingDrift.length}, ` +
      `hardcoded intake titles: ${report.dashboardIntakeTitleDrift.length}.\n`,
  );
}

if (process.argv[1] === fileURLToPath(import.meta.url)) main();
