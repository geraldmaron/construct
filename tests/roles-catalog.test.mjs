/**
 * tests/roles-catalog.test.mjs — regression tests for lib/roles/catalog.mjs.
 *
 * listRoles must read the live registry.specialists array (not absent keys like
 * registry.agents/departments, which yield an empty list and silently break
 * roles:list and the embedded capability contract). These tests pin the reader
 * to that array and assert the descriptor shape.
 */

import assert from 'node:assert/strict';
import test from 'node:test';

import { listRoles, formatRoleList } from '../lib/roles/catalog.mjs';
import { loadRegistry } from '../lib/registry/loader.mjs';

const registry = loadRegistry({ rootDir: new URL('..', import.meta.url).pathname });

test('listRoles returns one descriptor per registry specialist', () => {
  const roles = listRoles();
  assert.equal(roles.length, Object.values(registry.specialists).length);
  assert.ok(roles.length >= 28, `expected at least 28 roles, got ${roles.length}`);
});

test('listRoles descriptors carry the prefixed name and required fields', () => {
  const roles = listRoles();
  const engineer = roles.find((r) => r.id === 'engineer');
  assert.ok(engineer, 'engineer role present');
  assert.equal(engineer.name, 'cx-engineer');
  assert.equal(typeof engineer.description, 'string');
  assert.ok(engineer.description.length > 0);
  assert.equal(typeof engineer.modelTier, 'string');
  assert.equal(typeof engineer.canEdit, 'boolean');
  assert.equal(typeof engineer.internal, 'boolean');
  assert.ok(Array.isArray(engineer.skills));
});

test('listRoles ids are unique', () => {
  const ids = listRoles().map((r) => r.id);
  assert.equal(new Set(ids).size, ids.length);
});

test('formatRoleList renders every role name', () => {
  const text = formatRoleList();
  assert.match(text, /Available Roles/);
  for (const role of listRoles()) {
    assert.ok(text.includes(role.name), `output should include ${role.name}`);
  }
});
