import { run } from '../../../src/cli/index.ts';
import { capture } from '../../cli/support.ts';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
/** Portable public surfaces, real local persistence, and negative authority controls. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { openStateStore } from '../../../src/kernel/state/open.ts';
import { addStatement } from '../../../src/kernel/state/profile.ts';
import { getRun } from '../../../src/kernel/state/runs.ts';
import { projectResolver } from '../../../src/kernel/source/resolver.ts';
import { updateSource } from '../../../src/kernel/state/sources.ts';
import { TOOLS, toolsFor } from '../../../src/kernel/broker/tools.ts';
import { record } from '../../../src/kernel/broker/definition.ts';
import { searchContext } from '../../../src/kernel/context/retrieval.ts';
import { brokerFixture, type BrokerFixture } from './support.ts';
const call = async (f: BrokerFixture, name: string, args: Record<string, unknown>) => {
  const t = TOOLS.find((t) => t.name === name)!;
  return (await t.run(f.broker, t.validate(record(args)))) as any;
};
async function source(f: BrokerFixture, text: string) {
  if (!f.broker.sources.list().some((s) => s.id === 'handbook'))
    await call(f, 'sources', { action: 'declare', id: 'handbook', kind: 'docs', locator: 'confluence:space:OPS' });
  return call(f, 'sources', { action: 'report', id: 'handbook', items: [{ ref: 'policy', text, updatedAt: '2026-09-01T00:00:00.000Z' }] });
}
test('ranked retrieval uses host concept expansion, exact citations and bounded context without authority promotion', async () => {
  const f = brokerFixture();
  try {
    addStatement(f.broker.store, {
      id: 'st-retention',
      kind: 'constraint',
      text: 'Audit records are retained indefinitely.',
      provenance: 'discovery',
      at: f.ctx.now(),
    });
    const r = await call(f, 'context_search', {
      query: 'How long do we keep compliance evidence?',
      expansions: ['audit records retention'],
      limit: 2,
      budgetChars: 1000,
    });
    assert.ok(r.items.some((i: any) => i.ref === 'statement:st-retention'));
    assert.equal(r.items.find((i: any) => i.ref === 'statement:st-retention').status, 'proposed');
    assert.equal(r.items[0].content.trust, 'data');
    assert.ok(r.coverage.usedChars <= 1000);
    assert.match(r.items[0].reasons.join(' '), /host expansion/);
    assert.equal((await call(f, 'context_search', { query: 'nonexistentquasarpolicy' })).items.length, 0);
  } finally {
    f.cleanup();
  }
});
test('captured citations retain old bytes after unchanged-timestamp corrections and revoked sources stay inaccessible', async () => {
  const f = brokerFixture();
  try {
    await source(f, 'The project permits exporting personal email addresses.');
    const old = (await call(f, 'context_search', { query: 'exporting', sourceId: 'handbook' })).items[0];
    assert.match(old.ref, /^snapshot:/);
    assert.equal(old.provenance, 'reported');
    await source(f, 'The project prohibits exporting personal email addresses.');
    const resolve = projectResolver(f.broker.store, f.box.cwd);
    assert.match(resolve(old.ref)!.text!, /permits/);
    assert.equal(resolve(old.ref)!.historical, true);
    const fresh = (await call(f, 'context_search', { query: 'exporting', sourceId: 'handbook' })).items[0];
    assert.notEqual(fresh.ref, old.ref);
    assert.match(resolve(fresh.ref)!.text!, /prohibits/);
    updateSource(f.broker.store, 'handbook', { canRead: false }, f.ctx.now());
    assert.equal(resolve(old.ref), null);
    assert.equal((await call(f, 'context_search', { query: 'exporting', sourceId: 'handbook' })).items.length, 0);
  } finally {
    f.cleanup();
  }
});
test('optional embeddings require explicit identity and admitted bytes; stale and mixed vectors are refused', async () => {
  const f = brokerFixture();
  try {
    await source(f, 'Audit records must remain available indefinitely.');
    const d = (await call(f, 'context_search', { query: 'audit', sourceId: 'handbook' })).items[0];
    const items = [{ ref: d.embeddingRef, digest: d.digest, vector: [1, 0, 0] }];
    await assert.rejects(call(f, 'context_index', { action: 'put_vectors', model: 'local-fixture', dimensions: 3, items }), /configure/);
    await call(f, 'context_index', { action: 'configure', model: 'local-fixture', dimensions: 3 });
    await call(f, 'context_index', { action: 'put_vectors', model: 'local-fixture', dimensions: 3, items });
    const r = await call(f, 'context_search', {
      query: 'durability',
      sourceId: 'handbook',
      embedding: { model: 'local-fixture', dimensions: 3, vector: [1, 0, 0] },
    });
    assert.equal(r.mode, 'hybrid');
    assert.equal(r.items[0].ref, d.ref);
    assert.equal(r.items[0].provenance, 'reported');
    await assert.rejects(
      call(f, 'context_search', { query: 'audit', embedding: { model: 'other', dimensions: 3, vector: [1, 0, 0] } }),
      /identity/,
    );
    await assert.rejects(
      call(f, 'context_index', {
        action: 'put_vectors',
        model: 'local-fixture',
        dimensions: 3,
        items: [{ ...items[0], digest: 'invented' }],
      }),
      /admitted content/,
    );
    await source(f, 'Audit records now expire after a retention review.');
    await call(f, 'context_search', { query: 'audit' });
    assert.equal((await call(f, 'context_index', { action: 'status' })).vectors, 0);
    await call(f, 'context_index', { action: 'disable' });
    assert.equal((await call(f, 'context_search', { query: 'audit' })).mode, 'text_and_relationships');
  } finally {
    f.cleanup();
  }
});
test('a read-only reopened store searches actual persisted context and does not build persistent tables', async () => {
  const f = brokerFixture();
  try {
    addStatement(f.broker.store, {
      id: 'st-checkpoint',
      kind: 'note',
      text: 'Preserve the first useful draft.',
      provenance: 'discovery',
      at: f.ctx.now(),
    });
    const ro = openStateStore(f.broker.store.path, { readOnly: true });
    try {
      const r = searchContext(ro, { query: 'useful draft' }, f.ctx.now());
      assert.equal(r.items[0]?.ref, 'statement:st-checkpoint');
    } finally {
      ro.close();
    }
  } finally {
    f.cleanup();
  }
});
test('typed interpretation chooses each execution path while preserving lightweight questions and explicit workflows', async () => {
  const f = brokerFixture();
  try {
    for (const [path, id] of [
      ['artifact', 'guided-outcome'],
      ['decision', 'decision-support'],
      ['implementation', 'managed-outcome'],
      ['research', 'research-brief'],
      ['review', 'architecture-decision-review'],
    ] as const) {
      const r = await call(f, 'classify_request', {
        kind: 'manage',
        words: 'Please produce this outcome.',
        deliverable: { kind: 'other', describe: 'requested outcome' },
        intent: {
          outcome: 'Produce the requested result',
          path,
          acceptance: ['Useful grounded result'],
          priorWork: ['statement:existing'],
        },
      });
      assert.equal(r.matches[0]?.workflowId, id);
      assert.equal(r.intake.intent.path, path);
    }
    const a = await call(f, 'classify_request', { kind: 'answer', words: 'What does Construct do?' });
    assert.deepEqual(a.matches, []);
    await assert.rejects(
      call(f, 'classify_request', {
        kind: 'manage',
        words: 'Produce a result',
        deliverable: { kind: 'other', describe: 'a result' },
        intent: { path: 'persona', outcome: 'result' },
      }),
      (e: any) => e.field === 'intent.path',
    );
  } finally {
    f.cleanup();
  }
});
test('portable chat delivery completes without file or test capabilities and labels semantic assurance honestly', async () => {
  const f = brokerFixture('interactive', { semanticReview: 'none' });
  try {
    const available = new Set([...f.broker.host.available].filter((c) => !['write_project_files', 'run_tests'].includes(c)));
    // The shared resolver sees capability absence, rather than a tool mock.
    (f.broker.host as { available: ReadonlySet<string> }).available = available;
    const intake = {
      kind: 'manage',
      words: 'Explain the architecture constraints with evidence.',
      deliverable: { kind: 'other', describe: 'architecture brief' },
      destination: { kind: 'chat' },
      intent: {
        path: 'artifact',
        outcome: 'A grounded brief',
        acceptance: ['Identify the host-neutral boundary'],
        constraints: ['Use held project evidence'],
        assumptions: [],
        priorWork: ['docs/design.md'],
      },
    };
    const started = await call(f, 'start_outcome', { workflowId: 'guided-outcome', intake });
    assert.equal(started.started, true);
    const claim = () => call(f, 'claim_work', { runId: started.run.id }).then((r) => r.work);
    const submit = (w: any, output: any) =>
      call(f, 'submit_work', { stepRunId: w.stepRunId, token: w.token, output, evidence: [{ ref: 'docs/design.md' }] });
    let w = await claim();
    assert.ok(w);
    await submit(w, { plan: ['Use the project design'], assumptions: [], blockers: [] });
    w = await claim();
    const note = await call(f, 'remember', { kind: 'note', text: 'A stored note is not a produced file.' });
    await assert.rejects(
      call(f, 'checkpoint_work', {
        stepRunId: w.stepRunId,
        token: w.token,
        summary: 'Incorrect artifact alias',
        artifact: `statement:${note.remembered.id}`,
      }),
      /existing readable artifact/,
    );
    const cp = await call(f, 'checkpoint_work', {
      stepRunId: w.stepRunId,
      token: w.token,
      summary: 'The kernel is host-agnostic.',
      unknowns: [],
      remaining: ['Inspect the final brief'],
      gatherCalls: 12,
    });
    assert.equal(cp.assurance, 'partial_unverified');
    assert.equal(cp.gathering.exhausted, true);
    await submit(w, { summary: 'The kernel is host-agnostic.', findings: ['Keep the kernel host-agnostic.'], changes: [], artifact: null });
    w = await claim();
    const done = await submit(w, {
      verification: { kind: 'self_review', checks: ['Read the actual brief against the requested boundary'] },
      limits: ['No independent semantic review'],
    });
    assert.equal(done.run.state, 'succeeded', JSON.stringify(done));
    assert.equal(done.deliverable.verification.semanticSupportVerified, false);
    const status = await call(f, 'run_status', { runId: started.run.id });
    assert.equal(status.delivery.state, 'available');
    assert.equal(status.delivery.acceptance, 'not_accepted');
    assert.equal(status.checkpoints.length, 1);
    assert.equal((getRun(f.broker.store, started.run.id)!.bindings as any).asked.intake.intent.outcome, 'A grounded brief');
    assert.equal((getRun(f.broker.store, started.run.id)!.bindings as any).execution.path, 'artifact');
    await assert.rejects(call(f, 'checkpoint_work', { stepRunId: w.stepRunId, token: w.token, summary: 'spoof completion' }), /lease/);
  } finally {
    f.cleanup();
  }
});
test('a real directory refresh admits bounded witnessed text and records unsupported files', async () => {
  const f = brokerFixture();
  try {
    writeFileSync(join(f.box.cwd, 'docs', 'binary.pdf'), Buffer.from([0, 1, 2, 3]));
    writeFileSync(join(f.box.cwd, 'docs', 'auth.json'), JSON.stringify({ password: 'synthetic-credential-do-not-retain' }));
    const declared = await capture(() =>
      run(
        ['source', 'add', 'local-docs', '--kind=directory', `--locator=${join(f.box.cwd, 'docs')}`, '--purpose=project documentation'],
        f.ctx,
      ),
    );
    assert.equal(declared.code, 0, declared.err);
    await call(f, 'sources', { action: 'refresh', id: 'local-docs' });
    const r = await call(f, 'context_search', {
      query: 'host neutral architecture',
      expansions: ['kernel host agnostic'],
      sourceId: 'local-docs',
    });
    assert.equal(r.items[0].provenance, 'witnessed');
    assert.match(projectResolver(f.broker.store, f.box.cwd)(r.items[0].ref)!.text!, /host-agnostic/);
    assert.ok(r.coverage.gaps.some((g: string) => g.includes('binary.pdf') && g.includes('text unavailable')));
    assert.ok(r.coverage.gaps.some((g: string) => g.includes('auth.json') && g.includes('text unavailable')));
    assert.equal(
      (await call(f, 'context_search', { query: 'synthetic-credential-do-not-retain', sourceId: 'local-docs' })).items.length,
      0,
    );
  } finally {
    f.cleanup();
  }
});
test('retrieval configuration is absent from headless surface', () => {
  const names = toolsFor('headless').map((t) => t.name);
  assert.ok(!names.includes('context_index'));
  assert.ok(!names.includes('context_search'));
  assert.ok(names.includes('checkpoint_work'));
});

test('frozen retrieval questions recover evidence within their budget and leave absent answers absent', async (t) => {
  const fixture = JSON.parse(readFileSync(new URL('../../fixtures/context-retrieval/corpus.json', import.meta.url), 'utf8')) as {
    items: { ref: string; text: string }[];
    queries: { query: string; expansions: string[]; expected: string | null }[];
  };
  const f = brokerFixture();
  try {
    await call(f, 'sources', { action: 'declare', id: 'knowledge', kind: 'docs' });
    await call(f, 'sources', { action: 'report', id: 'knowledge', items: fixture.items });
    const resolve = projectResolver(f.broker.store, f.box.cwd);
    let found = 0,
      total = 0,
      irrelevant = 0;
    const started = performance.now();
    for (const c of fixture.queries) {
      const r = await call(f, 'context_search', {
        query: c.query,
        expansions: c.expansions,
        sourceId: 'knowledge',
        limit: 3,
        budgetChars: 1000,
      });
      assert.ok(r.coverage.usedChars <= 1000);
      assert.equal(r.coverage.usedChars, JSON.stringify(r.items).length);
      assert.ok(r.items.every((i: any) => i.content.trust === 'data'));
      if (c.expected) {
        total++;
        assert.ok(
          r.items.some((i: any) => resolve(i.ref)?.itemRef === c.expected),
          c.query,
        );
        found++;
        irrelevant += r.items.filter((i: any) => resolve(i.ref)?.itemRef !== c.expected).length;
      } else assert.deepEqual(r.items, []);
    }
    t.diagnostic(
      JSON.stringify({
        retrievalFixture: {
          expectedEvidenceFound: found,
          expectedQuestions: total,
          extraReturnedPassages: irrelevant,
          elapsedMs: Math.round(performance.now() - started),
          hostCalls: 0,
          expansionSource: 'fixed reports; native inference unqualified',
        },
      }),
    );
  } finally {
    f.cleanup();
  }
});

test('a recovered remembered decision carries actual text into citation and quote checks', async () => {
  const f = brokerFixture();
  try {
    const remembered = await call(f, 'remember', { kind: 'decision', text: 'We retain audit records for 30 days.' });
    const ref = `statement:${remembered.remembered.id}`;
    const context = await call(f, 'context_search', { query: 'audit retention' });
    assert.ok(context.items.some((i: any) => i.ref === ref));
    const checked = await call(f, 'check_answer', {
      answer: 'The recorded decision says 30 days.',
      citations: [{ ref, excerpt: '30 days' }],
    });
    assert.equal(checked.ok, true, JSON.stringify(checked.problems));
    const invented = await call(f, 'check_answer', {
      answer: 'The recorded decision says 60 days.',
      citations: [{ ref, excerpt: '60 days' }],
    });
    assert.equal(invented.ok, false);
  } finally {
    f.cleanup();
  }
});
