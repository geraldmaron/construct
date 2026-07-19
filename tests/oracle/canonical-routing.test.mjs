import assert from 'node:assert/strict';
import test from 'node:test';

import { buildRoutingArtifact } from '../../lib/oracle/dispatch.mjs';
import { resolveRemediationDispatch } from '../../lib/oracle/remediation-dispatch.mjs';
import { routeAction, routeGap, signOffMetadata } from '../../lib/oracle/routing.mjs';

test('gap routes expose canonical Worker Profile and Policy fields', () => {
  const route = routeGap({ id: 'parity-drift' });
  assert.deepEqual(route, {
    workerProfileId: 'engineer',
    fallbackWorkerProfileId: 'operations',
    policyId: 'agents-routing',
  });
  for (const retired of ['primary', 'secondary', 'gateType']) {
    assert.equal(retired in route, false);
  }
});

test('action routes and sign-off metadata name Policy and Worker Profile records', () => {
  assert.deepEqual(routeAction('worker-profile-review'), {
    workerProfileId: 'reviewer',
    policyId: 'agents-routing',
  });
  assert.deepEqual(signOffMetadata({ id: 'impact-untested' }, '/workspace'), {
    policyId: 'quality-gate-approval',
    approverWorkerProfileId: 'qa',
    artifactPath: '.construct/oracle/verdicts/',
    projectDir: '/workspace',
  });
});

test('remediation dispatch expresses execution as Assignments', () => {
  const dispatch = resolveRemediationDispatch({ id: 'parity-drift' });
  assert.deepEqual(dispatch, {
    mode: 'parallel',
    assignments: [
      { id: 'assignment-1', workerProfileId: 'engineer', primary: true },
      { id: 'assignment-2', workerProfileId: 'operations', primary: false },
    ],
  });
  for (const retired of ['specialists', 'teamRouting', 'primary']) {
    assert.equal(retired in dispatch, false);
  }
});

test('routing artifact contains no retired organization execution fields', () => {
  const route = {
    ...routeGap({ id: 'parity-drift' }),
    ...resolveRemediationDispatch({ id: 'parity-drift' }),
  };
  const content = buildRoutingArtifact({
    tickId: 'tick-1',
    synthesis: {
      verdict: 'degraded',
      gaps: [{ id: 'parity-drift', severity: 'high', detail: 'adapter drift', remediationRoute: route }],
      recommendedActions: [],
    },
    readModel: null,
    route,
  });
  assert.match(content, /WORKER PROFILE: engineer/);
  assert.match(content, /POLICY: agents-routing/);
  assert.match(content, /ASSIGNMENTS: assignment-1=engineer, assignment-2=operations/);
  assert.doesNotMatch(content, /SWARM SPECIALISTS|INVOLVED TEAMS|DISPATCH TARGET/);
});
