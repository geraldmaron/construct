/**
 * tests/mermaid-interactive.test.mjs — Mermaid interactive hardening (construct-tsyfe.4.2).
 */

import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import {
  MERMAID_DEGRADED_TIMEOUT,
  MERMAID_DEGRADED_TOO_LARGE,
  MERMAID_HAND_DRAWN_SEED,
  MERMAID_MAX_SOURCE_CHARS,
  MERMAID_SECURITY_PROFILE,
  assertDocsMermaidVersionPinned,
  assertMermaidComponentHardened,
  assessMermaidSource,
  buildMermaidInitializeConfig,
  buildValidatedInteractiveMermaidDiagramCard,
  readMermaidComponentSource,
  sanitizeMermaidSvg,
  withRenderTimeout,
} from '../lib/mermaid-interactive.mjs';
import { validateDiagramCard } from '../lib/diagram-card.mjs';
import { buildWireframeDiagramCard } from '../lib/wireframe.mjs';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const MERMAID_MODULE = path.join(REPO, 'packages', 'construct-ui', 'mermaid-interactive.mjs');

test('mermaid initialize config uses strict security profile', () => {
  const config = buildMermaidInitializeConfig({ theme: 'dark' });
  assert.equal(config.securityLevel, MERMAID_SECURITY_PROFILE);
  assert.notEqual(config.securityLevel, 'loose');
});

test('oversized diagram source is rejected before render', () => {
  const chart = 'a'.repeat(MERMAID_MAX_SOURCE_CHARS + 1);
  const result = assessMermaidSource(chart);
  assert.equal(result.ok, false);
  assert.equal(result.reason, MERMAID_DEGRADED_TOO_LARGE);
});

test('render timeout resolves to degraded state', async () => {
  const hanging = new Promise(() => {});
  await assert.rejects(
    () => withRenderTimeout(hanging, 20),
    (err) => err instanceof Error && err.message === MERMAID_DEGRADED_TIMEOUT,
  );
});

test('handDrawn config with fixed seed is deterministic', () => {
  const a = buildMermaidInitializeConfig({ theme: 'light', look: 'handDrawn', seed: MERMAID_HAND_DRAWN_SEED });
  const b = buildMermaidInitializeConfig({ theme: 'light', look: 'handDrawn', seed: MERMAID_HAND_DRAWN_SEED });
  assert.deepEqual(a, b);
  assert.equal(a.handDrawnSeed, MERMAID_HAND_DRAWN_SEED);
  assert.equal(a.deterministicIDSeed, String(MERMAID_HAND_DRAWN_SEED));
});

test('two handDrawn mermaid module configs produce identical init objects', () => {
  const source = fs.readFileSync(MERMAID_MODULE, 'utf8');
  assert.equal(/securityLevel:\s*['"]loose['"]/.test(source), false);
  const first = buildMermaidInitializeConfig({ look: 'handDrawn', seed: 7 });
  const second = buildMermaidInitializeConfig({ look: 'handDrawn', seed: 7 });
  assert.equal(JSON.stringify(first), JSON.stringify(second));
});

test('sanitizeMermaidSvg strips script tags and event handlers', () => {
  const dirty = '<svg onclick="alert(1)"><script>alert(1)</script><rect width="1"/></svg>';
  const clean = sanitizeMermaidSvg(dirty);
  assert.equal(clean.includes('<script'), false);
  assert.equal(clean.includes('onclick'), false);
  assert.ok(clean.includes('<rect'));
});

test('interactive mermaid diagram card validates against schema', () => {
  const card = buildValidatedInteractiveMermaidDiagramCard({
    id: 'demo-flow',
    chart: 'flowchart LR\n  A --> B',
    accessibilityDescription: 'Request flow from client to gateway',
    theme: 'dark',
  });
  const result = validateDiagramCard(card);
  assert.equal(result.ok, true, result.errors.join('; '));
  assert.equal(card.securityProfile, MERMAID_SECURITY_PROFILE);
});

test('mermaid.tsx source passes hardening guardrails', () => {
  const source = readMermaidComponentSource();
  const result = assertMermaidComponentHardened(source);
  assert.equal(result.ok, true, result.errors.join('; '));
  assert.equal(/securityLevel:\s*['"]loose['"]/.test(source), false);
});

test('apps/docs pins mermaid to an exact version', () => {
  const result = assertDocsMermaidVersionPinned();
  assert.equal(result.ok, true, result.errors.join('; '));
});

test('wireframe diagram cards remain valid for certification baseline', () => {
  const card = buildWireframeDiagramCard({ description: 'signup flow', type: 'flow' });
  assert.ok(card);
  assert.equal(validateDiagramCard(card).ok, true);
});
