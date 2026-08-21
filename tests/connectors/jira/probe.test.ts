/**
 * tests/connectors/jira/probe.test.ts — the pin's own instrument, run against
 * the responses the pin was written from.
 *
 * What this can prove: every expectation the pin declares is either checked
 * by the probe or named as one the probe deliberately does not check, and the
 * checks pass against the shapes Atlassian's published description says Jira
 * sends. What it cannot prove, and what nothing hermetic can: that Jira still
 * sends them. Only the same function pointed at a live site settles that, and
 * it has not been pointed at one.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  CONFORMANCE_EXPECTATIONS,
  UNPROBED_EXPECTATIONS,
} from '../../../src/connectors/jira/pin.ts';
import {
  probeJiraConformance,
  uncheckedExpectations,
  undeclaredGaps,
} from '../../../src/connectors/jira/probe.ts';
import { PROJECT, UNAUTHORIZED, probeTransport, recordingTransport } from './fixtures.ts';

test('every pinned expectation holds against the shapes the pin was written from', async () => {
  const results = await probeJiraConformance(probeTransport().transport, { project: PROJECT });
  const broken = results.filter((r) => r.outcome !== 'held');
  assert.deepEqual(
    broken.map((r) => `${r.id}: ${r.detail}`),
    [],
  );
});

test('an expectation the probe never checks is either declared unprobed or a gap', () => {
  const declaredButMissing = UNPROBED_EXPECTATIONS.filter(
    (id) => !CONFORMANCE_EXPECTATIONS.some((e) => e.id === id),
  );
  assert.deepEqual(declaredButMissing, [], 'nothing is declared unprobed that the pin does not declare');
});

test('the unchecked expectations are exactly the ones declared unprobed', async () => {
  const results = await probeJiraConformance(probeTransport().transport, { project: PROJECT });
  assert.deepEqual(undeclaredGaps(results), [], 'no expectation is quietly unchecked');
  assert.deepEqual([...uncheckedExpectations(results)].sort(), [...UNPROBED_EXPECTATIONS].sort());
});

test('a site that answers nothing reports unknown, which is never a pass', async () => {
  const dead = recordingTransport(() => {
    throw new Error('getaddrinfo ENOTFOUND acme.atlassian.net');
  });
  const results = await probeJiraConformance(dead.transport, { project: PROJECT });
  assert.ok(results.length > 0);
  assert.ok(
    results.every((r) => r.outcome === 'unknown'),
    'a probe that could not ask has measured nothing, and says so',
  );
});

test('a credential Jira refuses is a broken expectation, not an unknown one', async () => {
  const refused = recordingTransport(() => UNAUTHORIZED);
  const results = await probeJiraConformance(refused.transport, { project: PROJECT });
  const auth = results.find((r) => r.id === 'auth-basic-email-and-api-token');
  assert.equal(auth?.outcome, 'broken');
  assert.match(auth!.detail, /401/);
});
