/**
 * lib/certification/demo-parity.mjs — demo terminal-harness report generator.
 *
 * Verifies each canonical demo ships a VHS terminal tape. Terminal is the sole
 * chat surface after web-deprecation retired the desktop window and web cockpit;
 * acceptable divergences cite platform constraints with evidence paths.
 */

import fs from 'node:fs';
import path from 'node:path';

import { loadCanonicalScenarios } from './canonical-scenarios.mjs';

const SURFACE_MARKERS = Object.freeze({
  terminal: {
    label: 'VHS terminal',
    probe: (root, demo) => {
      const tape = demo.tape ?? demo.tapePath;
      if (!tape) return { ok: false, detail: 'demo missing tape path' };
      const abs = path.join(root, tape);
      return { ok: fs.existsSync(abs), detail: abs };
    },
  },
});

const ACCEPTABLE_DIVERGENCES = Object.freeze([
  {
    id: 'vhs-terminal-only',
    surface: 'terminal',
    reason: 'Chat is terminal-only; VHS tapes assert the terminal UX directly.',
    evidence: 'templates/demos/tapes/',
  },
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

export function buildDemoParityReport({ rootDir } = {}) {
  const root = findConstructRoot(rootDir);
  const { catalog } = loadCanonicalScenarios({ rootDir: root });
  const demos = [];
  const mismatches = [];

  for (const demo of catalog.demos ?? []) {
    const surfaces = {};
    for (const [surfaceId, marker] of Object.entries(SURFACE_MARKERS)) {
      const result = marker.probe(root, demo);
      surfaces[surfaceId] = {
        label: marker.label,
        ok: result.ok,
        evidence: result.detail,
      };
      if (!result.ok) {
        mismatches.push({
          demoId: demo.id,
          surface: surfaceId,
          detail: result.detail,
          followUpBead: `construct-xp5k.7.5:${demo.id}:${surfaceId}`,
        });
      }
    }
    demos.push({ id: demo.id, capabilityId: demo.capabilityId, surfaces });
  }

  return {
    schema: 'construct/certification/demo-parity/1',
    generatedAt: new Date().toISOString(),
    demoCount: demos.length,
    pass: mismatches.length === 0,
    demos,
    mismatches,
    acceptableDivergences: ACCEPTABLE_DIVERGENCES,
  };
}

export function writeDemoParityReport({ rootDir } = {}) {
  const root = findConstructRoot(rootDir);
  const report = buildDemoParityReport({ rootDir: root });
  const out = path.join(root, 'tests', 'certification', 'demos', 'parity-report.json');
  fs.mkdirSync(path.dirname(out), { recursive: true });
  fs.writeFileSync(out, `${JSON.stringify(report, null, 2)}\n`);
  return { path: out, report };
}
