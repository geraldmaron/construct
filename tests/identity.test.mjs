/**
 * tests/identity.test.mjs — actor/service identity resolution unit tests.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  resolveIdentity,
  identityToRecord,
  identityRole,
  validateIdentity,
  IdentityError,
  serviceIdentity,
  humanIdentity,
} from '../lib/identity.mjs';

describe('identity module', () => {

  it('solo mode returns implicit service identity', () => {
    const id = resolveIdentity({}, { env: { CONSTRUCT_DEPLOYMENT_MODE: 'solo' } });
    assert.equal(id.type, 'service');
    assert.ok(id.serviceId);
    assert.equal(id.deploymentMode, 'solo');
    assert.equal(id.source, 'implicit-solo');
  });

  it('email header returns human identity', () => {
    const id = resolveIdentity(
      { _meta: { 'X-Construct-Actor-Id': 'alice@example.com' } },
      { env: {} },
    );
    assert.equal(id.type, 'human');
    assert.equal(id.userId, 'alice@example.com');
    assert.equal(id.source, 'headers');
  });

  it('service header returns service identity', () => {
    const id = resolveIdentity(
      { _meta: { 'X-Construct-Actor-Id': 'ci-bot' } },
      { env: {} },
    );
    assert.equal(id.type, 'service');
    assert.equal(id.serviceId, 'ci-bot');
    assert.equal(id.source, 'headers');
  });

  it('team mode without headers throws', () => {
    assert.throws(
      () => resolveIdentity({}, { env: { CONSTRUCT_DEPLOYMENT_MODE: 'team' } }),
      IdentityError,
    );
  });

  it('team mode with CONSTRUCT_ROLE fallback', () => {
    const id = resolveIdentity(
      {},
      { env: { CONSTRUCT_DEPLOYMENT_MODE: 'team', CONSTRUCT_ROLE: 'engineer' } },
    );
    assert.equal(id.type, 'service');
    assert.equal(id.serviceId, 'role:engineer');
    assert.equal(id.role, 'engineer');
    assert.equal(id.source, 'env-fallback');
  });

  it('identityToRecord serializes human', () => {
    const id = humanIdentity({ userId: 'bob@co.com', role: 'admin', sessionId: 'sess-1' });
    const rec = identityToRecord(id);
    assert.equal(rec.type, 'human');
    assert.equal(rec.userId, 'bob@co.com');
    assert.equal(rec.role, 'admin');
    assert.equal(rec.sessionId, 'sess-1');
  });

  it('identityToRecord serializes service', () => {
    const id = serviceIdentity({ serviceId: 'my-svc', deploymentMode: 'team' });
    const rec = identityToRecord(id);
    assert.equal(rec.type, 'service');
    assert.equal(rec.serviceId, 'my-svc');
    assert.equal(rec.deploymentMode, 'team');
  });

  it('validateIdentity rejects implicit in team', () => {
    const id = serviceIdentity({ source: 'implicit-solo' });
    const err = validateIdentity(id, 'team');
    assert.ok(err);
    assert.match(err, /Implicit identity not allowed in team mode/);
  });

  it('validateIdentity approves human in team', () => {
    const id = humanIdentity({ userId: 'alice@co.com', source: 'headers' });
    const err = validateIdentity(id, 'team');
    assert.equal(err, null);
  });

  it('identityRole extracts role claim', () => {
    const id = humanIdentity({ role: 'security' });
    assert.equal(identityRole(id), 'security');
    assert.equal(identityRole(null), null);
  });

});