/**
 * tests/workflows/manifest-schema.test.mjs — unit tests for workflow manifest schema constants.
 */

import assert from 'node:assert/strict';
import test from 'node:test';

import {
  WORKFLOW_TYPES, WORKFLOW_REQUIRED_FIELDS, WORKFLOW_OPTIONAL_FIELDS,
  WORKFLOW_COMPAT_VERSION, APPROVAL_MODES, DURABLE_STATE_MODELS, TIERS,
} from '../../lib/workflows/manifest-schema.mjs';

test('WORKFLOW_TYPES is defined and non-empty', () => {
  assert.ok(Array.isArray(WORKFLOW_TYPES));
  assert.ok(WORKFLOW_TYPES.length > 0);
});

test('WORKFLOW_TYPES contains expected values', () => {
  for (const t of ['linear', 'routing', 'orchestrator-worker', 'evaluator-loop', 'pipeline']) {
    assert.ok(WORKFLOW_TYPES.includes(t), `${t} is in WORKFLOW_TYPES`);
  }
});

test('WORKFLOW_REQUIRED_FIELDS is defined and non-empty', () => {
  assert.ok(Array.isArray(WORKFLOW_REQUIRED_FIELDS));
  assert.ok(WORKFLOW_REQUIRED_FIELDS.length >= 4);
  assert.ok(WORKFLOW_REQUIRED_FIELDS.includes('id'));
  assert.ok(WORKFLOW_REQUIRED_FIELDS.includes('version'));
  assert.ok(WORKFLOW_REQUIRED_FIELDS.includes('type'));
  assert.ok(WORKFLOW_REQUIRED_FIELDS.includes('defaultApprovalMode'));
});

test('WORKFLOW_OPTIONAL_FIELDS is defined and non-empty', () => {
  assert.ok(Array.isArray(WORKFLOW_OPTIONAL_FIELDS));
  assert.ok(WORKFLOW_OPTIONAL_FIELDS.length > 0);
});

test('WORKFLOW_COMPAT_VERSION is a positive integer', () => {
  assert.equal(typeof WORKFLOW_COMPAT_VERSION, 'number');
  assert.ok(Number.isInteger(WORKFLOW_COMPAT_VERSION));
  assert.ok(WORKFLOW_COMPAT_VERSION > 0);
});

test('APPROVAL_MODES is defined and non-empty', () => {
  assert.ok(Array.isArray(APPROVAL_MODES));
  assert.ok(APPROVAL_MODES.length > 0);
  assert.ok(APPROVAL_MODES.includes('proposal-only'));
  assert.ok(APPROVAL_MODES.includes('requires-human-approval'));
  assert.ok(APPROVAL_MODES.includes('allow-durable-write'));
});

test('DURABLE_STATE_MODELS is defined and non-empty', () => {
  assert.ok(Array.isArray(DURABLE_STATE_MODELS));
  assert.ok(DURABLE_STATE_MODELS.length > 0);
  assert.ok(DURABLE_STATE_MODELS.includes('none'));
  assert.ok(DURABLE_STATE_MODELS.includes('git-queue'));
  assert.ok(DURABLE_STATE_MODELS.includes('in-process'));
});

test('TIERS is defined and non-empty', () => {
  assert.ok(Array.isArray(TIERS));
  assert.ok(TIERS.length > 0);
  assert.ok(TIERS.includes('fast'));
  assert.ok(TIERS.includes('standard'));
  assert.ok(TIERS.includes('reasoning'));
});