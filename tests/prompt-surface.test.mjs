/**
 * tests/prompt-surface.test.mjs — prompt surface policy enforcement tests
 *
 * Tests that key prompt files (construct persona, orchestrator, work/drive, work/plan)
 * delegate routing policy to code rather than restating it inline. Ensures prompt
 * surfaces stay lean and do not drift from the policy module.
 * Run via npm test.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');

test('construct persona delegates routing policy to code', () => {
  const text = fs.readFileSync(path.join(root, 'personas/construct.md'), 'utf8');
  assert.match(text, /code-backed orchestration policy/);
  assert.doesNotMatch(text, /\*\*Focused\*\* — dispatch one specialist/);
});

test('prompt surface architecture states Construct is the sole public persona', () => {
  const text = fs.readFileSync(path.join(root, 'docs/concepts/prompt-surfaces.mdx'), 'utf8');
  assert.match(text, /sole public persona/);
  assert.match(text, /internal specialist prompts/);
  assert.match(text, /offline-only regression surfaces/);
});

test('designer prompt covers visual deliverables beyond implemented UI', () => {
  const text = fs.readFileSync(path.join(root, 'specialists/prompts/cx-designer.md'), 'utf8');
  assert.match(text, /slide decks and presentations/);
  assert.match(text, /walkthroughs and demo videos/);
  assert.match(text, /construct wireframe/);
});

test('orchestrator prompt no longer embeds a dispatch map', () => {
  const text = fs.readFileSync(path.join(root, 'specialists/prompts/cx-orchestrator.md'), 'utf8');
  assert.match(text, /code-backed orchestration policy/);
  assert.doesNotMatch(text, /Dispatch map/);
});

test('drive and plan commands refer to policy instead of restating routing rules', () => {
  const drive = fs.readFileSync(path.join(root, 'commands/work/drive.md'), 'utf8');
  const plan = fs.readFileSync(path.join(root, 'commands/plan/feature.md'), 'utf8');
  assert.match(drive, /code-backed orchestration policy/);
  assert.match(plan, /code-backed orchestration policy/);
});

test('context command treats context.json as canonical', () => {
  const text = fs.readFileSync(path.join(root, 'commands/remember/context.md'), 'utf8');
  assert.match(text, /context\.json/);
});

test('construct persona enumerates every field the construct-to-orchestrator contract requires', () => {
  const persona = fs.readFileSync(path.join(root, 'personas/construct.md'), 'utf8');
  const contracts = JSON.parse(fs.readFileSync(path.join(root, 'specialists/contracts.json'), 'utf8'));
  const c2o = contracts.contracts.find((c) => c.id === 'construct-to-orchestrator');
  assert.ok(c2o, 'construct-to-orchestrator contract must exist');
  // Persona must reference every mustContain field by name. Without this,
  // dispatched packets would fail validateHandoff and the orchestrator's
  // input check would BLOCKED_CONTRACT.
  for (const field of c2o.input.mustContain) {
    assert.match(persona, new RegExp(`\\b${field}\\b`), `persona must reference field '${field}'`);
  }
});
