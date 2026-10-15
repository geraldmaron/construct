import { test } from 'node:test';
import assert from 'node:assert/strict';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { brokerFixture, type BrokerFixture } from '../broker/support.ts';
import { TOOLS } from '../../../src/kernel/broker/tools.ts';
import { record } from '../../../src/kernel/broker/definition.ts';
import { getRun } from '../../../src/kernel/state/runs.ts';
import { projectResolver } from '../../../src/kernel/source/resolver.ts';
import { currentManifest } from '../../../src/kernel/source/manifest.ts';
import { canonicalReview, prepareSemanticReview, readPreparedReview, reviewFreshnessProblems, semanticContract } from '../../../src/kernel/workflow/semantic-review.ts';

async function call(fx: BrokerFixture, args: Record<string, unknown>) {
  const tool = TOOLS.find(t => t.name === 'sources')!;
  return tool.run(fx.broker, tool.validate(record(args)));
}

/** Synthetic workload sizes exercise capacity; they are not usage telemetry. */
function passage(label: string, length: number) {
  const text = `${label}: The release decision remains provisional. Verify the dependency owner and acceptance evidence before deployment. Café discussion records uncertainty.\n`;
  return text.repeat(Math.ceil(length / text.length)).slice(0, length);
}

test('a mixed Jira, Slack and document review holds every item once, including uncited source closure', async () => {
  const fx = brokerFixture('interactive', { semanticReview: 'none' });
  try {
    const workloads = [
      { id: 'tracker', kind: 'jira', count: 80, length: 3000 },
      { id: 'chat', kind: 'other', count: 240, length: 1000 },
      { id: 'wiki', kind: 'docs', count: 8, length: 10000 },
    ];
    const expected = new Map<string, string>();
    for (const workload of workloads) {
      await call(fx, { action: 'declare', id: workload.id, kind: workload.kind });
      const items = Array.from({ length: workload.count }, (_, i) => {
        const ref = workload.id === 'tracker' ? `APP-${i + 1}` : workload.id === 'chat' ? `C123:${1729000000 + i}.000100` : `decision-${i + 1}`;
        const text = passage(`${workload.id} item ${i + 1}`, workload.length);
        expected.set(`${workload.id}:${ref}`, text);
        return { ref, text, updatedAt: '2026-09-02T11:00:00Z', schema: { language: 'en', scope: 'release decision' } };
      });
      await call(fx, { action: 'report', id: workload.id, items });
      assert.equal(currentManifest(fx.broker.store, workload.id)?.length, workload.count);
    }
    writeFileSync(join(fx.box.cwd, 'brief.md'), 'Keep the release decision provisional until the dependencies are verified.');
    const started = fx.broker.workflow.start({ workflowId: 'managed-outcome', input: { request: 'Review the release decision across Jira, Slack and decision documents.' }, trigger: 'manual' });
    const contract = semanticContract({ request: 'Review the release decision across Jira, Slack and decision documents.' });
    fx.broker.store.db.prepare('UPDATE workflow_runs SET bindings_json = ? WHERE id = ?').run(JSON.stringify({ ...(started.run.bindings as object), semanticContract: contract }), started.run.id);
    const run = getRun(fx.broker.store, started.run.id)!;
    const leased = fx.broker.workflow.claimNext({ runId: run.id }).packet!.leased;
    const resolve = projectResolver(fx.broker.store, fx.box.cwd);
    // Cite only one item per source: preparation must still admit the full closure.
    const evidence = ['tracker:APP-1', 'chat:C123:1729000000.000100', 'wiki:decision-1'].map(ref => ({ ref }));
    const prepared = prepareSemanticReview(fx.broker.store, { run, leased, body: { artifact: 'brief.md', summary: 'The decision remains provisional.' }, evidence, resolve, at: fx.ctx.now() });
    assert.equal(prepared.bundle.evidence.length, expected.size);
    for (const item of prepared.bundle.evidence) {
      assert.equal(item.content?.text, expected.get(item.ref), item.ref);
      assert.equal(item.content?.truncated, undefined, item.ref);
    }
    const counts = new Map<string, number>();
    const expectedText = new Set(expected.values());
    function visit(value: unknown) {
      if (typeof value === 'string' && expectedText.has(value)) counts.set(value, (counts.get(value) ?? 0) + 1);
      else if (value && typeof value === 'object') for (const child of Object.values(value)) visit(child);
    }
    visit(prepared.bundle);
    assert.equal(counts.size, expected.size);
    assert.ok([...counts.values()].every(count => count === 1), 'manifest bookkeeping must not duplicate complete provider text');
    assert.deepEqual(readPreparedReview(fx.broker.store, prepared.ref), prepared);
    assert.deepEqual(reviewFreshnessProblems(fx.broker.store, prepared, resolve), []);
    assert.ok(Buffer.byteLength(canonicalReview(prepared.bundle)) > 512 * 1024, 'exercise a realistically sized packet above the former bound');
    // Preserve the resolved held bytes while changing source text: source-state
    // identity must independently notice content changes in uncited final items.
    const held = new Map(prepared.bundle.evidence.map(item => [item.ref, item.content]));
    const final = currentManifest(fx.broker.store, 'chat')!.at(-1)!;
    await call(fx, { action: 'report', id: 'chat', partial: true, items: [{ ref: final.ref, text: `${final.text}\nThe final dependency is still blocked.`, updatedAt: final.updatedAt }] });
    const stale = reviewFreshnessProblems(fx.broker.store, prepared, (ref, use) => use === 'artifact' ? resolve(ref, use) : held.get(ref) ?? resolve(ref, use));
    assert.match(stale.join(), /source generation, authority or access changed/);
  } finally { fx.cleanup(); }
});
