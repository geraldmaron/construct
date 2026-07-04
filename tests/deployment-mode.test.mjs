/**
 * tests/deployment-mode.test.mjs — Unit tests for lib/deployment-mode.mjs.
 *
 * Covers mode validation, env-driven resolution, topology mapping, and
 * the human-readable describe helpers feeding `construct config` output
 * and `construct status` topology line.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  DEPLOYMENT_MODES,
  DEFAULT_DEPLOYMENT_MODE,
  DEPLOYMENT_MODE_ENV_KEY,
  isValidDeploymentMode,
  describeDeploymentMode,
  describeResourceLine,
  getDeploymentMode,
  resolveResourceMode,
} from '../lib/deployment-mode.mjs';

describe('deployment-mode', () => {
  it('exposes the three canonical modes', () => {
    assert.deepEqual(DEPLOYMENT_MODES, ['solo', 'team', 'enterprise']);
    assert.equal(DEFAULT_DEPLOYMENT_MODE, 'solo');
  });

  it('validates known modes and rejects unknowns', () => {
    for (const mode of DEPLOYMENT_MODES) assert.ok(isValidDeploymentMode(mode));
    assert.equal(isValidDeploymentMode('SOLO'), false);
    assert.equal(isValidDeploymentMode(''), false);
    assert.equal(isValidDeploymentMode(null), false);
    assert.equal(isValidDeploymentMode(123), false);
    assert.equal(isValidDeploymentMode('cloud'), false);
  });

  describe('getDeploymentMode', () => {
    it('returns the default when env is missing the key', () => {
      assert.equal(getDeploymentMode({}), 'solo');
    });

    it('returns the env value when it is valid', () => {
      assert.equal(getDeploymentMode({ [DEPLOYMENT_MODE_ENV_KEY]: 'team' }), 'team');
      assert.equal(getDeploymentMode({ [DEPLOYMENT_MODE_ENV_KEY]: 'enterprise' }), 'enterprise');
    });

    it('lowercases and trims the env value', () => {
      assert.equal(getDeploymentMode({ [DEPLOYMENT_MODE_ENV_KEY]: '  TEAM  ' }), 'team');
    });

    it('falls back to the default on unknown values', () => {
      assert.equal(getDeploymentMode({ [DEPLOYMENT_MODE_ENV_KEY]: 'cloud' }), 'solo');
      assert.equal(getDeploymentMode({ [DEPLOYMENT_MODE_ENV_KEY]: '' }), 'solo');
    });
  });

  describe('resolveResourceMode', () => {
    it('returns the solo topology declaring the filesystem queue provider', () => {
      const r = resolveResourceMode('solo');
      assert.equal(r.queue, 'filesystem');
      assert.equal(r.memory, 'local');
      assert.equal(r.workers, 'local');
      assert.equal(r.mcp, 'direct');
    });

    it('returns the team topology with postgres queue/docker/brokered MCP', () => {
      const r = resolveResourceMode('team');
      assert.equal(r.queue, 'postgres');
      assert.equal(r.memory, 'shared');
      assert.equal(r.workers, 'docker');
      assert.equal(r.mcp, 'brokered');
    });

    it('returns the enterprise topology with isolated workers and signed MCP', () => {
      const r = resolveResourceMode('enterprise');
      assert.equal(r.workers, 'isolated');
      assert.equal(r.mcp, 'brokered-signed');
      assert.equal(r.policy, 'enforceable');
    });

    it('throws on unknown mode', () => {
      assert.throws(() => resolveResourceMode('bogus'), /Unknown deployment mode/);
    });

    it('returns a fresh object so callers cannot mutate the table', () => {
      const a = resolveResourceMode('team');
      a.queue = 'mutated';
      const b = resolveResourceMode('team');
      assert.equal(b.queue, 'postgres');
    });
  });

  it('describes each mode with a non-empty sentence', () => {
    for (const mode of DEPLOYMENT_MODES) {
      const text = describeDeploymentMode(mode);
      assert.ok(text.length > 20, `${mode} description should be a real sentence`);
    }
    assert.equal(describeDeploymentMode('bogus'), '');
  });

  it('produces a compact one-line topology summary for status displays', () => {
    const line = describeResourceLine('team');
    assert.match(line, /queue:postgres/);
    assert.match(line, /workers:docker/);
    assert.match(line, /telemetry:central/);
  });
});
