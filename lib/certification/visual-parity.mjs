/**
 * lib/certification/visual-parity.mjs — visual/diagram surface certification gate.
 *
 * Verifies diagram-producing paths emit valid Diagram Cards, Mermaid interactive
 * hardening guardrails hold, and diagram-engine subprocess spawns remain inside
 * consolidated provider modules (construct-tsyfe.4.8).
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { validateDiagramCard } from '../diagram-card.mjs';
import {
  assertDocsMermaidVersionPinned,
  assertMermaidComponentHardened,
  buildValidatedInteractiveMermaidDiagramCard,
  readMermaidComponentSource,
} from '../mermaid-interactive.mjs';
import { buildWireframeDiagramCard } from '../wireframe.mjs';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

const ALLOWED_D2_SPAWN = new Set([
  path.join('lib', 'providers', 'd2.mjs'),
]);

const ALLOWED_MMDC_SPAWN = new Set([
  path.join('lib', 'deck-export-pptx.mjs'),
  path.join('lib', 'render-pipeline.mjs'),
]);

const ALLOWED_DOT_SPAWN = new Set([
  path.join('lib', 'diagram.mjs'),
]);

function findConstructRoot(startPath = process.cwd()) {
  let current = path.resolve(startPath);
  while (true) {
    if (fs.existsSync(path.join(current, 'package.json'))) return current;
    const parent = path.dirname(current);
    if (parent === current) return path.resolve(startPath);
    current = parent;
  }
}

function walkLibMjs(dir, hits = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      walkLibMjs(full, hits);
      continue;
    }
    if (!entry.name.endsWith('.mjs')) continue;
    hits.push(full);
  }
  return hits;
}

export function scanDiagramEngineSpawns(rootDir = REPO_ROOT) {
  const libDir = path.join(rootDir, 'lib');
  const violations = [];
  for (const full of walkLibMjs(libDir)) {
    const rel = path.relative(rootDir, full);
    const source = fs.readFileSync(full, 'utf8');
    if (/spawnSync\(\s*['"]d2['"]/.test(source) && !ALLOWED_D2_SPAWN.has(rel)) {
      violations.push({ engine: 'd2', file: rel });
    }
    if (/spawnSync\(\s*['"]mmdc['"]/.test(source) && !ALLOWED_MMDC_SPAWN.has(rel)) {
      violations.push({ engine: 'mmdc', file: rel });
    }
    if (/spawnSync\(\s*['"]dot['"]/.test(source) && !ALLOWED_DOT_SPAWN.has(rel)) {
      violations.push({ engine: 'dot', file: rel });
    }
  }
  return violations;
}

export function validateVisualDiagramCards() {
  const errors = [];
  const wireframeCard = buildWireframeDiagramCard({ description: 'checkout flow', type: 'flow' });
  if (!wireframeCard) errors.push('wireframe flow card missing');
  else {
    const wireframeResult = validateDiagramCard(wireframeCard);
    if (!wireframeResult.ok) errors.push(`wireframe card invalid: ${wireframeResult.errors.join('; ')}`);
  }
  try {
    buildValidatedInteractiveMermaidDiagramCard({
      id: 'visual-cert',
      chart: 'flowchart LR\n  A --> B',
      accessibilityDescription: 'Certification sample flow',
    });
  } catch (err) {
    errors.push(`interactive mermaid card invalid: ${err.message}`);
  }
  return { pass: errors.length === 0, errors };
}

export function validateVisualSurfaceHardening() {
  const errors = [];
  const hardened = assertMermaidComponentHardened(readMermaidComponentSource());
  if (!hardened.ok) errors.push(...hardened.errors);
  const pin = assertDocsMermaidVersionPinned();
  if (!pin.ok) errors.push(...pin.errors);
  return { pass: errors.length === 0, errors };
}

export function buildVisualParityReport({ rootDir } = {}) {
  const root = findConstructRoot(rootDir ?? REPO_ROOT);
  const cardCheck = validateVisualDiagramCards();
  const hardeningCheck = validateVisualSurfaceHardening();
  const spawnViolations = scanDiagramEngineSpawns(root);
  const mismatches = [];
  if (!cardCheck.pass) {
    mismatches.push({ surface: 'diagram-cards', detail: cardCheck.errors.join('; ') });
  }
  if (!hardeningCheck.pass) {
    mismatches.push({ surface: 'mermaid-hardening', detail: hardeningCheck.errors.join('; ') });
  }
  for (const violation of spawnViolations) {
    mismatches.push({
      surface: 'engine-spawn',
      detail: `orphaned spawnSync('${violation.engine}') in ${violation.file}`,
    });
  }
  return {
    schema: 'construct/certification/visual-parity/1',
    generatedAt: new Date().toISOString(),
    pass: mismatches.length === 0,
    checks: {
      diagramCards: cardCheck,
      mermaidHardening: hardeningCheck,
      spawnViolations,
    },
    mismatches,
    removedArtifacts: [],
  };
}

export function validateVisualParityCertification({ rootDir } = {}) {
  const report = buildVisualParityReport({ rootDir });
  return { pass: report.pass, errors: report.mismatches.map((m) => m.detail), report };
}
