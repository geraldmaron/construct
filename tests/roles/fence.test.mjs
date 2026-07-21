/**
 * tests/roles/fence.test.mjs — action-vs-manifest fence check with team awareness.
 */
import assert from 'node:assert/strict';
import test from 'node:test';

import { checkAction, globMatch, computeEffectiveFence } from '../../lib/roles/fence.mjs';

test('globMatch handles ** and *', () => {
  assert.equal(globMatch('docs/**', 'docs/operations/runbooks/foo.md'), true);
  assert.equal(globMatch('docs/**', 'lib/foo.mjs'), false);
  assert.equal(globMatch('docs/*.md', 'docs/foo.md'), true);
  assert.equal(globMatch('docs/*.md', 'docs/sub/foo.md'), false);
});

test('operations may edit runbooks (in-fence)', () => {
  const r = checkAction({ workerProfileId: 'operations', action: 'edit', target: 'docs/operations/runbooks/postgres.md' });
  assert.equal(r.allowed, true);
});

test('operations editing lib/ needs approval', () => {
  const r = checkAction({ workerProfileId: 'operations', action: 'edit', target: 'lib/foo.mjs' });
  assert.equal(r.allowed, false);
  assert.equal(r.approval, true);
});

test('security may edit security docs but not code', () => {
  assert.equal(
    checkAction({ workerProfileId: 'security', action: 'edit', target: 'docs/security/threat.md' }).allowed,
    true
  );
  const codeAttempt = checkAction({ workerProfileId: 'security', action: 'edit', target: 'lib/foo.mjs' });
  assert.equal(codeAttempt.allowed, false);
  assert.equal(codeAttempt.approval, true);
});

test('operations may edit README and CHANGELOG', () => {
  assert.equal(checkAction({ workerProfileId: 'operations', action: 'edit', target: 'README.md' }).allowed, true);
  assert.equal(checkAction({ workerProfileId: 'operations', action: 'edit', target: 'sub/README.md' }).allowed, true);
  assert.equal(checkAction({ workerProfileId: 'operations', action: 'edit', target: 'CHANGELOG.md' }).allowed, true);
});

test('every onboarded worker profile requires approval for commit and push', () => {
  for (const id of ['operations', 'qa', 'security']) {
    assert.equal(checkAction({ workerProfileId: id, action: 'commit', target: '' }).approval, true, `${id} commit`);
    assert.equal(checkAction({ workerProfileId: id, action: 'push', target: '' }).approval, true, `${id} push`);
  }
});

test('bash fence uses prefix match against allowedCommands', () => {
  assert.equal(checkAction({ workerProfileId: 'operations', action: 'bash', target: 'bd note construct-abc some-note' }).allowed, true);
  assert.equal(checkAction({ workerProfileId: 'operations', action: 'bash', target: 'bd create incident-x -t bug' }).allowed, true);
  const denied = checkAction({ workerProfileId: 'operations', action: 'bash', target: 'npm install lodash' });
  assert.equal(denied.allowed, false);
  assert.equal(denied.reason, 'outside-fence');
});

test('bd-label inside allowed list is permitted; outside is denied', () => {
  assert.equal(checkAction({ workerProfileId: 'operations', action: 'bd-label', target: 'incident,sre' }).allowed, true);
  assert.equal(checkAction({ workerProfileId: 'operations', action: 'bd-label', target: 'incident,next:engineer' }).allowed, true);
  assert.equal(checkAction({ workerProfileId: 'operations', action: 'bd-label', target: 'random' }).allowed, false);
});

test('unknown worker profile is rejected', () => {
  const r = checkAction({ workerProfileId: 'made-up', action: 'edit', target: 'anything' });
  assert.equal(r.allowed, false);
  assert.equal(r.reason, 'worker-profile-not-onboarded');
});

test('computeEffectiveFence: without registry returns profile fence as-is', () => {
  const engineerFence = {
    allowedPaths: ['lib/**', 'tests/**'],
    allowedCommands: ['npm test', 'npm run build'],
    deniedActions: [],
    approvalRequired: ['commit', 'push'],
  };
  const effective = computeEffectiveFence('engineer', engineerFence);
  assert.deepEqual(effective, engineerFence);
});

test('computeEffectiveFence: live-shaped registry without teams leaves fence unchanged', () => {
  const fence = {
    allowedPaths: ['lib/**'],
    allowedCommands: ['npm test'],
    deniedActions: [],
    approvalRequired: ['commit'],
  };
  const liveShaped = {
    workspacePresets: {},
    workerProfiles: {},
    procedures: {},
    capabilities: {},
    policies: {},
  };
  const effective = computeEffectiveFence('engineer', fence, liveShaped);
  assert.deepEqual(effective, fence);
});

test('computeEffectiveFence: specialist cannot exceed team authority', () => {
  const overreachingFence = {
    allowedPaths: ['lib/**', 'tests/**', 'registry/worker-profiles/**'],
    allowedCommands: ['npm', 'git'],
    deniedActions: [],
    approvalRequired: [],
  };
  const mockRegistry = {
    teams: {
      'engineering-group': {
        id: 'engineering-group',
        roles: ['engineer'],
        forbiddenDecisions: ['product-scope', 'user-research', 'deployment-timing'],
        decisionRights: ['architecture', 'technology-selection'],
      },
    },
  };
  const effective = computeEffectiveFence('engineer', overreachingFence, mockRegistry);
  assert.ok(Array.isArray(effective.deniedActions), 'deniedActions should include team forbiddens');
  const hasForbidden = effective.deniedActions.some((d) =>
    d.includes('product-scope') || d.includes('user-research') || d.includes('deployment-timing')
  );
  assert.ok(hasForbidden, 'effective fence should block team-forbidden decisions');
});

test('computeEffectiveFence: gracefully handles missing team', () => {
  const specialistFence = {
    allowedPaths: ['docs/**'],
    allowedCommands: [],
    deniedActions: ['anything:risky'],
    approvalRequired: ['commit'],
  };
  const effective = computeEffectiveFence('unknown-persona', specialistFence);
  assert.deepEqual(effective, specialistFence);
});
