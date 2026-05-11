/**
 * tests/roles/fence.test.mjs — action-vs-manifest fence check.
 */
import assert from 'node:assert/strict';
import test from 'node:test';

import { checkAction, globMatch } from '../../lib/roles/fence.mjs';

test('globMatch handles ** and *', () => {
  assert.equal(globMatch('docs/**', 'docs/runbooks/foo.md'), true);
  assert.equal(globMatch('docs/**', 'lib/foo.mjs'), false);
  assert.equal(globMatch('docs/*.md', 'docs/foo.md'), true);
  assert.equal(globMatch('docs/*.md', 'docs/sub/foo.md'), false);
});

test('sre may edit runbooks (in-fence)', () => {
  const r = checkAction({ personaId: 'sre', action: 'edit', target: 'docs/runbooks/postgres.md' });
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
