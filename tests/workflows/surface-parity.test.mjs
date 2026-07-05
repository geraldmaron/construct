/**
 * tests/workflows/surface-parity.test.mjs — unit and fixture tests for
 * workflow manifest surface-parity validation (LMCP-D4).
 *
 * Exercises checkSurfaceParity directly (undeclared mismatch, declared
 * exception, embed-manifest exclusion fixtures) and confirms all builtin
 * (non-embed) manifests pass against the real workflow-defs.mjs registration.
 */

import assert from 'node:assert/strict';
import test from 'node:test';

import { checkSurfaceParity, actualSurfaces, DECLARABLE_SURFACES } from '../../lib/workflows/surface-parity.mjs';
import { loadAllWorkflows } from '../../lib/workflows/loader.mjs';
import { WORKFLOW_TYPES } from '../../lib/embedded-contract/workflow-defs.mjs';

test('manifest declaring a surface it is not registered on fails', () => {
  const manifests = [{
    id: 'not-a-real-workflow-id',
    _filePath: '/fixtures/wf-ghost.manifest.json',
    type: 'linear',
    surfaces: ['cli', 'mcp'],
  }];
  const { errors } = checkSurfaceParity(manifests);
  assert.ok(errors.length > 0, 'expected at least one error');
  assert.ok(errors.every((e) => e.startsWith('/fixtures/wf-ghost.manifest.json')));
  assert.ok(errors.some((e) => e.includes("declares surface 'cli'") && e.includes('not actually registered')));
  assert.ok(errors.some((e) => e.includes("declares surface 'mcp'") && e.includes('not actually registered')));
});

test('manifest under-declaring a real registration fails', () => {
  const realId = WORKFLOW_TYPES[0];
  const manifests = [{
    id: realId,
    _filePath: '/fixtures/wf-underdeclared.manifest.json',
    type: 'linear',
    surfaces: ['cli'],
  }];
  const { errors } = checkSurfaceParity(manifests);
  assert.ok(errors.some((e) => e.includes(`'${realId}'`) && e.includes("registered on surface 'mcp'") && e.includes('does not declare it')));
});

test('declared exception with a reason string passes (string form)', () => {
  const manifests = [{
    id: 'not-a-real-workflow-id-2',
    _filePath: '/fixtures/wf-excepted.manifest.json',
    type: 'linear',
    surfaces: ['cli', 'mcp'],
    surfaceExceptions: {
      cli: 'legacy id kept for a deprecated integration; CLI dispatch removed in v3',
      mcp: 'legacy id kept for a deprecated integration; MCP dispatch removed in v3',
    },
  }];
  const { errors, infos } = checkSurfaceParity(manifests);
  assert.deepEqual(errors, []);
  assert.ok(infos.some((i) => i.includes('cli') && i.includes('declared exception')));
  assert.ok(infos.some((i) => i.includes('mcp') && i.includes('declared exception')));
});

test('declared exception with a reason string passes (object form)', () => {
  const manifests = [{
    id: 'not-a-real-workflow-id-3',
    _filePath: '/fixtures/wf-excepted-obj.manifest.json',
    type: 'linear',
    surfaces: ['cli'],
    surfaceExceptions: {
      cli: { reason: 'staged rollout: manifest ships ahead of CLI dispatch wiring' },
    },
  }];
  const { errors, infos } = checkSurfaceParity(manifests);
  assert.deepEqual(errors, []);
  assert.ok(infos.some((i) => i.includes('declared exception: staged rollout')));
});

test('an empty-string exception reason does not suppress the error', () => {
  const manifests = [{
    id: 'not-a-real-workflow-id-4',
    _filePath: '/fixtures/wf-blank-reason.manifest.json',
    type: 'linear',
    surfaces: ['cli'],
    surfaceExceptions: { cli: '   ' },
  }];
  const { errors } = checkSurfaceParity(manifests);
  assert.ok(errors.some((e) => e.includes("declares surface 'cli'")));
});

test('embed-type manifest declaring surfaces fails without an exception', () => {
  const manifests = [{
    id: 'embed-with-surfaces',
    _filePath: '/fixtures/wf-embed-surfaces.manifest.json',
    type: 'embed',
    surfaces: ['cli'],
  }];
  const { errors } = checkSurfaceParity(manifests);
  assert.ok(errors.some((e) => e.includes("declares surface 'cli'") && e.includes('not actually registered')));
});

test('embed-type manifest declaring no surfaces passes', () => {
  const manifests = [{
    id: 'embed-clean',
    _filePath: '/fixtures/wf-embed-clean.manifest.json',
    type: 'embed',
  }];
  const { errors } = checkSurfaceParity(manifests);
  assert.deepEqual(errors, []);
});

test('actualSurfaces returns empty for embed manifests', () => {
  assert.deepEqual(actualSurfaces({ id: 'x', type: 'embed' }), []);
});

test('actualSurfaces returns the declarable set for a registered non-embed manifest', () => {
  const realId = WORKFLOW_TYPES[0];
  assert.deepEqual(actualSurfaces({ id: realId, type: 'linear' }), DECLARABLE_SURFACES);
});

test('actualSurfaces returns empty for a non-embed manifest absent from WORKFLOW_TYPES', () => {
  assert.deepEqual(actualSurfaces({ id: 'not-a-real-workflow-id-5', type: 'linear' }), []);
});

test('all builtin workflow manifests pass surface parity (or carry a reason)', () => {
  const { workflows, errors: loadErrors } = loadAllWorkflows();
  assert.deepEqual(loadErrors, []);
  const { errors } = checkSurfaceParity(workflows);
  assert.deepEqual(errors, [], `expected zero surface-parity errors, got: ${JSON.stringify(errors, null, 2)}`);
});
