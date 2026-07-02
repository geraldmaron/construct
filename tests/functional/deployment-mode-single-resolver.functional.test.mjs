/**
 * deployment-mode-single-resolver.functional.test.mjs — every surface resolves
 * deployment mode the same way.
 *
 * Broker, session prelude, and the scheduler all delegate to the canonical
 * getDeploymentMode, so a mode set via env OR project config propagates identically
 * across every surface — a config-only `team` deployment must not read as `solo`
 * anywhere. Uses an isolated tmp project (a .git marker + construct.config.json) so
 * no real config is read.
 */

import { describe, it, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { getDeploymentMode } from '../../lib/deployment-mode.mjs';
import { isBrokered } from '../../lib/mcp/broker.mjs';
import { buildBrokerStatusLine } from '../../lib/intake/session-prelude.mjs';
import { resolveDocHygieneSchedule } from '../../lib/scheduler/index.mjs';
import { CONFIG_SCHEMA_VERSION } from '../../lib/config/schema.mjs';

const tmpDirs = [];
after(() => {
  for (const d of tmpDirs) {
    try { fs.rmSync(d, { recursive: true, force: true }); } catch { /* best effort */ }
  }
});

function makeProject({ configMode } = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cx-mode-resolver-'));
  tmpDirs.push(dir);
  fs.mkdirSync(path.join(dir, '.git'));
  if (configMode) {
    fs.writeFileSync(
      path.join(dir, 'construct.config.json'),
      JSON.stringify({ version: CONFIG_SCHEMA_VERSION, deployment: { mode: configMode } }, null, 2),
    );
  }
  return dir;
}

function assertAllAgree(env, cwd, expected) {
  assert.equal(getDeploymentMode(env, { cwd }), expected, 'getDeploymentMode');
  const brokered = expected === 'team' || expected === 'enterprise';
  assert.equal(isBrokered(env, { cwd }), brokered, 'isBrokered');
  assert.match(buildBrokerStatusLine({ env, cwd }), new RegExp(`deployment mode: ${expected}`), 'buildBrokerStatusLine');
  assert.equal(resolveDocHygieneSchedule(env, { cwd }).mode, brokered ? 'team' : 'solo', 'resolveDocHygieneSchedule');
}

describe('deployment mode: single canonical resolver', () => {
  it('config-only team propagates identically to broker, prelude, and scheduler', () => {
    const cwd = makeProject({ configMode: 'team' });
    assertAllAgree({}, cwd, 'team');
  });

  it('env CONSTRUCT_DEPLOYMENT_MODE=team propagates identically', () => {
    const cwd = makeProject();
    assertAllAgree({ CONSTRUCT_DEPLOYMENT_MODE: 'team' }, cwd, 'team');
  });

  it('defaults to solo when neither env nor config is set', () => {
    const cwd = makeProject();
    assertAllAgree({}, cwd, 'solo');
  });

  it('CONSTRUCT_MCP_BROKER override wins independent of resolved mode', () => {
    const teamCwd = makeProject({ configMode: 'team' });
    assert.equal(isBrokered({ CONSTRUCT_MCP_BROKER: 'off' }, { cwd: teamCwd }), false, 'off overrides team');
    assert.equal(isBrokered({ CONSTRUCT_MCP_BROKER: 'on' }, { cwd: makeProject() }), true, 'on overrides solo');
  });
});
