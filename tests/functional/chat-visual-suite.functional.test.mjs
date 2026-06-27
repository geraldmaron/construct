/**
 * tests/functional/chat-visual-suite.functional.test.mjs — hermetic visual stages.
 *
 * Slash-command matrix and surface UX checks without a live model. Live depth
 * scoring runs in chat-visual-live-anthropic.functional.test.mjs when opted in.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { runHermeticVisualSuite } from '../visual/lib/run-suite.mjs';
import { auditSlashHelpOutput } from '../visual/lib/ux-audit.mjs';
import { measureDepth } from '../visual/lib/depth-rubric.mjs';
import { getRoleExpectation } from '../visual/lib/role-expectations.mjs';
import { runConstructScript, createVisualHome, defaultSpawnEnv } from '../visual/lib/session-runner.mjs';

test('hermetic slash /help lists full command catalog', async () => {
  const home = createVisualHome();
  try {
    const result = await runConstructScript(['/help', '/exit'], { env: defaultSpawnEnv({ HOME: home }) });
    assert.equal(result.code, 0, result.stderr);
    const findings = auditSlashHelpOutput(result.stdout);
    const fails = findings.filter((f) => f.severity === 'fail');
    assert.equal(fails.length, 0, fails.map((f) => f.message).join('; '));
  } finally {
    fs.rmSync(home, { recursive: true, force: true });
  }
});

test('hermetic visual suite — slash matrix passes', { timeout: 180_000 }, async () => {
  const { summary, slashStages } = await runHermeticVisualSuite();
  assert.ok(slashStages.length >= 5, 'expected multiple slash stages');
  const failed = slashStages.filter((s) => !s.ok);
  assert.equal(failed.length, 0, `failed stages: ${failed.map((f) => f.name).join(', ')}`);
  assert.equal(summary.ok, true, JSON.stringify(summary, null, 2));
});

test('depth rubric flags shallow PM outline', () => {
  const role = getRoleExpectation('product-manager');
  const shallow = '- problem\n- goal\n- ship it';
  const deep = [
    '## Problem',
    'Teams cannot verify OIDC behavior without a reproducible harness.',
    '',
    '## Success metrics',
    'Login success rate baseline 94%; target 99% with p95 < 2s.',
    '',
    '## Risks',
    'Token leakage if redirect URIs are misconfigured. [unverified] for prod traffic estimates.',
    '',
    'Acceptance: given valid credentials, user reaches chat within 2s.',
  ].join('\n');

  const shallowResult = measureDepth(shallow, {
    ...role.depthRubric,
    expectedSkills: role.expectedSkills,
  });
  const deepResult = measureDepth(deep, {
    ...role.depthRubric,
    expectedSkills: role.expectedSkills,
  });
  assert.equal(shallowResult.ok, false);
  assert.ok(deepResult.score > shallowResult.score);
  assert.match(shallowResult.depthGrade, /shallow|adequate/);
});

test('depth rubric rewards developer repo paths and code', () => {
  const role = getRoleExpectation('developer');
  const answer = [
    '## Where to start',
    'The owned-loop chat driver lives in apps/chat/engine/loop-driver.mjs. It maps AI SDK stream parts onto the normalized event union consumed by lib/chat/tui/render.mjs, so the TUI never depends on how the loop is produced.',
    '',
    'For provider wiring, read apps/chat/engine/provider-adapters.mjs next. Each adapter owns credential resolution and native model-id translation for its provider group. This matches the exploration/repo-map workflow: anchor on the seam file before editing leaf modules.',
    '',
    '```js',
    'import { createOwnedLoopDriver } from "./loop-driver.mjs";',
    'const driver = createOwnedLoopDriver({ createAgent });',
    '```',
    '',
    '## Why this seam matters',
    'If you add a provider, you extend the adapter registry and a functional fixture. The render layer and harness union stay stable, which is why tests/functional/chat-owned-loop.functional.test.mjs mocks the engine instead of the TUI. Treat this as a roles/engineer change: keep the seam narrow and prove behavior with a functional test. Document the adapter contract in a short comment block at the top of the new registry entry.',
    '',
    '## Concrete next steps',
    '1. Read apps/chat/engine/provider-adapters.mjs for the anthropic adapter shape.',
    '2. Add a matrix fixture in tests/functional/chat-providers.functional.test.mjs.',
    '3. Run npm test and confirm the owned-loop harness still maps usage events.',
  ].join('\n');
  const result = measureDepth(answer, {
    ...role.depthRubric,
    expectedSkills: role.expectedSkills,
    expectedSpecialists: role.specialistIds,
  });
  assert.equal(result.ok, true, result.failures.join('; '));
  assert.equal(result.depthGrade, 'deep');
});
