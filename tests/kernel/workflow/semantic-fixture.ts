/** Synthetic semantic adapter for unrelated state-machine unit tests only.
 * Never a qualification witness or production capability claim. Semantic gate
 * and host adapter tests use raw services without this helper. */
import type { WorkflowService } from '../../../src/kernel/workflow/service.ts';
import type { StateStore } from '../../../src/kernel/state/open.ts';
import { appendActivity } from '../../../src/kernel/state/activity.ts';
import { readPreparedReview } from '../../../src/kernel/workflow/semantic-review.ts';
export function syntheticSemanticAdapter(service: WorkflowService, store: StateStore, now: () => string): WorkflowService {
  const submit = service.submit.bind(service);
  return { ...service, submit(input) {
    const first = submit(input);
    if (!first.semanticReview?.preparedRef) return first;
    const p = readPreparedReview(store, first.semanticReview.preparedRef)!;
    appendActivity(store, { at: now(), kind: 'semantic.executed', runId: p.bundle.runId, stepRunId: p.bundle.stepRunId, channel: 'host_semantic', actor: 'synthetic unit-test fixture', payload: { preparedRef: p.ref, bundleDigest: p.digest, attempt: p.bundle.attempt, invocation: { id: 'synthetic-unit-test', host: 'test-fixture', hostVersion: 'test', model: 'test', sessionId: 'synthetic-isolated-session', completed: true, exitStatus: 0, timedOut: false, transcriptDigest: 'synthetic' }, judgment: { checks: p.bundle.contract.obligations.map(o => ({ id: o.id, verdict: 'pass', reason: 'Synthetic adapter response for this state-machine test; no model judgment is claimed.', refs: ['body'] })) }, problems: [] } });
    return submit(input);
  } };
}
