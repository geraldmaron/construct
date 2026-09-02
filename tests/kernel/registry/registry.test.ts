/**
 * tests/kernel/registry/registry.test.ts — versions, digests, manifests,
 * loading, cycles, the lock, and every way a resolution can fail.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { writeFileSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { satisfies, highestSatisfying, parseVersion, compareVersions } from '../../../src/kernel/registry/semver.ts';
import { bundleDigest } from '../../../src/kernel/registry/digest.ts';
import { validateSkillManifest, validateWorkflowManifest, checkFrontmatterAgreement, ManifestError } from '../../../src/kernel/registry/validation.ts';
import { createSkillRegistry } from '../../../src/kernel/registry/skill-registry.ts';
import { createWorkflowRegistry } from '../../../src/kernel/registry/workflow-registry.ts';
import { stepOrder, readySteps, DependencyCycleError } from '../../../src/kernel/registry/dependency-graph.ts';
import { lockStatus, updateLock } from '../../../src/kernel/registry/lockfile.ts';
import { resolveWorkflow, type ResolveInput } from '../../../src/kernel/registry/resolver.ts';
import { provides, type HostCapabilities } from '../../../src/kernel/registry/capability-registry.ts';
import { emptyLock, type RegistryLock } from '../../../src/kernel/project/lock.ts';
import { createGrant } from '../../../src/kernel/state/grants.ts';
import { freshStore } from '../state/support.ts';
import { tmp, writeSkill, writeWorkflow, workflowManifest, skillManifest, step } from './support.ts';

const T = '2026-09-02T12:00:00.000Z';

test('semantic versions parse, compare, and satisfy exact, caret, tilde, and bounded ranges', () => {
  assert.equal(compareVersions(parseVersion('1.2.3')!, parseVersion('1.10.0')!) < 0, true);
  assert.equal(compareVersions(parseVersion('1.0.0-alpha.1')!, parseVersion('1.0.0')!) < 0, true);
  assert.ok(satisfies('1.4.0', '^1.2.0'));
  assert.ok(!satisfies('2.0.0', '^1.2.0'));
  assert.ok(satisfies('0.4.2', '^0.4.0'));
  assert.ok(!satisfies('0.5.0', '^0.4.0'));
  assert.ok(satisfies('1.2.9', '~1.2.3'));
  assert.ok(!satisfies('1.3.0', '~1.2.3'));
  assert.ok(satisfies('1.5.0', '>=1.2.0 <2.0.0'));
  assert.ok(satisfies('9.9.9', '*'));
  assert.ok(satisfies('1.2.3', '1.2.3'));
  assert.ok(!satisfies('1.2.4', '1.2.3'));
  assert.equal(highestSatisfying(['1.0.0', '1.4.0', '2.0.0'], '^1.0.0'), '1.4.0');
  assert.equal(parseVersion('1.2'), null);
});

test('the bundle digest is order-independent and content-sensitive', () => {
  const a = { relativePath: 'SKILL.md', bytes: new TextEncoder().encode('a') };
  const b = { relativePath: 'references/x.md', bytes: new TextEncoder().encode('b') };
  const d1 = bundleDigest([a, b]);
  assert.equal(bundleDigest([b, a]), d1);
  assert.match(d1, /^sha256:[0-9a-f]{64}$/);
  assert.notEqual(bundleDigest([a, { ...b, bytes: new TextEncoder().encode('c') }]), d1);
  assert.notEqual(bundleDigest([a, { ...b, relativePath: 'references/y.md' }]), d1);
  assert.notEqual(bundleDigest([a]), d1);
});

test('manifests are closed schemas: tool names, bad tiers, bad ranges, and disagreement with frontmatter are refused', () => {
  const ok = validateSkillManifest(skillManifest('intake', '1.0.0'), 'm.json');
  assert.equal(ok.id, 'intake');
  assert.throws(() => validateSkillManifest(skillManifest('intake', 'latest'), 'm.json'), /semantic version/);
  assert.throws(() => validateSkillManifest(skillManifest('Intake', '1.0.0'), 'm.json'), /kebab-case/);
  assert.throws(() => validateSkillManifest(skillManifest('intake', '1.0.0', { capabilities: ['bash'] }), 'm.json'), /names a tool/);
  assert.throws(() => validateSkillManifest(skillManifest('intake', '1.0.0', { actionTiers: ['bypass'] }), 'm.json'), /actionTiers/);
  assert.throws(() => validateSkillManifest(skillManifest('intake', '1.0.0', { skillDependencies: [{ id: 'x', range: 'newest' }] }), 'm.json'), /version range/);
  assert.throws(() => validateSkillManifest(skillManifest('intake', '1.0.0', { observedOn: [{ host: 'claude', model: 'x', note: 'works great' }] }), 'm.json'), /claims success without naming/);
  assert.throws(() => validateSkillManifest({ ...skillManifest('intake', '1.0.0'), format: 'other' }, 'm.json'), /must carry format/);
  assert.throws(() => checkFrontmatterAgreement({ name: 'intake', version: '1.0.1', description: 'd' }, ok, 'm.json'), /disagree/);
  assert.throws(() => checkFrontmatterAgreement({ name: 'other', version: '1.0.0', description: 'd' }, ok, 'm.json'), /disagree/);
  assert.throws(() => checkFrontmatterAgreement({ name: 'intake', version: null, description: 'd' }, ok, 'm.json'), /no metadata.version/);

  const w = validateWorkflowManifest(workflowManifest('w', '1.0.0', [step('a', { outputs: ['x'] }), step('b', { needs: ['a'], inputs: { x: 'steps.a.x' } })]), 'w.json');
  assert.equal(w.steps.length, 2);
  assert.throws(() => validateWorkflowManifest(workflowManifest('w', '1.0.0', [step('a'), step('a')]), 'w.json'), /appears twice/);
  assert.throws(() => validateWorkflowManifest(workflowManifest('w', '1.0.0', [step('a', { needs: ['zz'] })]), 'w.json'), /not a step/);
  assert.throws(() => validateWorkflowManifest(workflowManifest('w', '1.0.0', [step('a', { tier: 'auto' })]), 'w.json'), /tier/);
  assert.throws(() => validateWorkflowManifest(workflowManifest('w', '1.0.0', [step('a', { inputs: { x: 'steps.b.out' } })]), 'w.json'), /no step "b"/);
  assert.throws(() => validateWorkflowManifest(workflowManifest('w', '1.0.0', [step('a', { outputs: ['x'] }), step('b', { needs: ['a'], inputs: { y: 'steps.a.nope' } })]), 'w.json'), /declares no output "nope"/);
  assert.throws(() => validateWorkflowManifest(workflowManifest('w', '1.0.0', [step('a', { outputs: ['x'] }), step('b', { inputs: { y: 'steps.a.x' } })]), 'w.json'), /without listing it in needs/);
  assert.throws(() => validateWorkflowManifest(workflowManifest('w', '1.0.0', [step('a', { inputs: { t: 'input.missing' } })]), 'w.json'), /inputSchema does not declare/);
  assert.throws(() => validateWorkflowManifest(workflowManifest('w', '1.0.0', [step('a', { loadBearing: true })]), 'w.json'), /load-bearing but names no validator/);
  assert.throws(() => validateWorkflowManifest(workflowManifest('w', '1.0.0', [step('a', { capabilities: ['bash'] })]), 'w.json'), ManifestError);
});

test('registries load built-in and project bundles, cache by digest, and never throw for one bad bundle', () => {
  const { root, cleanup } = tmp();
  try {
    writeSkill(join(root, 'builtin'), 'intake', '1.0.0');
    writeSkill(join(root, 'builtin'), 'portable', '1.0.0', { manifest: null });
    writeSkill(join(root, 'builtin'), 'broken', '1.0.0', { frontmatterVersion: '9.9.9' });
    writeSkill(join(root, 'project'), 'house-style', '0.1.0', { references: { 'shape.md': 'shape' } });
    writeSkill(join(root, 'project'), 'intake', '2.0.0');
    const skills = createSkillRegistry({ builtinDir: join(root, 'builtin'), projectDir: join(root, 'project') });
    assert.deepEqual(skills.list().map((s) => [s.manifest.id, s.origin]), [['house-style', 'project'], ['intake', 'builtin']]);
    assert.deepEqual(skills.portableOnly().map((p) => p.name), ['portable']);
    assert.equal(skills.problems().length, 2);
    assert.match(skills.problems().find((p) => p.dir.endsWith('broken'))!.message, /disagree/);
    assert.match(skills.problems().find((p) => p.dir.endsWith('project/intake'))!.message, /shadows a built-in/);
    assert.match(skills.body('intake')!, /^---\nname: intake/);
    assert.equal(new TextDecoder().decode(skills.file('house-style', 'references/shape.md')!), 'shape');
    assert.equal(skills.file('house-style', '../../etc/passwd'), null);
    assert.ok(skills.get('house-style')!.files.includes('construct.skill.json'));

    writeWorkflow(join(root, 'wf'), 'good', workflowManifest('good', '1.0.0', [step('a')]));
    writeWorkflow(join(root, 'wf'), 'bad', workflowManifest('bad', '1.0.0', [step('a', { needs: ['a'] })]));
    const workflows = createWorkflowRegistry({ builtinDir: join(root, 'wf'), projectDir: null });
    assert.deepEqual(workflows.list().map((w) => w.manifest.id), ['good']);
    assert.equal(workflows.problems().length, 1, 'a self-need is refused at load; longer cycles are the resolver’s');
    assert.throws(() => stepOrder([{ ...workflows.get('good')!.manifest.steps[0]!, needs: ['a'] }]), DependencyCycleError);
  } finally {
    cleanup();
  }
});

test('the step order is topological, cycles are named, and ready steps follow their needs', () => {
  const steps = validateWorkflowManifest(
    workflowManifest('w', '1.0.0', [step('c', { needs: ['a', 'b'] }), step('a'), step('b', { needs: ['a'] })]),
    'w.json',
  ).steps;
  assert.deepEqual(stepOrder(steps), ['a', 'b', 'c']);
  assert.deepEqual(readySteps(steps, new Set()).map((s) => s.id), ['a']);
  assert.deepEqual(readySteps(steps, new Set(['a'])).map((s) => s.id), ['b']);
  assert.deepEqual(readySteps(steps, new Set(['a', 'b'])).map((s) => s.id), ['c']);
  const cyclic = [
    { ...steps[0]!, id: 'x', needs: ['y'] },
    { ...steps[0]!, id: 'y', needs: ['z'] },
    { ...steps[0]!, id: 'z', needs: ['x'] },
  ];
  assert.throws(() => stepOrder(cyclic), (e: unknown) => e instanceof DependencyCycleError && e.cycle.join('>') === 'x>y>z>x');
});

test('the lock reports current, outdated, diverged, blocked, missing, and unlocked, and updates without touching unconfirmed project bundles', () => {
  const { root, cleanup } = tmp();
  try {
    writeSkill(join(root, 'b'), 'intake', '1.1.0');
    writeSkill(join(root, 'b'), 'voice', '1.0.0');
    writeSkill(join(root, 'p'), 'house', '0.2.0');
    writeWorkflow(join(root, 'w'), 'remember', workflowManifest('remember', '1.0.0', [step('a')]));
    const skills = createSkillRegistry({ builtinDir: join(root, 'b'), projectDir: join(root, 'p') });
    const workflows = createWorkflowRegistry({ builtinDir: join(root, 'w'), projectDir: null });
    const intake = skills.get('intake')!;
    const voice = skills.get('voice')!;
    const house = skills.get('house')!;
    const lock: RegistryLock = {
      ...emptyLock(),
      skills: {
        intake: { version: '1.0.0', digest: 'sha256:' + '0'.repeat(64), origin: 'builtin' },
        voice: { version: '1.0.0', digest: 'sha256:' + '1'.repeat(64), origin: 'builtin' },
        house: { version: '0.2.0', digest: 'sha256:' + '2'.repeat(64), origin: 'project' },
        gone: { version: '1.0.0', digest: 'sha256:' + '3'.repeat(64), origin: 'builtin' },
        future: { version: '9.0.0', digest: 'sha256:' + '4'.repeat(64), origin: 'builtin' },
      },
    };
    writeSkill(join(root, 'b'), 'future', '1.0.0');
    const skills2 = createSkillRegistry({ builtinDir: join(root, 'b'), projectDir: join(root, 'p') });
    const rows = Object.fromEntries(lockStatus(lock, skills2.list(), workflows.list()).map((r) => [`${r.kind}:${r.id}`, r.state]));
    assert.deepEqual(rows, { 'skill:future': 'blocked', 'skill:gone': 'missing', 'skill:house': 'diverged', 'skill:intake': 'outdated', 'skill:voice': 'diverged', 'workflow:remember': 'unlocked' });

    const updated = updateLock(lock, skills2.list(), workflows.list());
    assert.deepEqual([...updated.changed].sort(), ['skill:future', 'skill:intake', 'skill:voice', 'workflow:remember']);
    assert.deepEqual(updated.needsConfirmation, ['skill:house']);
    assert.deepEqual(updated.removed, ['skill:gone']);
    assert.equal(updated.lock.skills.house!.digest, 'sha256:' + '2'.repeat(64), 'the project bundle keeps its old entry');
    assert.equal(updated.lock.skills.intake!.digest, intake.digest);
    assert.equal(updated.lock.skills.voice!.digest, voice.digest);
    const confirmed = updateLock(lock, skills2.list(), workflows.list(), { confirmProjectBundles: ['house'] });
    assert.equal(confirmed.lock.skills.house!.digest, house.digest);
    assert.ok(lockStatus(confirmed.lock, skills2.list(), workflows.list()).every((r) => r.state === 'current'));
  } finally {
    cleanup();
  }
});

function host(overrides: Partial<HostCapabilities> = {}): HostCapabilities {
  return {
    hostId: 'claude',
    sessionId: 'sess-1',
    executorId: 'session:claude',
    available: new Set(['read_project_context', 'read_project_files', 'write_project_context', 'model_review', 'ask_user', 'run_validator', 'read_source:directory']),
    maxTier: 'project_write',
    restrictions: [],
    budgetCents: null,
    ...overrides,
  };
}

test('the resolver names every failure, and a runnable result carries the bound plan', () => {
  const { root, cleanup } = tmp();
  const fx = freshStore();
  try {
    writeSkill(join(root, 'b'), 'context-mapping', '0.4.0');
    writeSkill(join(root, 'b'), 'adversarial-review', '0.3.0', { manifest: skillManifest('adversarial-review', '0.3.0', { skillDependencies: [{ id: 'context-mapping', range: '^0.4.0' }], capabilities: ['model_review'] }) });
    writeSkill(join(root, 'b'), 'old', '0.1.0');
    writeSkill(join(root, 'b'), 'portable', '1.0.0', { manifest: null });
    writeWorkflow(join(root, 'w'), 'review', workflowManifest('review', '1.2.0', [
      step('gather', { skill: { id: 'context-mapping', range: '^0.4.0' }, capabilities: ['read_project_context'], sources: [{ kind: 'directory', freshness: 'fresh', required: true }], outputs: ['p'], validators: ['citations_present'], loadBearing: true }),
      step('review', { needs: ['gather'], skill: { id: 'adversarial-review', range: '^0.3.0' }, capabilities: ['model_review'], tier: 'draft', inputs: { p: 'steps.gather.p' }, outputs: ['r'], validators: ['citations_present'], loadBearing: true }),
      step('apply', { needs: ['review'], capabilities: ['write_source:jira'], tier: 'external_write', inputs: { r: 'steps.review.r' }, outputs: ['done'] }),
    ]));
    writeWorkflow(join(root, 'w'), 'broken', workflowManifest('broken', '1.0.0', [
      step('a', { skill: { id: 'missing', range: '*' }, capabilities: ['teleport'], validators: ['vibes'], tier: 'destructive' }),
      step('b', { skill: { id: 'old', range: '^1.0.0' }, capabilities: ['run_tests'] }),
      step('c', { skill: { id: 'portable', range: '*' } }),
      step('d', { tier: 'licensed_judgment' }),
    ]));
    const skills = createSkillRegistry({ builtinDir: join(root, 'b'), projectDir: null });
    const workflows = createWorkflowRegistry({ builtinDir: join(root, 'w'), projectDir: null });
    const lock = updateLock(emptyLock(), skills.list(), workflows.list()).lock;
    const base: ResolveInput = {
      workflowId: 'review', input: { target: 'feature-x' }, skills, workflows, lock, host: host({ maxTier: 'external_write', available: new Set([...host().available, 'write_source:jira']) }),
      sources: [{ kind: 'directory', id: 'repo', reachability: 'reachable', freshness: 'fresh' }], store: fx.store, at: T,
    };

    const ok = resolveWorkflow(base);
    assert.equal(ok.status, 'runnable', ok.summary);
    assert.deepEqual(ok.plan.map((p) => [p.step.id, p.skill?.version ?? null, p.needsApproval]), [['gather', '0.4.0', false], ['review', '0.3.0', false], ['apply', null, true]]);
    assert.match(ok.summary, /approval needed at apply/);
    assert.equal(ok.reasons.filter((r) => r.code === 'ungranted_consequential').length, 1);

    createGrant(fx.store, { id: 'g', actionTier: 'external_write', targetSystem: 'directory', workflowId: 'review', startsAt: T, grantedBy: 'gerald', at: T });
    const granted = resolveWorkflow({ ...base, targetSystemFor: () => 'directory' });
    assert.equal(granted.plan[2]!.needsApproval, false);

    const missingWorkflow = resolveWorkflow({ ...base, workflowId: 'nope' });
    assert.equal(missingWorkflow.status, 'blocked');
    assert.equal(missingWorkflow.reasons[0]!.code, 'missing_workflow');
    assert.match(missingWorkflow.reasons[0]!.remedy, /broken, review/);

    const version = resolveWorkflow({ ...base, versionRange: '^2.0.0' });
    assert.ok(version.reasons.some((r) => r.code === 'incompatible_version'));

    const inputs = resolveWorkflow({ ...base, input: { extra: 1, target: 5 } });
    const codes = inputs.reasons.map((r) => r.code);
    assert.ok(codes.includes('schema_mismatch'));
    const noInput = resolveWorkflow({ ...base, input: {} });
    assert.ok(noInput.reasons.some((r) => r.code === 'missing_step_input'));

    const stale = resolveWorkflow({ ...base, sources: [{ kind: 'directory', id: 'repo', reachability: 'reachable', freshness: 'stale' }] });
    assert.equal(stale.status, 'blocked');
    assert.ok(stale.reasons.some((r) => r.code === 'stale_source' && r.stepId === 'gather'));
    const unreachable = resolveWorkflow({ ...base, sources: [{ kind: 'directory', id: 'repo', reachability: 'unreachable', freshness: 'fresh' }] });
    assert.ok(unreachable.reasons.some((r) => r.code === 'unavailable_source'));
    const undeclared = resolveWorkflow({ ...base, sources: [] });
    assert.ok(undeclared.reasons.some((r) => r.code === 'unavailable_source' && /no directory source is declared/.test(r.message)));

    const noModel = resolveWorkflow({ ...base, host: host({ maxTier: 'external_write', available: new Set(['read_project_context', 'write_source:jira']) }) });
    assert.ok(noModel.reasons.some((r) => r.code === 'capability_unavailable' && r.stepId === 'review'));
    const lowTier = resolveWorkflow({ ...base, host: host({ maxTier: 'draft' }) });
    assert.ok(lowTier.reasons.some((r) => r.code === 'tier_above_executor' && r.stepId === 'apply'));

    const ambiguous = resolveWorkflow({ ...base, host: host({ maxTier: 'external_write', sessionId: null, available: new Set([...host().available, 'write_source:jira', 'run_tests']) }), executorCandidates: ['runner-a', 'runner-b'], workflowId: 'broken' });
    assert.ok(ambiguous.reasons.some((r) => r.code === 'ambiguous_executor'));

    const broken = resolveWorkflow({ ...base, workflowId: 'broken', input: { target: 'x' } });
    assert.equal(broken.status, 'blocked');
    const brokenCodes = new Set(broken.reasons.map((r) => `${r.stepId ?? '-'}:${r.code}`));
    for (const expected of ['a:missing_skill', 'a:missing_capability', 'a:missing_validator', 'a:tier_above_executor', 'b:incompatible_version', 'b:capability_unavailable', 'c:missing_skill', 'd:ungranted_consequential']) {
      assert.ok(brokenCodes.has(expected), `${expected} in ${[...brokenCodes].join(', ')}`);
    }
    assert.match(broken.reasons.find((r) => r.stepId === 'c')!.message, /without a Construct manifest/);
    assert.ok(broken.reasons.every((r) => r.remedy.length > 0));

    // Lock divergence: the workflow's content changed without a version bump.
    writeWorkflow(join(root, 'w'), 'review', workflowManifest('review', '1.2.0', [step('gather', { outputs: ['p'], validators: ['citations_present'], loadBearing: true })]));
    const workflows2 = createWorkflowRegistry({ builtinDir: join(root, 'w'), projectDir: null });
    const divergent = resolveWorkflow({ ...base, workflows: workflows2 });
    assert.equal(divergent.status, 'divergent');
    assert.ok(divergent.reasons.some((r) => r.code === 'lockfile_divergence'));

    // Outdated: a newer skill than the lock knows.
    writeSkill(join(root, 'b'), 'context-mapping', '0.4.1');
    const skills2 = createSkillRegistry({ builtinDir: join(root, 'b'), projectDir: null });
    const outdated = resolveWorkflow({ ...base, skills: skills2 });
    assert.equal(outdated.status, 'outdated');
  } finally {
    fx.cleanup();
    cleanup();
  }
});

test('host capabilities honor scope', () => {
  const h = host({ available: new Set(['read_source:jira', 'model_review']) });
  assert.ok(provides(h, 'read_source:jira'));
  assert.ok(!provides(h, 'read_source:github'));
  assert.ok(provides(host({ available: new Set(['read_source']) }), 'read_source:github'));
});

test('the shipped skills and workflows load, agree with their frontmatter, and resolve', () => {
  const skills = createSkillRegistry({ projectDir: null });
  const workflows = createWorkflowRegistry({ projectDir: null });
  assert.deepEqual(skills.problems(), []);
  assert.deepEqual(skills.portableOnly(), []);
  assert.equal(skills.list().length, 8);
  assert.deepEqual(workflows.problems(), []);
  assert.deepEqual(workflows.list().map((w) => w.manifest.id), ['design-conformance', 'remember']);
  const index = JSON.parse(readFileSync(new URL('../../../registry/index.json', import.meta.url), 'utf8'));
  for (const s of skills.list()) assert.equal(index.skills[s.manifest.id]?.digest, s.digest, `${s.manifest.id} index digest is current`);
  for (const w of workflows.list()) assert.equal(index.workflows[w.manifest.id]?.digest, w.digest, `${w.manifest.id} index digest is current`);
  const fx = freshStore();
  try {
    const lock = updateLock(emptyLock(), skills.list(), workflows.list()).lock;
    const r = resolveWorkflow({
      workflowId: 'design-conformance', input: { target: 'src/kernel/state' }, skills, workflows, lock,
      host: host({ available: new Set(['read_project_context', 'read_project_files', 'write_project_context', 'model_review', 'ask_user', 'run_validator:constitution_shape', 'run_tests']) }),
      sources: [], store: fx.store, at: T,
    });
    assert.equal(r.status, 'runnable', r.summary);
    assert.deepEqual(r.plan.map((p) => p.step.id), ['gather', 'deterministic', 'review', 'record']);
    const remember = resolveWorkflow({ workflowId: 'remember', input: { kind: 'decision', text: 'no migration before stable' }, skills, workflows, lock, host: host(), sources: [], store: fx.store, at: T });
    assert.equal(remember.status, 'runnable', remember.summary);
    void writeFileSync;
  } finally {
    fx.cleanup();
  }
});
