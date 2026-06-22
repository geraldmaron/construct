/**
 * tests/tool-budget.test.mjs — unit coverage for the owned-loop tool-budget filter
 * (construct-rv2x).
 *
 * toolGroupForName maps the engine's agent tool names onto the execution-policy
 * tool groups, and applyToolBudget trims a tool set to a compiled policy's allowed
 * groups and schema cap. The rich/hosted-direct envelope (all groups, cap 32) must
 * return the input set unchanged so the hosted path is behavior-preserving.
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import { toolGroupForName, applyToolBudget } from '../lib/mcp/tool-budget.mjs';

const AGENT_TOOLS = { read: {}, glob: {}, grep: {}, write: {}, edit: {}, shell: {}, construct_tool: {} };

const RICH_GROUPS = ['read', 'search', 'edit', 'shell', 'construct', 'heavy-mcp'];
const STANDARD_GROUPS = ['read', 'search', 'edit', 'construct'];
const MINIMAL_GROUPS = ['read', 'search', 'construct'];

test('toolGroupForName maps every agent tool onto its policy group', () => {
  assert.equal(toolGroupForName('read'), 'read');
  assert.equal(toolGroupForName('glob'), 'search');
  assert.equal(toolGroupForName('grep'), 'search');
  assert.equal(toolGroupForName('write'), 'edit');
  assert.equal(toolGroupForName('edit'), 'edit');
  assert.equal(toolGroupForName('shell'), 'shell');
  assert.equal(toolGroupForName('construct_tool'), 'construct');
});

test('an unrecognized tool defaults to the always-allowed construct group', () => {
  assert.equal(toolGroupForName('mystery_tool'), 'construct');
});

test('the rich envelope returns the tool set unchanged', () => {
  const out = applyToolBudget(AGENT_TOOLS, { allowedToolGroups: RICH_GROUPS, maxToolSchemas: 32 });
  assert.deepEqual(Object.keys(out), Object.keys(AGENT_TOOLS));
});

test('the standard envelope drops shell but keeps edit', () => {
  const out = applyToolBudget(AGENT_TOOLS, { allowedToolGroups: STANDARD_GROUPS, maxToolSchemas: 16 });
  assert.deepEqual(Object.keys(out), ['read', 'glob', 'grep', 'write', 'edit', 'construct_tool']);
  assert.ok(!('shell' in out));
});

test('the minimal envelope drops edit and shell', () => {
  const out = applyToolBudget(AGENT_TOOLS, { allowedToolGroups: MINIMAL_GROUPS, maxToolSchemas: 8 });
  assert.deepEqual(Object.keys(out), ['read', 'glob', 'grep', 'construct_tool']);
});

test('the schema cap bounds the survivor count in stable order', () => {
  const out = applyToolBudget(AGENT_TOOLS, { allowedToolGroups: RICH_GROUPS, maxToolSchemas: 3 });
  assert.deepEqual(Object.keys(out), ['read', 'glob', 'grep']);
});

test('a null group filter keeps every tool, capping only by count', () => {
  const all = applyToolBudget(AGENT_TOOLS, { allowedToolGroups: null });
  assert.deepEqual(Object.keys(all), Object.keys(AGENT_TOOLS));
  const capped = applyToolBudget(AGENT_TOOLS, { allowedToolGroups: null, maxToolSchemas: 2 });
  assert.deepEqual(Object.keys(capped), ['read', 'glob']);
});

test('a non-object tool set is returned untouched', () => {
  assert.equal(applyToolBudget(null, { allowedToolGroups: MINIMAL_GROUPS }), null);
});
