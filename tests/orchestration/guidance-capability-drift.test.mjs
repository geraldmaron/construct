/**
 * tests/orchestration/guidance-capability-drift.test.mjs — gate for bare non-core MCP
 * tool references in Worker Profile guidance.
 */

import assert from 'node:assert/strict';
import test from 'node:test';

import {
  findBareNonCoreToolReferences,
  hostGuaranteedToolNames,
  scanGuidanceCapabilityDrift,
} from '../../lib/orchestration/guidance-capability-drift.mjs';

test('hostGuaranteedToolNames includes flat core tools and call', () => {
  const names = hostGuaranteedToolNames();
  assert.ok(names.has('orchestration_run'));
  assert.ok(names.has('call'));
  assert.equal(names.has('procedure_invoke'), false);
});

test('findBareNonCoreToolReferences flags imperative long-tail tool names', () => {
  const core = new Set(['orchestration_run', 'call']);
  const hits = findBareNonCoreToolReferences('use `procedure_invoke` for preview only', { coreNames: core });
  assert.equal(hits.length, 1);
  assert.equal(hits[0].tool, 'procedure_invoke');
});

test('findBareNonCoreToolReferences ignores core tools', () => {
  const core = hostGuaranteedToolNames();
  const hits = findBareNonCoreToolReferences('call `orchestration_run` with the request', { coreNames: core });
  assert.equal(hits.length, 0);
});

test('findBareNonCoreToolReferences allows long-tail names after call gateway phrasing', () => {
  const core = new Set(['call', 'orchestration_run']);
  const hits = findBareNonCoreToolReferences('use `call` with tool `procedure_invoke` for preview', { coreNames: core });
  assert.equal(hits.length, 0);
});

test('scanGuidanceCapabilityDrift passes on the committed worker profile prompts', () => {
  const report = scanGuidanceCapabilityDrift();
  assert.equal(report.ok, true, report.findings.map((f) => `${f.file}:${f.line} ${f.tool}`).join('\n'));
});
