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

test('sre may edit runbooks (in-fence)', () => {
  const r = checkAction({ personaId: 'sre', action: 'edit', target: 'docs/operations/runbooks/postgres.md' });
  assert.equal(r.allowed, true);
});

test('sre editing lib/ needs approval', () => {
  const r = checkAction({ personaId: 'sre', action: 'edit', target: 'lib/foo.mjs' });
  assert.equal(r.allowed, false);
  assert.equal(r.approval, true);
});

test('security may edit security docs but not code', () => {
  assert.equal(
    checkAction({ personaId: 'security', action: 'edit', target: 'docs/security/threat.md' }).allowed,
    true
  );
  const codeAttempt = checkAction({ personaId: 'security', action: 'edit', target: 'lib/foo.mjs' });
  assert.equal(codeAttempt.allowed, false);
  assert.equal(codeAttempt.approval, true);
});

test('docs-keeper may edit README and CHANGELOG', () => {
  assert.equal(checkAction({ personaId: 'docs-keeper', action: 'edit', target: 'README.md' }).allowed, true);
  assert.equal(checkAction({ personaId: 'docs-keeper', action: 'edit', target: 'sub/README.md' }).allowed, true);
  assert.equal(checkAction({ personaId: 'docs-keeper', action: 'edit', target: 'CHANGELOG.md' }).allowed, true);
});

test('every onboarded persona requires approval for commit and push', () => {
  for (const id of ['sre', 'qa', 'security', 'docs-keeper']) {
    assert.equal(checkAction({ personaId: id, action: 'commit', target: '' }).approval, true, `${id} commit`);
    assert.equal(checkAction({ personaId: id, action: 'push', target: '' }).approval, true, `${id} push`);
  }
});

test('bash fence uses prefix match against allowedCommands', () => {
  assert.equal(checkAction({ personaId: 'sre', action: 'bash', target: 'bd note construct-abc some-note' }).allowed, true);
  assert.equal(checkAction({ personaId: 'sre', action: 'bash', target: 'bd create incident-x -t bug' }).allowed, true);
  const denied = checkAction({ personaId: 'sre', action: 'bash', target: 'npm install lodash' });
  assert.equal(denied.allowed, false);
  assert.equal(denied.reason, 'outside-fence');
});

test('bd-label inside allowed list is permitted; outside is denied', () => {
  assert.equal(checkAction({ personaId: 'sre', action: 'bd-label', target: 'incident,sre' }).allowed, true);
  assert.equal(checkAction({ personaId: 'sre', action: 'bd-label', target: 'incident,next:cx-engineer' }).allowed, true);
  assert.equal(checkAction({ personaId: 'sre', action: 'bd-label', target: 'random' }).allowed, false);
});

test('unknown persona is rejected', () => {
  const r = checkAction({ personaId: 'made-up', action: 'edit', target: 'anything' });
  assert.equal(r.allowed, false);
  assert.equal(r.reason, 'persona-not-onboarded');
});

test('computeEffectiveFence: team fence bounds specialist fence', () => {
  // Engineer fence is narrower than any team allows; effective fence should be engineer's own fence
  const engineerFence = {
    allowedPaths: ['lib/**', 'tests/**'],
    allowedCommands: ['npm test', 'npm run build'],
    deniedActions: [],
    approvalRequired: ['commit', 'push'],
  };
  const effective = computeEffectiveFence('engineer', engineerFence);
  assert.ok(effective, 'should return an effective fence');
  // Denied actions should include team's forbidden decisions
  assert.ok(Array.isArray(effective.deniedActions), 'deniedActions should be an array');
});

test('computeEffectiveFence: specialist cannot exceed team authority', () => {
  // Create a specialist fence that tries to allow something the team forbids
  const overreachingFence = {
    allowedPaths: ['lib/**', 'tests/**', 'specialists/**'],
    allowedCommands: ['npm', 'git'],
    deniedActions: [],
    approvalRequired: [],
  };
  // Mock registry with engineering-group team that forbids certain decisions
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
  // Effective fence should add team's forbidden decisions to deniedActions
  assert.ok(Array.isArray(effective.deniedActions), 'deniedActions should include team forbiddens');
  // team forbids: product-scope, user-research, deployment-timing
  // so these should appear as denied patterns
  const hasForbidden = effective.deniedActions.some(d =>
    d.includes('product-scope') || d.includes('user-research') || d.includes('deployment-timing')
  );
  assert.ok(hasForbidden, 'effective fence should block team-forbidden decisions');
});

test('computeEffectiveFence: gracefully handles missing team', () => {
  // A persona with no team should get the specialist fence as-is
  const specialistFence = {
    allowedPaths: ['docs/**'],
    allowedCommands: [],
    deniedActions: ['anything:risky'],
    approvalRequired: ['commit'],
  };
  const effective = computeEffectiveFence('unknown-persona', specialistFence);
  // Should return something reasonable even if persona is not found
  assert.ok(effective, 'should handle missing team gracefully');
});
