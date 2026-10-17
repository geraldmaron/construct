import { observeSemanticReview } from '../../../src/hosts/semantic-observation.ts';
import { executeSemanticReview } from '../../../src/hosts/semantic-review.ts';
import { executeVerification } from '../../../src/hosts/verification.ts';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { brokerFixture } from '../broker/support.ts';
import { getRun } from '../../../src/kernel/state/runs.ts';
import { appendActivity } from '../../../src/kernel/state/activity.ts';
import { projectResolver } from '../../../src/kernel/source/resolver.ts';
import { currentManifestRecord, snapshotItemRef } from '../../../src/kernel/source/manifest.ts';
import { addSource, getSource, setAuthority } from '../../../src/kernel/state/sources.ts';
import {
  assertReviewInputCapacity,
  semanticReviewPrompt,
  REVIEW_BUNDLE_MAX_BYTES,
  canonicalReview,
  reviewDigest,
  semanticContract,
  prepareSemanticReview,
  readPreparedReview,
  semanticReviewProblems,
  semanticJudgmentProblems,
  reviewFreshnessProblems,
  type PreparedReview,
} from '../../../src/kernel/workflow/semantic-review.ts';

function fixture() {
  const fx = brokerFixture(),
    store = fx.broker.store;
  const started = fx.broker.workflow.start({
    workflowId: 'managed-outcome',
    input: { request: 'Recommend a design based on project evidence' },
    trigger: 'manual',
  });
  const contract = semanticContract({ words: 'Recommend a design based on project evidence', actionScope: 'assessment only' });
  store.db
    .prepare('UPDATE workflow_runs SET bindings_json = ? WHERE id = ?')
    .run(JSON.stringify({ ...(started.run.bindings as object), semanticContract: contract }), started.run.id);
  const run = getRun(store, started.run.id)!,
    leased = fx.broker.workflow.claimNext({ runId: run.id }).packet!.leased;
  writeFileSync(join(fx.box.cwd, 'brief.md'), 'Keep the kernel host-agnostic.');
  const resolve = (ref: string) => projectResolver(store, fx.box.cwd)(ref);
  const prepare = (body = { summary: 'Keep the kernel host-agnostic.', artifact: 'brief.md' }) =>
    prepareSemanticReview(store, {
      run: getRun(store, run.id)!,
      leased,
      body,
      evidence: [{ ref: 'docs/design.md' }],
      resolve,
      at: fx.ctx.now(),
    });
  const judgment = (p: PreparedReview) => ({
    checks: p.bundle.contract.obligations.map((o) => ({
      id: o.id,
      verdict: 'pass' as const,
      reason: 'Synthetic contract-test judgment, not native qualification evidence.',
      refs: ['body', 'docs/design.md'],
    })),
  });
  const observe = (p: PreparedReview, patch: object = {}, channel = 'host_semantic') =>
    appendActivity(store, {
      at: fx.ctx.now(),
      kind: 'semantic.executed',
      runId: run.id,
      stepRunId: leased.id,
      channel,
      payload: {
        preparedRef: p.ref,
        bundleDigest: p.digest,
        attempt: leased.token,
        invocation: {
          id: 'synthetic-invocation',
          host: 'codex',
          hostVersion: 'test',
          model: 'test',
          sessionId: 'synthetic-independent-session',
          completed: true,
          exitStatus: 0,
          timedOut: false,
          transcriptDigest: 'test',
        },
        judgment: judgment(p),
        problems: [],
        ...patch,
      },
    });
  return { ...fx, store, run, leased, prepare, resolve, judgment, observe };
}

test('semantic review needs a real adapter channel, exact coverage and current generation; producer assertions and command receipts cannot supply it', () => {
  const f = fixture();
  try {
    const p = f.prepare();
    assert.equal(f.prepare().ref, p.ref, 'identical preparation is idempotent');
    assert.deepEqual(readPreparedReview(f.store, p.ref), p);
    assert.match(semanticReviewProblems(f.store, p, f.resolve).join(), /No adapter-observed/);
    f.observe(p, {}, 'relay');
    appendActivity(f.store, {
      at: f.ctx.now(),
      kind: 'verification.executed',
      runId: f.run.id,
      stepRunId: f.leased.id,
      channel: 'host_command',
      payload: { semanticSupportVerified: true, checks: f.judgment(p).checks },
    });
    assert.match(semanticReviewProblems(f.store, p, f.resolve).join(), /No adapter-observed/);
    f.observe(p);
    assert.deepEqual(semanticReviewProblems(f.store, p, f.resolve), []);
    f.observe(p, { attempt: f.leased.token + 1 });
    assert.match(semanticReviewProblems(f.store, p, f.resolve).join(), /observed independent invocation/);
    f.observe(p);
    writeFileSync(join(f.box.cwd, 'brief.md'), 'Move model execution into the kernel.');
    assert.match(semanticReviewProblems(f.store, p, f.resolve).join(), /brief.md: review content/);
    const changed = f.prepare();
    assert.notEqual(changed.digest, p.digest);
    assert.match(semanticReviewProblems(f.store, changed, f.resolve).join(), /No adapter-observed/);
  } finally {
    f.cleanup();
  }
});

test('every frozen obligation requires an explicit supported judgment; empty findings or overall pass cannot replace coverage', () => {
  const f = fixture();
  try {
    const p = f.prepare(),
      good = f.judgment(p);
    assert.deepEqual(semanticJudgmentProblems(p.bundle, good), []);
    for (const value of [
      { passed: true, findings: [] },
      { checks: [] },
      { checks: good.checks.slice(1) },
      { checks: [...good.checks, good.checks[0]] },
      { checks: good.checks.map((c, i) => (i ? c : { ...c, verdict: 'unknown' })) },
      { checks: good.checks.map((c, i) => (i ? c : { ...c, refs: ['invented-source'] })) },
      { checks: good.checks.map((c, i) => (i ? c : { ...c, reason: '' })) },
    ])
      assert.ok(semanticJudgmentProblems(p.bundle, value).length);
    assert.match(p.bundle.contract.obligations.find((o) => o.id === 'reasoning')!.criterion, /need not include optional subtraction/);
  } finally {
    f.cleanup();
  }
});

test('source bytes, authority, provenance, access and final body invalidate the previous review independently of provider timestamps', () => {
  const f = fixture();
  try {
    addSource(f.store, {
      id: 'design',
      kind: 'directory',
      purpose: 'design',
      locator: join(f.box.cwd, 'docs'),
      authorityLevel: 'informative',
      sensitivity: 'internal',
      canRead: true,
      canWrite: false,
      at: f.ctx.now(),
    });
    const p = f.prepare();
    f.observe(p);
    assert.deepEqual(semanticReviewProblems(f.store, p, f.resolve), []);
    setAuthority(f.store, 'design', 'architecture', true);
    assert.match(reviewFreshnessProblems(f.store, p, f.resolve).join(), /authority/);
    const authorized = f.prepare();
    f.observe(authorized);
    writeFileSync(join(f.box.cwd, 'docs/design.md'), 'Move execution into the kernel.');
    assert.match(reviewFreshnessProblems(f.store, authorized, f.resolve).join(), /content/);
    const changed = f.prepare({ summary: 'A new conclusion in the final body.', artifact: 'brief.md' });
    assert.notEqual(changed.digest, authorized.digest);
    assert.match(semanticReviewProblems(f.store, changed, f.resolve).join(), /No adapter-observed/);
  } finally {
    f.cleanup();
  }
});

test('missing, partial and oversized held representations cannot silently pass review', () => {
  const f = fixture();
  try {
    const prepare = (resolve: typeof f.resolve) =>
      prepareSemanticReview(f.store, {
        run: f.run,
        leased: f.leased,
        body: { artifact: 'brief.md' },
        evidence: [{ ref: 'docs/design.md' }],
        resolve,
        at: f.ctx.now(),
      });
    const partial = prepare((ref) => {
      const r = f.resolve(ref);
      return r ? { ...r, truncated: true } : null;
    });
    f.observe(partial);
    assert.match(semanticReviewProblems(f.store, partial, f.resolve).join(), /complete held text/);
    assert.throws(
      () => prepare((ref) => ({ ref, kind: 'file', provenance: 'witnessed', text: 'x'.repeat(REVIEW_BUNDLE_MAX_BYTES + 1) })),
      /2 MiB/,
    );
    assert.equal(readPreparedReview(f.store, 'review:999999'), null);
  } finally {
    f.cleanup();
  }
});

test('the shared held-text review contract accepts a qualified host-tool identity and refuses self-review', () => {
  const f = fixture();
  try {
    const identity = {
      host: 'fixture-host-tool',
      version: '1.0.0',
      profile: 'held-text-v1',
      digest: 'fixture-profile',
      isolation: 'held_text' as const,
    };
    const bindings = {
      ...(getRun(f.store, f.run.id)!.bindings as object),
      semanticContract: semanticContract({ request: 'Assess the design' }, identity),
    };
    f.store.db.prepare('UPDATE workflow_runs SET bindings_json=? WHERE id=?').run(JSON.stringify(bindings), f.run.id);
    const p = f.prepare();
    const witness = {
      preparedRef: p.ref,
      bundleDigest: p.digest,
      attempt: f.leased.token,
      isolation: 'held_text' as const,
      invocation: {
        id: 'fixture-invocation',
        host: identity.host,
        hostVersion: identity.version,
        model: 'fixture',
        sessionId: 'fixture-independent-review',
        completed: true,
        exitStatus: 0,
        timedOut: false,
        transcriptDigest: 'fixture-transcript',
      },
      judgment: f.judgment(p),
      problems: [],
    };
    const unbound = observeSemanticReview({
      store: f.store,
      witness,
      token: f.leased.nonce,
      resolve: f.resolve,
      at: f.ctx.now(),
      actor: 'fixture trusted adapter',
    });
    assert.equal(unbound.passed, false);
    assert.match(unbound.receipt.problems.join(), /bound adapter dispatch/);
    appendActivity(f.store, {
      at: f.ctx.now(),
      kind: 'semantic.dispatched',
      runId: f.run.id,
      stepRunId: f.leased.id,
      channel: 'host_semantic',
      actor: 'fixture trusted adapter',
      payload: { id: witness.invocation.id, preparedRef: p.ref, profile: identity.profile, profileDigest: identity.digest },
    });
    const positive = observeSemanticReview({
      store: f.store,
      witness,
      token: f.leased.nonce,
      resolve: f.resolve,
      at: f.ctx.now(),
      actor: 'fixture trusted adapter',
    });
    assert.equal(positive.passed, true);
    assert.deepEqual(semanticReviewProblems(f.store, p, f.resolve), []);
    const rejected = observeSemanticReview({
      store: f.store,
      witness: { ...witness, isolation: 'self_review' },
      token: f.leased.nonce,
      resolve: f.resolve,
      at: f.ctx.now(),
      actor: 'fixture trusted adapter',
    });
    assert.equal(rejected.passed, false);
    assert.match(semanticReviewProblems(f.store, p, f.resolve).join(), /same-session|Same-session|isolation/);
  } finally {
    f.cleanup();
  }
});

test('large complete packets preserve final evidence and count canonical UTF-8 metadata at the boundary', () => {
  const f = fixture();
  try {
    const prepare = (padding: string) =>
      prepareSemanticReview(f.store, {
        run: f.run,
        leased: f.leased,
        body: { artifact: 'brief.md', padding },
        evidence: [{ ref: 'docs/design.md' }],
        resolve: f.resolve,
        at: f.ctx.now(),
      });
    const large = prepare('x'.repeat(750_000) + 'FINAL_PACKET_SENTINEL');
    assert.ok(JSON.stringify(readPreparedReview(f.store, large.ref)).includes('FINAL_PACKET_SENTINEL'));
    const base = prepare('');
    const baseBytes = Buffer.byteLength(canonicalReview(base.bundle));
    const padding = 'x'.repeat(REVIEW_BUNDLE_MAX_BYTES - baseBytes);
    const boundary = prepare(padding);
    assert.equal(Buffer.byteLength(canonicalReview(boundary.bundle)), REVIEW_BUNDLE_MAX_BYTES);
    const count = () =>
      (f.store.db.prepare("SELECT count(*) n FROM activity_events WHERE kind='semantic.prepared'").get() as { n: number }).n;
    const before = count();
    assert.throws(() => prepare(padding + 'x'), /limit|exceeds/);
    assert.throws(() => prepare(padding.slice(0, -1) + 'é'), /limit|exceeds/);
    assert.equal(count(), before, 'oversized preparation leaves no packet event');
    assert.deepEqual(reviewFreshnessProblems(f.store, large, f.resolve), []);
    writeFileSync(join(f.box.cwd, 'brief.md'), 'Changed literal final artifact.');
    assert.ok(reviewFreshnessProblems(f.store, large, f.resolve).length);
  } finally {
    f.cleanup();
  }
});

test('review holds the actual generation-bound command receipt and invalidates changed observations', async () => {
  const f = fixture();
  try {
    const result = await executeVerification({
      store: f.store,
      runId: f.run.id,
      stepRunId: f.leased.id,
      token: f.leased.nonce,
      argv: [process.execPath, '-e', "process.stdout.write('observed gate fixture')"],
      subjects: ['brief.md'],
      root: f.box.cwd,
      env: f.ctx.env,
      resolve: f.resolve,
      now: f.ctx.now,
    });
    const body = {
      summary: 'Bounded verification fixture.',
      artifact: 'brief.md',
      verification: { executionRef: result.executionRef, command: result.command, exitStatus: result.exitStatus },
    };
    const prepared = prepareSemanticReview(f.store, {
      run: getRun(f.store, f.run.id)!,
      leased: f.leased,
      body,
      evidence: [{ ref: 'docs/design.md' }],
      resolve: f.resolve,
      at: f.ctx.now(),
    });
    assert.deepEqual(prepared.bundle.execution, { ref: result.executionRef, receipt: result.receipt });
    assert.deepEqual(reviewFreshnessProblems(f.store, prepared, f.resolve), []);
    const judgment = {
      checks: prepared.bundle.contract.obligations.map((o) => ({
        id: o.id,
        verdict: 'pass',
        reason: 'Synthetic shape control only.',
        refs: [result.executionRef],
      })),
    };
    assert.deepEqual(semanticJudgmentProblems(prepared.bundle, judgment), []);
    const id = Number(result.executionRef.split(':')[1]);
    assert.throws(
      () =>
        f.store.db
          .prepare('UPDATE activity_events SET payload_json=? WHERE id=?')
          .run(JSON.stringify({ ...result.receipt, attempt: result.receipt.attempt + 1 }), id),
      /append-only/,
    );
    writeFileSync(join(f.box.cwd, 'brief.md'), 'The artifact changed after the command ran.');
    assert.match(reviewFreshnessProblems(f.store, prepared, f.resolve).join(), /observed verification receipt changed/);
    const invalid = prepareSemanticReview(f.store, {
      run: getRun(f.store, f.run.id)!,
      leased: f.leased,
      body,
      evidence: [],
      resolve: f.resolve,
      at: f.ctx.now(),
    });
    assert.equal(invalid.bundle.execution, undefined, 'a stale receipt cannot be held as an observed gate');
    assert.match(invalid.bundle.problems.join(), /stale/);
    const foreign = prepareSemanticReview(f.store, {
      run: getRun(f.store, f.run.id)!,
      leased: f.leased,
      body: { ...body, verification: { executionRef: 'execution:999999' } },
      evidence: [],
      resolve: f.resolve,
      at: f.ctx.now(),
    });
    assert.equal(foreign.bundle.execution, undefined, 'a producer cannot invent receipt contents');
    assert.match(foreign.bundle.problems.join(), /No observed execution receipt/);
  } finally {
    f.cleanup();
  }
});

test('frozen transport budgets count the complete prompt in Unicode scalars independently of bytes', () => {
  const f = fixture();
  try {
    const current = getRun(f.store, f.run.id)!;
    const contract = semanticContract(
      { request: 'Assess the design' },
      {
        host: 'codex',
        digest: 'fixture',
        version: 'fixture',
        profile: 'codex-held-text-v1',
        inputLimit: { unit: 'unicode_scalars', maximum: 1048576 },
      },
    );
    f.store.db
      .prepare('UPDATE workflow_runs SET bindings_json=? WHERE id=?')
      .run(JSON.stringify({ ...(current.bindings as object), semanticContract: contract }), current.id);
    const base = f.prepare({ summary: '', artifact: 'brief.md' });
    const baseCharacters = [...semanticReviewPrompt(base.bundle)].length;
    const text = 'x'.repeat(1048576 - baseCharacters);
    const boundary = f.prepare({ summary: text, artifact: 'brief.md' });
    assert.equal([...semanticReviewPrompt(boundary.bundle)].length, 1048576);
    assert.doesNotThrow(() => assertReviewInputCapacity(boundary.bundle));
    const count = () =>
      (f.store.db.prepare("SELECT count(*) n FROM activity_events WHERE kind='semantic.prepared'").get() as { n: number }).n;
    const before = count();
    assert.throws(() => f.prepare({ summary: text + 'x', artifact: 'brief.md' }), /transport requires.*frozen reviewer accepts/);
    assert.equal(count(), before);
    const unicode = f.prepare({ summary: '😀', artifact: 'brief.md' });
    const scalars = [...semanticReviewPrompt(unicode.bundle)].length;
    assert.doesNotThrow(() => assertReviewInputCapacity(unicode.bundle, { unit: 'unicode_scalars', maximum: scalars }));
    assert.throws(() => assertReviewInputCapacity(unicode.bundle, { unit: 'unicode_scalars', maximum: scalars - 1 }), /transport requires/);
  } finally {
    f.cleanup();
  }
});

test('legacy full-text source states remain fresh until their actual source content or authority changes', () => {
  for (const change of ['text', 'authority']) {
    const f = fixture();
    try {
      addSource(f.store, {
        id: 'tracker',
        kind: 'other',
        purpose: 'release evidence',
        authorityLevel: 'informative',
        sensitivity: 'internal',
        canRead: true,
        canWrite: false,
        at: f.ctx.now(),
      });
      const report = (text: string) =>
        f.broker.sources.reportRead('tracker', { items: [{ ref: 'APP-1', text, updatedAt: '2026-09-02T11:00:00Z' }] }, f.ctx.now(), () =>
          f.ctx.nextId('review-compat'),
        );
      report('The original release decision is provisional.');
      const current = prepareSemanticReview(f.store, {
        run: f.run,
        leased: f.leased,
        body: { artifact: 'brief.md' },
        evidence: [{ ref: 'tracker:APP-1' }],
        resolve: f.resolve,
        at: f.ctx.now(),
      });
      const bundle = {
        ...current.bundle,
        sourceState: (current.bundle.sourceState as { id: string }[]).map((source) => ({
          ...source,
          manifest: currentManifestRecord(f.store, source.id),
        })),
      };
      delete (bundle as Record<string, unknown>).sourceStateFormat;
      const digest = reviewDigest(bundle);
      const event = appendActivity(f.store, {
        at: f.ctx.now(),
        kind: 'semantic.prepared',
        channel: 'kernel',
        runId: f.run.id,
        stepRunId: f.leased.id,
        payload: { digest, bundle },
      });
      const legacy = readPreparedReview(f.store, `review:${event.id}`)!;
      assert.ok(legacy, 'an unchanged legacy packet remains readable');
      assert.deepEqual(reviewFreshnessProblems(f.store, legacy, f.resolve), []);
      const held = new Map(legacy.bundle.evidence.map((item) => [item.ref, item.content]));
      if (change === 'text') report('The original release decision is now blocked.');
      else setAuthority(f.store, 'tracker', 'release readiness', true);
      assert.match(
        reviewFreshnessProblems(f.store, legacy, (ref, use) =>
          use === 'artifact' ? f.resolve(ref) : (held.get(ref) ?? f.resolve(ref)),
        ).join(),
        /source generation, authority or access changed/,
      );
    } finally {
      f.cleanup();
    }
  }
});

test('persisted packets with an unknown source-state representation or oversized canonical body cannot be read or dispatched', async () => {
  const f = fixture();
  try {
    const prepared = f.prepare();
    for (const bundle of [
      { ...prepared.bundle, canonicalization: 'unsupported-future-format' },
      { ...prepared.bundle, sourceStateFormat: 'unsupported-future-format' },
      { ...prepared.bundle, body: { padding: 'x'.repeat(REVIEW_BUNDLE_MAX_BYTES) } },
    ]) {
      const event = appendActivity(f.store, {
        at: f.ctx.now(),
        kind: 'semantic.prepared',
        channel: 'kernel',
        runId: f.run.id,
        stepRunId: f.leased.id,
        payload: { bundle, digest: reviewDigest(bundle) },
      });
      assert.equal(readPreparedReview(f.store, `review:${event.id}`), null);
      await assert.rejects(
        executeSemanticReview({
          store: f.store,
          runId: f.run.id,
          stepRunId: f.leased.id,
          token: f.leased.nonce,
          preparedRef: `review:${event.id}`,
          host: 'codex',
          model: 'fixture-no-invocation',
          env: f.ctx.env,
          root: f.box.cwd,
          resolve: f.resolve,
          now: f.ctx.now,
        }),
        /prepared candidate/,
      );
    }
    assert.equal(
      (f.store.db.prepare("SELECT count(*) n FROM activity_events WHERE kind='semantic.dispatched'").get() as { n: number }).n,
      0,
    );
  } finally {
    f.cleanup();
  }
});

test('partial evidence needs explicit valid generation-matched limits and never supplies semantic assurance by itself', () => {
  const f = fixture();
  try {
    addSource(f.store, {
      id: 'tracker',
      kind: 'other',
      purpose: 'release evidence',
      authorityLevel: 'informative',
      sensitivity: 'internal',
      canRead: true,
      canWrite: false,
      at: f.ctx.now(),
    });
    const url = 'https://jira.example/browse/APP-1';
    const report = (text: string) =>
      f.broker.sources.reportRead(
        'tracker',
        { items: [{ ref: 'APP-1', text, truncated: true, url, updatedAt: '2026-09-02T11:00:00Z' }] },
        f.ctx.now(),
        () => f.ctx.nextId('review-partial'),
      );
    report('The release decision is provisional; the full discussion was not read.');
    const prepare = (extra: Record<string, unknown>, refs = ['tracker:APP-1'], resolve = f.resolve) =>
      prepareSemanticReview(f.store, {
        run: f.run,
        leased: f.leased,
        body: { artifact: 'brief.md', ...extra },
        evidence: refs.map((ref) => ({ ref })),
        resolve,
        at: f.ctx.now(),
      });
    for (const referenceDispositions of [undefined, [], { ref: 'tracker:APP-1' }, [{ ref: 'tracker:APP-1', status: 'read', why: '' }]]) {
      assert.match(prepare({ referenceDispositions }).bundle.problems.join(), /complete held text is unavailable/);
    }
    const disposition = {
      ref: url,
      status: 'budget',
      why: 'The unread remainder is outside the captured passage; the decision remains provisional.',
    };
    const bounded = prepare({ referenceDispositions: [disposition] });
    assert.deepEqual(bounded.bundle.problems, []);
    assert.equal(bounded.bundle.evidence[0]!.content!.truncated, true);
    assert.equal(bounded.bundle.evidenceLimitations?.[0]?.disposition.why, disposition.why);
    assert.match(semanticReviewProblems(f.store, bounded, f.resolve).join(), /No adapter-observed/);
    const incompleteArtifact = prepare({ referenceDispositions: [disposition] }, undefined, (ref) => {
      const hit = f.resolve(ref);
      return ref === 'brief.md' && hit ? { ...hit, truncated: true } : hit;
    });
    assert.match(incompleteArtifact.bundle.problems.join(), /brief.md: complete held text is unavailable/);
    const snapshot = snapshotItemRef(getSource(f.store, 'tracker')!.lastSnapshotId!, 'APP-1');
    report('The release decision is blocked; the new discussion was not read.');
    const oldOnly = prepare({ referenceDispositions: [{ ...disposition, ref: snapshot }] }, [snapshot]);
    assert.ok(oldOnly.bundle.evidenceLimitations?.some((limit) => limit.ref === snapshot));
    assert.match(oldOnly.bundle.problems.join(), /tracker:APP-1: complete held text is unavailable/);
    const currentOnly = prepare({ referenceDispositions: [{ ...disposition, ref: 'tracker:APP-1' }] }, [snapshot]);
    assert.match(currentOnly.bundle.problems.join(), /snapshot:.*complete held text is unavailable/);
    const both = prepare(
      {
        referenceDispositions: [
          { ...disposition, ref: snapshot },
          { ...disposition, ref: 'tracker:APP-1' },
        ],
      },
      [snapshot],
    );
    assert.deepEqual(both.bundle.problems, []);
    assert.equal(both.bundle.evidenceLimitations?.length, 2);
  } finally {
    f.cleanup();
  }
});

test('inherited unread dispositions bind immutable snapshots and cannot exempt a mutable current item', () => {
  for (const immutable of [true, false]) {
    const f = fixture();
    try {
      addSource(f.store, {
        id: 'tracker',
        kind: 'other',
        purpose: 'release evidence',
        authorityLevel: 'informative',
        sensitivity: 'internal',
        canRead: true,
        canWrite: false,
        at: f.ctx.now(),
      });
      f.broker.sources.reportRead(
        'tracker',
        { items: [{ ref: 'APP-1', text: 'The captured passage is provisional.', truncated: true }] },
        f.ctx.now(),
        () => f.ctx.nextId('review-inherited'),
      );
      const ref = immutable ? snapshotItemRef(getSource(f.store, 'tracker')!.lastSnapshotId!, 'APP-1') : 'tracker:APP-1';
      const referenceDispositions = [
        { ref, status: 'budget', why: 'Only this version of the passage is captured; its unread remainder remains unknown.' },
      ];
      const prior = f.broker.workflow.submit({
        leased: f.leased,
        output: { plan: 'Assess the bounded captured passage.', assumptions: [], blockers: [], referenceDispositions },
        evidence: [{ ref }],
      });
      assert.equal(prior.step.state, 'succeeded');
      const leased = f.broker.workflow.claimNext({ runId: f.run.id }).packet!.leased;
      const prepared = prepareSemanticReview(f.store, {
        run: f.run,
        leased,
        body: { artifact: 'brief.md' },
        evidence: [{ ref }],
        resolve: f.resolve,
        at: f.ctx.now(),
      });
      if (immutable) assert.ok(prepared.bundle.evidenceLimitations?.some((limit) => limit.ref === ref && limit.reportedIn === f.leased.id));
      else assert.match(prepared.bundle.problems.join(), /complete held text is unavailable/);
      // The current source-closure item is another generation representation;
      // the inherited immutable limitation cannot silently exempt that item.
      assert.match(prepared.bundle.problems.join(), /tracker:APP-1: complete held text is unavailable/);
    } finally {
      f.cleanup();
    }
  }
});
