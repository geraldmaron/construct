/**
 * tests/functional/mcp-doctor-diagnostics.functional.test.mjs — MCP doctor
 * diagnostic classification (construct-d1r7.3).
 *
 * Doctor must stay silent on catalog-only and installed-but-disabled MCP servers
 * (optional integrations the user has not turned on) and only raise an actionable
 * diagnostic for a server that is enabled on a managed surface but whose required
 * secret is unresolved. These tests drive the real classifier and the diagnosis
 * composition the mcp-protocol watcher consumes, with injected state/catalog/env
 * so all four state classes are covered hermetically (no host-config reads).
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { classifyMcpState, diagnoseMcpStates } from '../../lib/mcp-manager.mjs';

test('classifyMcpState: catalog-only server (not installed) is silent', () => {
  const verdict = classifyMcpState({ installed: false, enabled: false, requiredEnv: ['X'] }, {});
  assert.equal(verdict.class, 'catalog');
  assert.deepEqual(verdict.missing, []);
});

test('classifyMcpState: installed-but-disabled server is silent', () => {
  const verdict = classifyMcpState({ installed: true, enabled: false, requiredEnv: ['X'] }, {});
  assert.equal(verdict.class, 'disabled');
});

test('classifyMcpState: enabled server with an unresolved secret is actionable', () => {
  const verdict = classifyMcpState({ installed: true, enabled: true, requiredEnv: ['GITHUB_TOKEN'] }, {});
  assert.equal(verdict.class, 'missing-secret');
  assert.deepEqual(verdict.missing, ['GITHUB_TOKEN']);
});

test('classifyMcpState: an empty-string secret counts as unresolved', () => {
  const verdict = classifyMcpState({ installed: true, enabled: true, requiredEnv: ['GITHUB_TOKEN'] }, { GITHUB_TOKEN: '  ' });
  assert.equal(verdict.class, 'missing-secret');
});

test('classifyMcpState: enabled server with its secret resolved is healthy (silent)', () => {
  const verdict = classifyMcpState({ installed: true, enabled: true, requiredEnv: ['GITHUB_TOKEN'] }, { GITHUB_TOKEN: 'ghp_real' });
  assert.equal(verdict.class, 'healthy');
});

test('diagnoseMcpStates: only the enabled-missing-secret server is actionable; the other three classes stay silent', () => {
  const mcps = [
    { id: 'construct-mcp', requiredEnv: [] },
    { id: 'github', requiredEnv: ['GITHUB_TOKEN'] },
    { id: 'context7', requiredEnv: [] },
    { id: 'slack', requiredEnv: ['SLACK_TOKEN'] },
  ];
  const states = new Map([
    ['construct-mcp', { installed: true, enabled: true }],
    ['github', { installed: true, enabled: true }],
    ['context7', { installed: false, enabled: false }],
    ['slack', { installed: true, enabled: false }],
  ]);
  const env = {};

  const { actionable, silent } = diagnoseMcpStates({ states, mcps, env });

  assert.equal(actionable.length, 1, 'exactly one server (github, enabled + missing GITHUB_TOKEN) is actionable');
  assert.equal(actionable[0].id, 'github');
  assert.equal(actionable[0].kind, 'missing-secret');
  assert.deepEqual(actionable[0].missing, ['GITHUB_TOKEN']);
  assert.match(actionable[0].message, /construct mcp add github/);

  const silentIds = silent.map((s) => s.id).sort();
  assert.deepEqual(silentIds, ['construct-mcp', 'context7', 'slack'], 'catalog-only, healthy, and disabled servers are all silent');
});
