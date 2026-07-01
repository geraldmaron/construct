/**
 * tests/audit/f05-runtime-ownership/owned-stop.red.mjs — F05 [R16] missing ownership-record proof.
 *
 * RED fixtures (must FAIL against current code). Stop safety needs a separable ownership
 * decision: a Construct-started service records who it is (PID, command, cwd, env marker,
 * start timestamp, lock), and stop consults that record before signalling a PID. Today
 * lib/service-manager.mjs records nothing for the port-killed services (cm / OpenCode /
 * copilot bridge) — startServices() at L388-432 spawns them without writing any per-port
 * ownership marker, and no ownership predicate is exported. The absence of that predicate
 * IS the defect.
 *
 * Two contracts are asserted:
 *   1. (CX-AUDIT-RUNTIME-001/-003) service-manager exports an ownership-decision function
 *      so stop can ask "is this PID a Construct-owned port owner?" separately from killing.
 *   2. (CX-AUDIT-RUNTIME-001/-002) the ownership record schema carries the identity fields
 *      stop must check: pid, command, cwd, a Construct env/marker, and a start timestamp.
 *
 * Both fail today: the named export resolves to undefined, so the predicate cannot be
 * constructed and the schema cannot be exercised. The fixtures pass once the record and
 * predicate land and a record lacking Construct markers is judged not-owned.
 */
import assert from 'node:assert/strict';
import test from 'node:test';

import * as serviceManager from '../../../lib/service-manager.mjs';

// Post-fix the predicate may ship under any of these names; the fixture accepts the first
// that exists so it does not over-constrain the eventual implementation's naming.

const OWNERSHIP_PREDICATE_NAMES = [
  'isConstructOwnedPort',
  'verifyPortOwnership',
  'isConstructOwnedProcess',
  'classifyPortOwner',
];

function resolveOwnershipPredicate() {
  for (const name of OWNERSHIP_PREDICATE_NAMES) {
    if (typeof serviceManager[name] === 'function') return serviceManager[name];
  }
  return null;
}

test('[R16] service-manager exposes a separable ownership-decision function for stop', () => {
  const predicate = resolveOwnershipPredicate();
  assert.ok(
    predicate,
    `no ownership-decision function is exported (tried ${OWNERSHIP_PREDICATE_NAMES.join(', ')}); `
      + 'stop kills by raw port ownership with no identity gate. exports='
      + JSON.stringify(Object.keys(serviceManager)),
  );
});

test('[R16] a port owner lacking Construct markers is judged NOT owned', () => {
  const predicate = resolveOwnershipPredicate();
  assert.ok(predicate, 'ownership predicate must exist before its decision can be checked');

  const foreignOwner = {
    pid: 999_000_002,
    command: '/usr/bin/python3 -m http.server 7070',
    cwd: '/some/other/project',
    startedAt: Date.now(),
  };
  const decision = predicate(foreignOwner, { port: 7070 });
  const owned = typeof decision === 'object' && decision !== null ? decision.owned : decision;
  assert.equal(
    owned,
    false,
    `a foreign port owner without Construct markers was judged owned (would be killed). decision=${JSON.stringify(decision)}`,
  );
});

test('[R16] a Construct-recorded owner carries the identity fields stop must verify', () => {
  const predicate = resolveOwnershipPredicate();
  assert.ok(predicate, 'ownership predicate must exist before a Construct record can be judged owned');

  const constructOwner = {
    pid: process.pid,
    command: 'cm serve --port 7070',
    cwd: process.cwd(),
    marker: 'construct',
    constructManaged: true,
    startedAt: Date.now(),
  };
  const decision = predicate(constructOwner, { port: 7070 });
  const owned = typeof decision === 'object' && decision !== null ? decision.owned : decision;
  assert.equal(
    owned,
    true,
    `a Construct-recorded owner with identity markers was not judged owned. decision=${JSON.stringify(decision)}`,
  );
});
