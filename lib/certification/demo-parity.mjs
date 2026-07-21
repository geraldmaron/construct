/**
 * lib/certification/demo-parity.mjs — demo terminal-harness report generator.
 *
 * Verifies each canonical demo ships a VHS terminal tape and reaches a verified
 * or certified demo state before passing certification. Terminal is the sole guided
 * demo surface after web-deprecation retired the desktop window and web cockpit.
 */

import fs from 'node:fs';
import path from 'node:path';

import { loadCanonicalScenarios } from './canonical-scenarios.mjs';
import { loadDemoState, DEMO_RECORDING_SUCCESS_STATES } from '../demo-state.mjs';
import { loadDemoManifest } from '../demo-manifest.mjs';

const CERTIFIED_STATES = new Set(['verified', 'certified']);

const SURFACE_MARKERS = Object.freeze({
  terminal: {
    label: 'VHS terminal',
    probe: (root, demo, { stateCwd = root } = {}) => {
      const tape = demo.tape ?? demo.tapePath;
      if (!tape) {
        return {
          ok: false,
          certificationPass: false,
          detail: 'demo missing tape path',
          reason: 'demo missing tape path',
        };
      }
      const abs = path.join(root, tape);
      const artifactPresent = fs.existsSync(abs);
      const stateRecord = loadDemoState(demo.id, { cwd: stateCwd });
      const state = stateRecord?.state ?? 'declared';
      const certificationPass = CERTIFIED_STATES.has(state);
      let reason = null;
      if (state === 'script-only') reason = 'script-only fallback, no recording verified';
      else if (state === 'recorded') reason = 'recorded artifact exists but is not verified';
      else if (state === 'unavailable' || state === 'failed') {
        reason = `demo state is ${state}${artifactPresent ? ' despite tape file on disk' : ''}`;
      } else if (!certificationPass) reason = `demo state is ${state}, certification requires verified or certified`;

      return {
        ok: artifactPresent && certificationPass,
        certificationPass,
        artifactPresent,
        state,
        detail: abs,
        reason,
      };
    },
  },
  playwright: {
    label: 'Playwright recording',
    probe: (root, demo, { stateCwd = root } = {}) => {
      const loaded = loadDemoManifest(demo.id, { cwd: stateCwd, repoRoot: root });
      const hasRecording = loaded.ok && Boolean(loaded.manifest?.recording);
      const stateRecord = loadDemoState(demo.id, { cwd: stateCwd });
      const state = stateRecord?.state ?? 'declared';
      if (!hasRecording) {
        return {
          ok: true,
          skipped: true,
          certificationPass: null,
          hasRecording: false,
          state,
          detail: loaded.sourcePath ?? null,
          reason: null,
        };
      }
      const certificationPass = CERTIFIED_STATES.has(state);
      let reason = null;
      if (state === 'script-only') reason = 'script-only fallback, no recording verified';
      else if (state === 'recorded') reason = 'recorded artifact exists but is not verified';
      else if (!certificationPass) reason = `demo state is ${state}, certification requires verified or certified`;

      return {
        ok: certificationPass,
        certificationPass,
        hasRecording: true,
        state,
        detail: loaded.sourcePath ?? null,
        reason,
      };
    },
  },
});

const ACCEPTABLE_DIVERGENCES = Object.freeze([
  {
    id: 'vhs-tape-direct',
    surface: 'terminal',
    reason: 'VHS tapes assert the scripted terminal recording directly once demo state reaches verified or certified.',
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

export function evaluateDemoCertificationState(demoId, {
  rootDir,
  stateCwd = rootDir,
} = {}) {
  const stateRecord = loadDemoState(demoId, { cwd: stateCwd });
  const state = stateRecord?.state ?? 'declared';
  if (state === 'script-only') {
    return { pass: false, state, reason: 'script-only fallback, no recording verified' };
  }
  if (state === 'recorded') {
    return { pass: false, state, reason: 'recorded artifact exists but is not verified' };
  }
  if (CERTIFIED_STATES.has(state)) {
    return { pass: true, state, reason: null };
  }
  if (state === 'unavailable' || state === 'failed') {
    return { pass: false, state, reason: `demo state is ${state}` };
  }
  return { pass: false, state, reason: `demo state is ${state}, certification requires verified or certified` };
}

export function buildDemoParityReport({ rootDir, stateCwd } = {}) {
  const root = findConstructRoot(rootDir);
  const stateRoot = stateCwd ?? root;
  const { catalog } = loadCanonicalScenarios({ rootDir: root });
  const demos = [];
  const mismatches = [];

  for (const demo of catalog.demos ?? []) {
    const surfaces = {};
    for (const [surfaceId, marker] of Object.entries(SURFACE_MARKERS)) {
      const result = marker.probe(root, demo, { stateCwd: stateRoot });
      surfaces[surfaceId] = {
        label: marker.label,
        ok: result.ok,
        skipped: result.skipped ?? false,
        certificationPass: result.certificationPass,
        artifactPresent: result.artifactPresent ?? null,
        hasRecording: result.hasRecording ?? null,
        state: result.state,
        reason: result.reason ?? null,
        evidence: result.detail,
      };
      if (!result.ok && !result.skipped) {
        mismatches.push({
          demoId: demo.id,
          surface: surfaceId,
          detail: result.reason || result.detail,
          state: result.state,
          followUpBead: `construct-xp5k.7.5:${demo.id}:${surfaceId}`,
        });
      }
    }
    demos.push({ id: demo.id, capabilityId: demo.capabilityId, surfaces });
  }

  return {
    schema: 'construct/certification/demo-parity/2',
    generatedAt: new Date().toISOString(),
    demoCount: demos.length,
    pass: mismatches.length === 0,
    demos,
    mismatches,
    acceptableDivergences: ACCEPTABLE_DIVERGENCES,
    stateAware: true,
  };
}

export function writeDemoParityReport({ rootDir, stateCwd } = {}) {
  const root = findConstructRoot(rootDir);
  const report = buildDemoParityReport({ rootDir: root, stateCwd });
  const out = path.join(root, 'tests', 'certification', 'demos', 'parity-report.json');
  fs.mkdirSync(path.dirname(out), { recursive: true });
  fs.writeFileSync(out, `${JSON.stringify(report, null, 2)}\n`);
  return { path: out, report };
}
