/**
 * tests/embed-target-resolver.test.mjs — target resolver tests.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { resolveTargets, routeArtifact, resolveArtifactPath } from '../lib/embed/target-resolver.mjs';
import { DEFAULT_WORKSPACE_PATH, WORKSPACE_DOCS_LANES } from '../lib/embed/config.mjs';

describe('resolveTargets', () => {
  it('returns workspace fallback when no explicit targets', async () => {
    const targets = await resolveTargets({}, null);
    assert.equal(targets.length, 1);
    assert.equal(targets[0].type, 'workspace');
    assert.equal(targets[0].access, 'local');
  });

  it('includes explicit targets and workspace fallback', async () => {
    const config = {
      targets: [
        { type: 'repo', ref: 'github.com/org/repo' },
      ],
    };
    const targets = await resolveTargets(config, null);
    assert.equal(targets.length, 2);
    assert.equal(targets[0].type, 'repo');
    assert.equal(targets[0].ref, 'github.com/org/repo');
    assert.equal(targets[0].access, 'remote');
    assert.equal(targets[1].type, 'workspace');
  });

  it('deduplicates explicit workspace entries', async () => {
    const config = {
      targets: [{ type: 'workspace' }],
    };
    const targets = await resolveTargets(config, null);
    const workspaces = targets.filter((t) => t.type === 'workspace');
    assert.equal(workspaces.length, 1);
  });

  it('discovers repos from signals', async () => {
    const config = {};
    const signals = [{ body: 'See https://github.com/acme/widget for details' }];
    const targets = await resolveTargets(config, null, { signals });
    const repos = targets.filter((t) => t.type === 'repo');
    assert.equal(repos.length, 1);
    assert.ok(repos[0].ref.includes('acme/widget'));
  });
});

describe('routeArtifact', () => {
  it('prefers local non-workspace target', () => {
    const targets = [
      { type: 'repo', path: '/tmp/repo', access: 'local' },
      { type: 'workspace', path: DEFAULT_WORKSPACE_PATH, access: 'local' },
    ];
    const routed = routeArtifact(targets, 'adrs');
    assert.equal(routed.type, 'repo');
  });

  it('falls back to workspace when only remote targets', () => {
    const targets = [
      { type: 'repo', ref: 'github.com/org/repo', access: 'remote' },
      { type: 'workspace', path: DEFAULT_WORKSPACE_PATH, access: 'local', docs: WORKSPACE_DOCS_LANES },
    ];
    const routed = routeArtifact(targets, 'notes');
    assert.equal(routed.type, 'workspace');
  });
});

describe('resolveArtifactPath', () => {
  it('builds correct path for a docs lane', () => {
    const target = { type: 'repo', path: '/home/user/myrepo', access: 'local' };
    const p = resolveArtifactPath(target, 'adrs', '001-auth.md');
    assert.equal(p, '/home/user/myrepo/docs/adrs/001-auth.md');
  });

  it('falls back to DEFAULT_WORKSPACE_PATH when target has no path', () => {
    const target = { type: 'workspace', access: 'local' };
    const p = resolveArtifactPath(target, 'notes', 'meeting.md');
    assert.ok(p.includes('docs/notes/meeting.md'));
  });
});
