/**
 * tests/registry/surface-map-manifest.test.mjs — LMCP-B7: COMMAND_SURFACE/
 * SURFACE_TIERS moved from a hardcoded dict to
 * lib/registry/manifests/surface-map.default.json, with
 * `.cx/registry/surface-map.json` project-override support. Asserts the
 * default surface is byte-identical to the prior hardcoded dict, that an
 * override adds a surface entry in a fixture project, and that
 * validateSurfaceMap() fails for a command with no entry anywhere.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  SURFACE_TIERS, COMMAND_SURFACE, surfaceForCommand, resolveSurfaceMap,
  commandsBySurface, validateSurfaceMap, __clearSurfaceMapOverrideCache,
} from '../../lib/registry/surface-map.mjs';

const PRIOR_HARDCODED_COMMAND_SURFACE = {
  install: 'thin-cli', init: 'thin-cli', dev: 'thin-cli', stop: 'thin-cli',
  status: 'thin-cli', doctor: 'thin-cli', sync: 'thin-cli', ingest: 'agent-mcp',
  drop: 'agent-mcp', distill: 'agent-mcp', ask: 'agent-mcp', search: 'agent-mcp',
  knowledge: 'agent-mcp', memory: 'agent-mcp', reflect: 'agent-mcp', intake: 'tui',
  workflow: 'agent-mcp', graph: 'agent-mcp', capability: 'agent-mcp',
  execution: 'agent-mcp', orchestrate: 'agent-mcp', models: 'agent-mcp',
  profile: 'tui', sandbox: 'tui', review: 'thin-cli', telemetry: 'thin-cli',
  evals: 'thin-cli', improvement: 'thin-cli', ci: 'thin-cli', docs: 'thin-cli',
  export: 'agent-mcp', diagram: 'agent-mcp', demo: 'agent-mcp', beads: 'thin-cli',
  hook: 'internal', 'lint:comments': 'internal', 'lint:agents': 'internal',
  'registry:status': 'internal', 'registry:validate': 'internal',
  'registry:generate-docs': 'internal', rules: 'thin-cli',
};

function withFixtureProject(overrideJson, fn) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'cx-surface-map-'));
  try {
    if (overrideJson) {
      const dir = path.join(root, '.cx', 'registry');
      fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(path.join(dir, 'surface-map.json'), JSON.stringify(overrideJson, null, 2));
    }
    __clearSurfaceMapOverrideCache();
    return fn(root);
  } finally {
    __clearSurfaceMapOverrideCache();
    fs.rmSync(root, { recursive: true, force: true });
  }
}

test('SURFACE_TIERS/COMMAND_SURFACE are byte-identical to the prior hardcoded dict', () => {
  assert.deepEqual(SURFACE_TIERS, ['agent-mcp', 'thin-cli', 'tui', 'internal']);
  assert.deepEqual(COMMAND_SURFACE, PRIOR_HARDCODED_COMMAND_SURFACE);
});

test('resolveSurfaceMap with no project override is byte-identical to the prior hardcoded dict', () => {
  withFixtureProject(null, (root) => {
    const resolved = resolveSurfaceMap({ cwd: root });
    assert.deepEqual(resolved.tiers, ['agent-mcp', 'thin-cli', 'tui', 'internal']);
    assert.deepEqual(resolved.commands, PRIOR_HARDCODED_COMMAND_SURFACE);
  });
});

test('a .cx/registry/surface-map.json override adds a surface entry in a fixture project', () => {
  withFixtureProject({ commands: { 'my-plugin-cmd': 'tui' } }, (root) => {
    assert.equal(surfaceForCommand('my-plugin-cmd', { cwd: root }), 'tui');
    assert.equal(surfaceForCommand('status', { cwd: root }), 'thin-cli', 'unrelated default entries survive an additive override');
  });
});

test('an override can replace a default command surface entry', () => {
  withFixtureProject({ commands: { status: 'agent-mcp' } }, (root) => {
    assert.equal(surfaceForCommand('status', { cwd: root }), 'agent-mcp');
    assert.equal(COMMAND_SURFACE.status, 'thin-cli', 'the static default export is untouched');
  });
});

test('commandsBySurface groups by the resolved (default + override) map', () => {
  withFixtureProject({ commands: { 'my-plugin-cmd': 'tui' } }, (root) => {
    const grouped = commandsBySurface([{ name: 'status' }, { name: 'my-plugin-cmd' }], { cwd: root });
    assert.ok(grouped.tui.includes('my-plugin-cmd'));
    assert.ok(grouped['thin-cli'].includes('status'));
  });
});

test('validateSurfaceMap fails for a command with no entry in default or override', () => {
  withFixtureProject(null, (root) => {
    const result = validateSurfaceMap(['status', 'totally-unregistered-command'], { cwd: root });
    assert.equal(result.valid, false);
    assert.ok(result.errors.some((e) => e.includes('totally-unregistered-command')));
  });
});

test('validateSurfaceMap passes once an override adds the missing entry', () => {
  withFixtureProject({ commands: { 'totally-unregistered-command': 'internal' } }, (root) => {
    const result = validateSurfaceMap(['status', 'totally-unregistered-command'], { cwd: root });
    assert.equal(result.valid, true);
    assert.deepEqual(result.errors, []);
  });
});

test('colon-namespaced commands still default to internal at the surfaceForCommand runtime fallback (unaffected by validateSurfaceMap strictness)', () => {
  withFixtureProject(null, (root) => {
    assert.equal(surfaceForCommand('team:add', { cwd: root }), 'internal');
    assert.equal(surfaceForCommand('registry:validate', { cwd: root }), 'internal');
  });
});

test('surfaceForCommand resolves the observability groups to thin-cli, not just the COMMAND_SURFACE dict lookup', () => {
  withFixtureProject(null, (root) => {
    for (const name of ['review', 'telemetry', 'evals', 'improvement']) {
      assert.equal(surfaceForCommand(name, { cwd: root }), 'thin-cli', `${name} should be thin-cli`);
    }
  });
});
