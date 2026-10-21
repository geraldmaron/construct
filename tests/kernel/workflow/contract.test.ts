/**
 * tests/kernel/workflow/contract.test.ts — every shipped step's declared
 * outputs and typed validator fields satisfy the validators bound to it, so following the instructions
 * is enough to pass.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createWorkflowRegistry } from '../../../src/kernel/registry/workflow-registry.ts';
import { createSkillRegistry } from '../../../src/kernel/registry/skill-registry.ts';
import { satisfies } from '../../../src/kernel/registry/semver.ts';
import { runValidators } from '../../../src/kernel/workflow/validators.ts';
import type { RefResolver } from '../../../src/kernel/project/evidence.ts';

/** Every cited file exists and Construct opened it; decisions are submitted as typed fields. */
const DESIGN = '# Design\n\nThe design under review.\n';
const resolve: RefResolver = (ref) =>
  ref.startsWith('deliverable:')
    ? { ref, kind: 'deliverable', provenance: 'witnessed' }
    : { ref, kind: 'file', provenance: 'witnessed', path: ref, text: DESIGN, size: DESIGN.length };

const LIST_KEYS = new Set([
  'assumptions',
  'blockers',
  'findings',
  'changes',
  'escalations',
  'unknowns',
  'recordedIds',
  'decisionIds',
  'questionIds',
  'driftFindingIds',
  'lessonIds',
  'recordedFindingIds',
  'principles',
  'contradictions',
  'controls',
  'proposals',
  'questions',
  'claims',
  'conflicts',
  'derivations',
  'setAside',
  'superseded',
]);

function stub(keys: readonly string[]): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const k of keys) {
    if (LIST_KEYS.has(k)) out[k] = [];
    else if (k === 'decision') out[k] = { ask: 'Approve the design', decider: 'Leadership', by: '2026-10-15' };
    else if (k === 'verification') out[k] = { result: 'Inspected declared outputs against the cited design record.' };
    else if (k === 'passed' || k === 'noDrift') out[k] = true;
    else if (k === 'artifact') out[k] = 'docs/design.md';
    else if (k === 'location') out[k] = 'https://example.com/published';
    else if (k === 'revises') out[k] = 'deliverable:d-1';
    else out[k] = 'ok';
  }
  return out;
}

test('submitting every shipped step’s declared outputs with its typed validator fields passes', () => {
  const workflows = createWorkflowRegistry({ projectDir: null });
  // Two independent places, so a step that asks for more than one source can be satisfied by declared outputs alone.
  const evidence = [{ ref: 'docs/design.md' }, { ref: 'notes/review.md' }];
  const refs = new Set(['docs/design.md', 'notes/review.md']);
  const misses: string[] = [];
  for (const w of workflows.list()) {
    for (const step of w.manifest.steps) {
      // Manifests are migrating separately; supply the typed fields each bound validator reads as well as every declared output.
      const fields = [
        ...step.outputs,
        ...(step.validators.includes('decision_ask_present') ? ['decision'] : []),
        ...(step.validators.includes('settled_not_contradicted') ? ['setAside'] : []),
        ...(step.validators.includes('superseded_acknowledged') ? ['superseded'] : []),
      ];
      const output = stub(fields);
      const results = runValidators(step.validators, { output, expectedKeys: step.outputs, evidence, resolvableRefs: refs, resolve });
      for (const r of results) {
        if (!r.ok) misses.push(`${w.manifest.id}.${step.id} ${r.validator}: ${r.problems.join('; ')}`);
      }
    }
  }
  assert.equal(misses.length, 0, misses.join('\n'));
});

test('every shipped step names a skill range the shipped skill satisfies', () => {
  const workflows = createWorkflowRegistry({ projectDir: null });
  const skills = createSkillRegistry({ projectDir: null });
  const misses: string[] = [];
  for (const w of workflows.list()) {
    for (const step of w.manifest.steps) {
      if (!step.skill) continue;
      const shipped = skills.get(step.skill.id);
      if (!shipped) misses.push(`${w.manifest.id}.${step.id}: no shipped skill ${step.skill.id}`);
      else if (!satisfies(shipped.manifest.version, step.skill.range))
        misses.push(`${w.manifest.id}.${step.id}: ${step.skill.id} ${shipped.manifest.version} is outside ${step.skill.range}`);
    }
  }
  assert.deepEqual(misses, []);
});

// These exercise the real built-in plans and service state machine. Only the
// independent model transport is synthetic; no live qualification is claimed.
import { brokerFixture, observedVerification } from '../broker/support.ts';
import { createWorkflowService } from '../../../src/kernel/workflow/service.ts';
import { syntheticSemanticAdapter } from './semantic-fixture.ts';
import { projectResolver } from '../../../src/kernel/source/resolver.ts';
import { BUILTIN_CAPABILITIES } from '../../../src/kernel/registry/capability-registry.ts';
import { updateLock } from '../../../src/kernel/registry/lockfile.ts';
import { emptyLock } from '../../../src/kernel/project/lock.ts';
import { createGrant } from '../../../src/kernel/state/grants.ts';
import { createRun } from '../../../src/kernel/state/runs.ts';
import { upsertDraft } from '../../../src/kernel/state/deliverables.ts';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const builtins = createWorkflowRegistry({ projectDir: null });
const cases = builtins
  .list()
  .flatMap<{ id: string; domain: string | undefined }>((w) =>
    w.manifest.domains
      ? Object.keys(w.manifest.domains).map((domain) => ({ id: w.manifest.id, domain }))
      : [{ id: w.manifest.id, domain: undefined }],
  );
for (const { id, domain } of cases) {
  test(`${id}${domain ? ` / ${domain}` : ''} starts and completes its shipped plan`, async () => {
    const fx = brokerFixture();
    try {
      writeFileSync(join(fx.box.cwd, 'docs/design.md'), DESIGN);
      writeFileSync(join(fx.box.cwd, 'docs/other.md'), `${DESIGN}\nA separate local source documents the operational boundary.\n`);
      const now = fx.ctx.now;
      const store = fx.broker.store;
      const skills = fx.broker.skills;
      let n = 0;
      const host = {
        ...fx.broker.host,
        available: new Set([...BUILTIN_CAPABILITIES.map((c) => c.name), 'write_source:docs']),
        maxTier: 'external_write' as const,
      };
      const service = syntheticSemanticAdapter(
        createWorkflowService({
          store,
          skills,
          workflows: builtins,
          host,
          lock: updateLock(emptyLock(), skills.list(), builtins.list()).lock,
          now,
          nextId: (prefix) => `${prefix}-lifecycle-${++n}`,
          sources: () => [{ id: 'docs', kind: 'docs', freshness: 'fresh', reachability: 'reachable' }],
          projectWritePolicy: 'managed',
          resolveEvidence: (ref, use, pin) => projectResolver(store, fx.box.cwd)(ref, use, pin),
          targetSystemFor: () => 'project',
        }),
        store,
        now,
      );
      // A real prior deliverable, so revision and publication inputs resolve.
      createRun(store, {
        id: 'prior-run',
        workflowId: 'guided-outcome',
        workflowVersion: '1.0.0',
        interactionClass: 'manage',
        triggerKind: 'manual',
        idempotencyKey: 'prior',
        executorKind: 'interactive',
        executorId: host.executorId,
        input: {},
        at: now(),
      });
      upsertDraft(store, { id: 'd-1', runId: 'prior-run', kind: 'document/prd', body: { summary: DESIGN }, at: now() });
      createGrant(store, {
        id: 'publish-fixture',
        actionTier: 'external_write',
        targetSystem: 'project',
        startsAt: now(),
        grantedBy: 'fixture person',
        at: now(),
      });
      const m = builtins.get(id, domain)!.manifest;
      const values: Record<string, unknown> = {
        domain,
        request: 'Assess the design against the stated decision and preserve unknowns.',
        question: 'What does the design establish?',
        target: 'docs/design.md',
        deliverable: 'deliverable:d-1',
        deliverableId: 'd-1',
        change: 'Clarify the decision',
        destination: 'https://example.com/review',
        audience: 'Leadership',
      };
      const input = Object.fromEntries(m.requiredInputs.map((key) => [key, values[key]]));
      if (domain) input.domain = domain;
      const started = service.start({ workflowId: id, input, trigger: 'manual' });
      assert.equal(started.preflight.status, 'runnable', JSON.stringify(started.preflight));
      assert.equal(started.run.workflowId, id);
      if (domain) assert.equal((started.run.input as Record<string, unknown>).domain, domain);
      const visited: string[] = [];
      for (let i = 0; i < m.steps.length + 1; i++) {
        if (service.status(started.run.id)!.run.state === 'succeeded') break;
        const claimed = service.claimNext({ runId: started.run.id });
        assert.ok(claimed.packet, JSON.stringify(claimed));
        const packet = claimed.packet;
        visited.push(packet.step.id);
        const output = stub([...packet.step.outputs, ...(packet.step.validators.includes('decision_ask_present') ? ['decision'] : [])]);
        if (packet.step.validators.includes('verification_result') || packet.step.capabilities.includes('run_tests'))
          output.verification = await observedVerification(fx, { stepRunId: packet.leased.id, token: packet.leased.nonce });
        const submitted = service.submit({
          leased: packet.leased,
          output,
          evidence: [{ ref: 'docs/design.md' }, { ref: 'docs/other.md' }],
        });
        assert.equal(submitted.step.state, 'succeeded', JSON.stringify(submitted));
      }
      assert.equal(service.status(started.run.id)!.run.state, 'succeeded');
      assert.ok(visited.length > 0);
    } finally {
      fx.cleanup();
    }
  });
}
