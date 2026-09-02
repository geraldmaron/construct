/**
 * kernel/broker/tools.ts — every tool Construct offers a host, declared once.
 *
 * Interactive tools serve the person's own session. Headless tools serve an
 * explicitly configured runner and are limited to pre-resolved steps,
 * leases, output, and status; nothing on that surface can change project
 * configuration, grant itself anything, resolve a decision, or finalize its
 * own output. Descriptions speak plainly; plumbing stays out of them.
 */

import { listStatements, getProfile, missingProfileFields } from '../state/profile.ts';
import { listActiveRuns, listRuns } from '../state/runs.ts';
import { listOpenDecisions } from '../state/decisions.ts';
import { listStaffMembers, getStaffMember } from '../state/staff.ts';
import { listEntities, listClaims, listRelations } from '../state/graph.ts';
import { listDriftFindings } from '../state/drift.ts';
import { getStep } from '../state/steps.ts';
import { lockStatus } from '../registry/lockfile.ts';
import { emptyLock } from '../project/lock.ts';
import { constitutionCompleteness } from '../project/constitution.ts';
import { TIER_POLICIES } from '../policy/lattice.ts';
import { STATEMENT_KINDS, type StatementKind } from '../state/profile.ts';
import { TRUST_STATES, type TrustState } from '../state/deliverables.ts';
import type { BrokerContext } from './context.ts';
import { bool, closed, list, num, obj, record, str, type ToolDefinition } from './definition.ts';

type Tool<I, O> = ToolDefinition<BrokerContext, I, O>;

function define<I, O>(t: Tool<I, O>): Tool<I, O> {
  return t;
}

const bootstrap = define<Record<string, never>, unknown>({
  name: 'bootstrap',
  title: 'Where things stand',
  description: 'Call once at the start of a session. Returns the project binding, how complete its setup is, the questions still open, source and registry health, what this session may do, open decisions and active runs, and the recommended next action. Small on purpose; ask for details with project_context.',
  surface: 'both',
  readOnly: true,
  inputSchema: { type: 'object', properties: {}, additionalProperties: false },
  validate(raw) {
    closed(raw, this.inputSchema);
    return {} as Record<string, never>;
  },
  run(ctx) {
    const at = ctx.now();
    const profile = getProfile(ctx.store);
    const open = listOpenDecisions(ctx.store);
    const onboarding = open.filter((d) => d.kind === 'clarification' && d.subject && typeof d.subject === 'object' && 'onboarding' in (d.subject as object));
    const runs = listActiveRuns(ctx.store);
    const sources = ctx.sources.summary(at);
    const lock = lockStatus(ctx.files.lock ?? emptyLock(), ctx.skills.list(), ctx.workflows.list());
    const skew = lock.filter((r) => r.state !== 'current');
    const drift = listDriftFindings(ctx.store, { status: 'open' });
    const missing = missingProfileFields(profile);
    const next =
      onboarding.length > 0 ? `answer the ${String(onboarding.length)} setup question(s) with decide`
      : open.length > 0 ? `${String(open.length)} decision(s) wait on the person; show them with inbox`
      : runs.length > 0 ? `${String(runs.length)} run(s) active; continue with claim_work`
      : 'listen: answer questions plainly, remember what the person asks to keep, start an outcome when asked for work';
    return {
      construct: { version: ctx.version, project: { root: ctx.root, id: ctx.files.config?.id ?? null, name: ctx.files.config?.name ?? null } },
      session: { host: ctx.host.hostId, session: ctx.host.sessionId, executor: ctx.host.executorId, actor: ctx.actor },
      profile: { onboarding: profile?.onboardingState ?? 'incomplete', missing, openQuestions: onboarding.map((d) => ({ id: d.id, question: d.question, options: d.options })) },
      sources,
      registry: { skills: ctx.skills.list().length, workflows: ctx.workflows.list().length, locked: lock.filter((r) => r.state === 'current').length, skew: skew.map((r) => `${r.kind} ${r.id} ${r.state}`) },
      capabilities: { available: [...ctx.host.available].sort(), maxTier: ctx.host.maxTier, restrictions: ctx.host.restrictions, budgetCents: ctx.host.budgetCents },
      tiers: Object.values(TIER_POLICIES).map((p) => ({ tier: p.tier, requirement: p.requirement })),
      decisions: { open: open.length },
      runs: runs.map((r) => ({ id: r.id, workflow: r.workflowId, state: r.state })),
      drift: { open: drift.length },
      next,
    };
  },
});

const TOPICS = ['summary', 'constitution', 'sources', 'decisions', 'runs', 'entities', 'claims', 'relations', 'drift', 'statements'] as const;

const projectContext = define<{ topic: (typeof TOPICS)[number]; query?: string; limit: number }, unknown>({
  name: 'project_context',
  title: 'Project context',
  description: 'Targeted reads of what Construct knows: the constitution, sources, decisions, runs, entities, claims, relations, drift findings, or remembered statements. Ask for one topic at a time; pass a query to narrow. Never returns everything at once.',
  surface: 'interactive',
  readOnly: true,
  inputSchema: {
    type: 'object',
    properties: {
      topic: { type: 'string', description: 'What to read.', enum: TOPICS },
      query: { type: 'string', description: 'A word or id to narrow by.' },
      limit: { type: 'number', description: 'At most this many items (default 50).' },
    },
    required: ['topic'],
    additionalProperties: false,
  },
  validate(raw) {
    closed(raw, this.inputSchema);
    return { topic: str(raw, 'topic', { oneOf: TOPICS }) as (typeof TOPICS)[number], query: str(raw, 'query', { optional: true }), limit: Math.max(1, Math.min(num(raw, 'limit') ?? 50, 200)) };
  },
  run(ctx, { topic, query, limit }) {
    const q = query?.toLowerCase();
    const filter = <T,>(items: readonly T[], text: (t: T) => string): T[] => (q ? items.filter((i) => text(i).toLowerCase().includes(q)) : [...items]).slice(0, limit);
    switch (topic) {
      case 'summary': {
        const c = ctx.files.constitution;
        return { constitution: c ? { ...c, completeness: constitutionCompleteness(c) } : null, sources: ctx.sources.summary(ctx.now()), openDecisions: listOpenDecisions(ctx.store).length, activeRuns: listActiveRuns(ctx.store).length };
      }
      case 'constitution':
        return ctx.files.constitution;
      case 'sources':
        return filter(ctx.sources.list(), (s) => `${s.id} ${s.kind} ${s.purpose}`).map((s) => ctx.sources.status(s.id, ctx.now()));
      case 'decisions':
        return filter(listOpenDecisions(ctx.store), (d) => `${d.id} ${d.question}`);
      case 'runs':
        return filter(listRuns(ctx.store, { limit: 200 }), (r) => `${r.id} ${r.workflowId} ${r.state}`);
      case 'entities':
        return filter(listEntities(ctx.store, { limit: 500 }), (e) => `${e.id} ${e.kind} ${e.name}`);
      case 'claims':
        return filter(listClaims(ctx.store), (c) => `${c.id} ${c.claimType} ${c.statement}`);
      case 'relations':
        return filter(listRelations(ctx.store), (r) => `${r.id} ${r.kind} ${r.fromId} ${r.toId}`);
      case 'drift':
        return filter(listDriftFindings(ctx.store), (f) => `${f.id} ${f.kind} ${f.summary}`);
      case 'statements':
        return filter(listStatements(ctx.store), (s) => `${s.kind} ${s.text}`);
      default:
        return null;
    }
  },
});

const remember = define<{ kind: StatementKind; text: string }, unknown>({
  name: 'remember',
  title: 'Remember one thing',
  description: 'Record one decision, constraint, principle, note, or outcome in the person’s own words, when they ask to remember or record it. Creates exactly one record and nothing else: no run, no tasks, no staff.',
  surface: 'interactive',
  readOnly: false,
  inputSchema: {
    type: 'object',
    properties: {
      kind: { type: 'string', description: 'What kind of thing this is.', enum: ['decision', 'constraint', 'principle', 'note', 'outcome', 'non_goal', 'success_measure', 'unknown'] },
      text: { type: 'string', description: 'The person’s wording, as they said it.' },
    },
    required: ['kind', 'text'],
    additionalProperties: false,
  },
  validate(raw) {
    closed(raw, this.inputSchema);
    return { kind: str(raw, 'kind', { oneOf: STATEMENT_KINDS })! as StatementKind, text: str(raw, 'text')! };
  },
  run(ctx, input) {
    const s = ctx.workflow.remember({ ...input, by: ctx.actor });
    return { remembered: { id: s.id, kind: s.kind, text: s.text, at: s.createdAt }, nothingElseCreated: true };
  },
});

const classify = define<{ text: string }, unknown>({
  name: 'classify_request',
  title: 'What kind of request is this',
  description: 'Tells you whether a request is a plain question (answer it, record nothing), something to remember, an outcome to manage, or a standing outcome to maintain, and when to confirm before choosing the bigger one. Also names the workflow that fits.',
  surface: 'interactive',
  readOnly: true,
  inputSchema: { type: 'object', properties: { text: { type: 'string', description: 'The request in the person’s words.' } }, required: ['text'], additionalProperties: false },
  validate(raw) {
    closed(raw, this.inputSchema);
    return { text: str(raw, 'text')! };
  },
  run(ctx, { text }) {
    const c = ctx.workflow.classify(text);
    const lower = text.toLowerCase();
    const candidates = ctx.workflows.list().filter((w) => w.manifest.interactionClass === c.class || (c.class === 'maintain' && w.manifest.triggers.includes('schedule')));
    const scored = candidates.map((w) => ({ id: w.manifest.id, title: w.manifest.title, score: w.manifest.activation.filter((a) => a.toLowerCase().split(/\W+/).filter((word) => word.length > 3).some((word) => lower.includes(word))).length })).sort((a, b) => b.score - a.score);
    return { ...c, suggestedWorkflows: scored.filter((s) => s.score > 0).slice(0, 3).map((s) => ({ id: s.id, title: s.title })) };
  },
});

const workflows = define<{ action: 'list' | 'show' | 'resolve'; id?: string; input?: Record<string, unknown> }, unknown>({
  name: 'workflows',
  title: 'Workflows',
  description: 'List the workflows this project can run, show one, or resolve one against this session to learn whether it can run and what would stop it.',
  surface: 'interactive',
  readOnly: true,
  inputSchema: {
    type: 'object',
    properties: {
      action: { type: 'string', description: 'list, show, or resolve.', enum: ['list', 'show', 'resolve'] },
      id: { type: 'string', description: 'The workflow id, for show and resolve.' },
      input: { type: 'object', description: 'The workflow input, for resolve.' },
    },
    required: ['action'],
    additionalProperties: false,
  },
  validate(raw) {
    closed(raw, this.inputSchema);
    return { action: str(raw, 'action', { oneOf: ['list', 'show', 'resolve'] }) as 'list' | 'show' | 'resolve', id: str(raw, 'id', { optional: true }), input: obj(raw, 'input', { optional: true }) };
  },
  run(ctx, { action, id, input }) {
    if (action === 'list') return ctx.workflows.list().map((w) => ({ id: w.manifest.id, title: w.manifest.title, version: w.manifest.version, interactionClass: w.manifest.interactionClass, purpose: w.manifest.purpose, triggers: w.manifest.triggers }));
    if (!id) throw new Error(`"id" is required for ${action}`);
    const w = ctx.workflows.get(id);
    if (!w) throw new Error(`no workflow "${id}"; list shows the ones this project has`);
    if (action === 'show') return { ...w.manifest, origin: w.origin, digest: w.digest };
    return ctx.workflow.preflight(id, input ?? {}).preflight;
  },
});

const skills = define<{ action: 'list' | 'show' | 'status'; id?: string; includeBody: boolean }, unknown>({
  name: 'skills',
  title: 'Skills',
  description: 'List the skills available to this project, show one (its full text only when you ask for it), or check whether the ones a host needs on disk are current.',
  surface: 'interactive',
  readOnly: true,
  inputSchema: {
    type: 'object',
    properties: {
      action: { type: 'string', description: 'list, show, or status.', enum: ['list', 'show', 'status'] },
      id: { type: 'string', description: 'The skill id, for show.' },
      includeBody: { type: 'boolean', description: 'Include the skill’s full text (default false).' },
    },
    required: ['action'],
    additionalProperties: false,
  },
  validate(raw) {
    closed(raw, this.inputSchema);
    return { action: str(raw, 'action', { oneOf: ['list', 'show', 'status'] }) as 'list' | 'show' | 'status', id: str(raw, 'id', { optional: true }), includeBody: bool(raw, 'includeBody', false) };
  },
  run(ctx, { action, id, includeBody }) {
    if (action === 'list') return ctx.skills.list().map((s) => ({ id: s.manifest.id, title: s.manifest.title, version: s.manifest.version, category: s.manifest.category, description: s.description, activation: s.manifest.activation, standDown: s.manifest.standDown }));
    if (action === 'status') return lockStatus(ctx.files.lock ?? emptyLock(), ctx.skills.list(), ctx.workflows.list()).map((r) => ({ kind: r.kind, id: r.id, state: r.state, why: r.why }));
    if (!id) throw new Error('"id" is required for show');
    const s = ctx.skills.get(id);
    if (!s) throw new Error(`no skill "${id}"`);
    return { ...s.manifest, origin: s.origin, digest: s.digest, files: s.files, body: includeBody ? ctx.skills.body(id) : undefined };
  },
});

const startOutcome = define<{ workflowId: string; input: Record<string, unknown> }, unknown>({
  name: 'start_outcome',
  title: 'Start an outcome',
  description: 'Start a managed outcome by running a workflow. It is resolved first; if something is missing you get the reasons, not a half-started run. Returns the run and what it needs. Then call claim_work to do the next step here.',
  surface: 'interactive',
  readOnly: false,
  inputSchema: {
    type: 'object',
    properties: { workflowId: { type: 'string', description: 'Which workflow.' }, input: { type: 'object', description: 'The workflow input.' } },
    required: ['workflowId', 'input'],
    additionalProperties: false,
  },
  validate(raw) {
    closed(raw, this.inputSchema);
    return { workflowId: str(raw, 'workflowId')!, input: obj(raw, 'input')! };
  },
  run(ctx, { workflowId, input }) {
    const r = ctx.workflow.start({ workflowId, input, trigger: 'manual' });
    return { run: { id: r.run.id, state: r.run.state, workflow: r.run.workflowId }, created: r.created, preflight: r.preflight };
  },
});

const claimWork = define<{ runId?: string; includeSkillBody: boolean }, unknown>({
  name: 'claim_work',
  title: 'Claim the next step',
  description: 'Take the next ready step of a run to do in this session. Returns the step, its inputs, the skill bound to it (text on request), and instructions. If the run is waiting on a decision, returns that decision instead so you can surface it.',
  surface: 'interactive',
  readOnly: false,
  inputSchema: {
    type: 'object',
    properties: { runId: { type: 'string', description: 'A run id; omit to take from any active run.' }, includeSkillBody: { type: 'boolean', description: 'Include the bound skill’s full text (default false).' } },
    additionalProperties: false,
  },
  validate(raw) {
    closed(raw, this.inputSchema);
    return { runId: str(raw, 'runId', { optional: true }), includeSkillBody: bool(raw, 'includeSkillBody', false) };
  },
  run(ctx, { runId, includeSkillBody }) {
    const c = ctx.workflow.claimNext({ runId, owner: ctx.host.executorId });
    if (!c.packet) return { work: null, waitingOn: c.waitingOn };
    const p = c.packet;
    return {
      work: {
        stepRunId: p.leased.id,
        owner: p.leased.leaseOwner,
        token: p.leased.token,
        leaseUntil: p.leased.leaseUntil,
        run: { id: p.run.id, workflow: p.run.workflowId },
        step: { id: p.step.id, title: p.step.title, tier: p.step.tier, outputs: p.step.outputs, validators: p.step.validators, capabilities: p.step.capabilities },
        skill: p.skill ? { id: p.skill.id, version: p.skill.version, body: includeSkillBody ? p.skill.body() : undefined } : null,
        inputs: p.inputs,
        instructions: p.instructions,
      },
      waitingOn: null,
    };
  },
});

interface SubmitInput { stepRunId: string; owner: string; token: number; output: Record<string, unknown>; evidence: { ref: string; excerpt?: string }[]; noData: boolean }

const submitWork = define<SubmitInput, unknown>({
  name: 'submit_work',
  title: 'Submit a step’s result',
  description: 'Hand back what a claimed step produced, with the evidence you read. The result is checked by the step’s validators; a failure comes back with what to fix and the step is retried if its policy allows. Say noData when the step found nothing.',
  surface: 'both',
  readOnly: false,
  inputSchema: {
    type: 'object',
    properties: {
      stepRunId: { type: 'string', description: 'From claim_work.' },
      owner: { type: 'string', description: 'From claim_work.' },
      token: { type: 'number', description: 'From claim_work.' },
      output: { type: 'object', description: 'The step’s result, with the keys it declared.' },
      evidence: { type: 'array', description: 'What was read: {ref, excerpt?} entries.', items: { type: 'object' } },
      noData: { type: 'boolean', description: 'The step found nothing to work on.' },
    },
    required: ['stepRunId', 'owner', 'token', 'output'],
    additionalProperties: false,
  },
  validate(raw) {
    closed(raw, this.inputSchema);
    const token = num(raw, 'token');
    if (token === undefined) throw new Error('"token" is required');
    const evidence = list(raw, 'evidence').map((e) => {
      const r = record(e);
      const ref = typeof r.ref === 'string' ? r.ref : '';
      return { ref, excerpt: typeof r.excerpt === 'string' ? r.excerpt : undefined };
    });
    return { stepRunId: str(raw, 'stepRunId')!, owner: str(raw, 'owner')!, token, output: obj(raw, 'output')!, evidence, noData: bool(raw, 'noData', false) };
  },
  run(ctx, input) {
    const step = getStep(ctx.store, input.stepRunId);
    if (!step) throw new Error(`no step ${input.stepRunId}`);
    if (step.state !== 'leased' || step.leaseOwner !== input.owner || step.attempts !== input.token) {
      throw new Error(`step ${input.stepRunId} is not held under this owner and token; claim it again`);
    }
    const leased = { ...step, leaseOwner: input.owner, leaseUntil: step.leaseUntil ?? ctx.now(), token: input.token };
    const r = ctx.workflow.submit({ leased, output: input.output, evidence: input.evidence, noData: input.noData });
    return { step: { id: r.step.id, state: r.step.state, reason: r.step.stateReason }, validation: r.validation, run: { id: r.run.id, state: r.run.state }, deliverable: r.deliverable ? { id: r.deliverable.id, trust: r.deliverable.trustState } : null };
  },
});

const runStatus = define<{ runId: string }, unknown>({
  name: 'run_status',
  title: 'Run status',
  description: 'Where a run stands: its state, each step, the deliverables and how far they are trusted, and any decision it waits on.',
  surface: 'both',
  readOnly: true,
  inputSchema: { type: 'object', properties: { runId: { type: 'string', description: 'The run id.' } }, required: ['runId'], additionalProperties: false },
  validate(raw) {
    closed(raw, this.inputSchema);
    return { runId: str(raw, 'runId')! };
  },
  run(ctx, { runId }) {
    const v = ctx.workflow.status(runId);
    if (!v) throw new Error(`no run ${runId}`);
    return { run: { id: v.run.id, workflow: v.run.workflowId, state: v.run.state, reason: v.run.stateReason, preflight: v.run.preflight }, steps: v.steps.map((s) => ({ id: s.id, step: s.stepId, state: s.state, attempts: s.attempts, reason: s.stateReason })), deliverables: v.deliverables.map((d) => ({ id: d.id, kind: d.kind, trust: d.trustState, body: d.body })), openDecisions: v.openDecisions.map((d) => ({ id: d.id, kind: d.kind, question: d.question, options: d.options })) };
  },
});

const inbox = define<{ runId?: string }, unknown>({
  name: 'inbox',
  title: 'Decisions waiting on the person',
  description: 'The decisions, approvals, and questions that belong to the person, in plain words, with the options each accepts. Surface them conversationally; never decide them yourself.',
  surface: 'interactive',
  readOnly: true,
  inputSchema: { type: 'object', properties: { runId: { type: 'string', description: 'Only this run’s.' } }, additionalProperties: false },
  validate(raw) {
    closed(raw, this.inputSchema);
    return { runId: str(raw, 'runId', { optional: true }) };
  },
  run(ctx, { runId }) {
    return listOpenDecisions(ctx.store, runId).map((d) => ({ id: d.id, kind: d.kind, question: d.question, options: d.options, raisedAt: d.raisedAt, run: d.runId }));
  },
});

const decide = define<{ decisionId: string; resolution: string | string[] }, unknown>({
  name: 'decide',
  title: 'Relay the person’s decision',
  description: 'Record the answer the person gave to an open decision, in their words or as one of its options. An approval is scoped to exactly the action asked about and expires; it never widens.',
  surface: 'interactive',
  readOnly: false,
  inputSchema: {
    type: 'object',
    properties: { decisionId: { type: 'string', description: 'From inbox.' }, resolution: { type: 'string', description: 'The person’s answer, or one of the options.' } },
    required: ['decisionId', 'resolution'],
    additionalProperties: false,
  },
  validate(raw) {
    closed(raw, this.inputSchema);
    return { decisionId: str(raw, 'decisionId')!, resolution: str(raw, 'resolution')! };
  },
  run(ctx, { decisionId, resolution }) {
    const r = ctx.workflow.decide({ decisionId, resolution, by: ctx.actor });
    return { decision: { id: r.decision.id, state: r.decision.state, resolvedBy: r.decision.resolvedBy }, run: r.run ? { id: r.run.id, state: r.run.state } : null };
  },
});

const sources = define<{ action: 'list' | 'show' | 'refresh'; id?: string }, unknown>({
  name: 'sources',
  title: 'Sources',
  description: 'The systems and documents this project reads: what each is for, what it is trusted to settle, whether it is reachable and fresh. Refresh reads one now and records whether it changed.',
  surface: 'interactive',
  readOnly: false,
  inputSchema: {
    type: 'object',
    properties: { action: { type: 'string', description: 'list, show, or refresh.', enum: ['list', 'show', 'refresh'] }, id: { type: 'string', description: 'The source id, for show and refresh.' } },
    required: ['action'],
    additionalProperties: false,
  },
  validate(raw) {
    closed(raw, this.inputSchema);
    return { action: str(raw, 'action', { oneOf: ['list', 'show', 'refresh'] }) as 'list' | 'show' | 'refresh', id: str(raw, 'id', { optional: true }) };
  },
  async run(ctx, { action, id }) {
    const at = ctx.now();
    if (action === 'list') return ctx.sources.list().map((s) => ctx.sources.status(s.id, at));
    if (!id) throw new Error(`"id" is required for ${action}`);
    if (!ctx.sources.list().some((s) => s.id === id)) throw new Error(`no active source ${id}`);
    if (action === 'show') return ctx.sources.status(id, at);
    return ctx.sources.refresh(id, at, () => ctx.nextId('snap'));
  },
});

const staff = define<{ action: 'list' | 'show'; id?: string }, unknown>({
  name: 'staff',
  title: 'Staff and capability assignments',
  description: 'Who holds which capabilities and skills for this project. Read-only here; staff is set up on the command line.',
  surface: 'interactive',
  readOnly: true,
  inputSchema: { type: 'object', properties: { action: { type: 'string', description: 'list or show.', enum: ['list', 'show'] }, id: { type: 'string', description: 'The staff member id, for show.' } }, required: ['action'], additionalProperties: false },
  validate(raw) {
    closed(raw, this.inputSchema);
    return { action: str(raw, 'action', { oneOf: ['list', 'show'] }) as 'list' | 'show', id: str(raw, 'id', { optional: true }) };
  },
  run(ctx, { action, id }) {
    if (action === 'list') return listStaffMembers(ctx.store);
    if (!id) throw new Error('"id" is required for show');
    const m = getStaffMember(ctx.store, id);
    if (!m) throw new Error(`no staff member ${id}`);
    return m;
  },
});

const promote = define<{ deliverableId: string; to: TrustState; reason?: string }, unknown>({
  name: 'promote_deliverable',
  title: 'Move a deliverable’s trust',
  description: 'After the person has reviewed a deliverable: record a challenge verdict, their acceptance, or make it final. Only the person’s own judgment moves trust; a finished step never does.',
  surface: 'interactive',
  readOnly: false,
  inputSchema: {
    type: 'object',
    properties: { deliverableId: { type: 'string', description: 'The deliverable id.' }, to: { type: 'string', description: 'The trust state to move to.', enum: TRUST_STATES }, reason: { type: 'string', description: 'Why, in the person’s words.' } },
    required: ['deliverableId', 'to'],
    additionalProperties: false,
  },
  validate(raw) {
    closed(raw, this.inputSchema);
    return { deliverableId: str(raw, 'deliverableId')!, to: str(raw, 'to', { oneOf: TRUST_STATES }) as TrustState, reason: str(raw, 'reason', { optional: true }) };
  },
  run(ctx, { deliverableId, to, reason }) {
    const d = ctx.workflow.promote({ deliverableId, to, by: ctx.actor, reason });
    return { deliverable: { id: d.id, trust: d.trustState } };
  },
});

const heartbeat = define<{ stepRunId: string; owner: string; token: number }, unknown>({
  name: 'heartbeat',
  title: 'Keep a lease alive',
  description: 'A runner still working a step says so, so the lease is not taken over. Fails if the lease was already lost.',
  surface: 'headless',
  readOnly: false,
  inputSchema: {
    type: 'object',
    properties: { stepRunId: { type: 'string', description: 'From claim_step.' }, owner: { type: 'string', description: 'From claim_step.' }, token: { type: 'number', description: 'From claim_step.' } },
    required: ['stepRunId', 'owner', 'token'],
    additionalProperties: false,
  },
  validate(raw) {
    closed(raw, this.inputSchema);
    const token = num(raw, 'token');
    if (token === undefined) throw new Error('"token" is required');
    return { stepRunId: str(raw, 'stepRunId')!, owner: str(raw, 'owner')!, token };
  },
  run(ctx, { stepRunId, owner, token }) {
    const at = ctx.now();
    const until = new Date(Date.parse(at) + 30 * 60_000).toISOString();
    const result = ctx.store.db.prepare(`UPDATE step_runs SET lease_until = ?, updated_at = ? WHERE id = ? AND state = 'leased' AND lease_owner = ? AND attempts = ?`).run(until, at, stepRunId, owner, token);
    if (result.changes === 0) throw new Error(`step ${stepRunId} is not held under this owner and token`);
    return { leaseUntil: until };
  },
});

const claimStep = define<{ runId?: string }, unknown>({
  name: 'claim_step',
  title: 'Claim a pre-resolved step',
  description: 'A configured runner takes the next ready step of a run that was already resolved and gated. Returns the step, inputs, bound skill, and instructions, or what the run waits on.',
  surface: 'headless',
  readOnly: false,
  inputSchema: { type: 'object', properties: { runId: { type: 'string', description: 'A run id; omit for any active run.' } }, additionalProperties: false },
  validate(raw) {
    closed(raw, this.inputSchema);
    return { runId: str(raw, 'runId', { optional: true }) };
  },
  run(ctx, { runId }) {
    const c = ctx.workflow.claimNext({ runId, owner: ctx.host.executorId });
    if (!c.packet) return { work: null, waitingOn: c.waitingOn };
    const p = c.packet;
    return { work: { stepRunId: p.leased.id, owner: p.leased.leaseOwner, token: p.leased.token, leaseUntil: p.leased.leaseUntil, run: { id: p.run.id, workflow: p.run.workflowId }, step: { id: p.step.id, title: p.step.title, tier: p.step.tier, outputs: p.step.outputs, validators: p.step.validators }, skill: p.skill ? { id: p.skill.id, version: p.skill.version, body: p.skill.body() } : null, inputs: p.inputs, instructions: p.instructions }, waitingOn: null };
  },
});

/** Every tool, in the order a host sees them. */
export const TOOLS: readonly Tool<unknown, unknown>[] = [
  bootstrap, classify, projectContext, remember, workflows, skills, startOutcome, claimWork, submitWork, runStatus, inbox, decide, sources, staff, promote, claimStep, heartbeat,
] as unknown as readonly Tool<unknown, unknown>[];

export function toolsFor(surface: 'interactive' | 'headless'): readonly Tool<unknown, unknown>[] {
  return TOOLS.filter((t) => t.surface === 'both' || t.surface === surface);
}

/** What the headless surface must never be able to do, by tool name. */
export const HEADLESS_FORBIDDEN: readonly string[] = ['remember', 'start_outcome', 'decide', 'promote_deliverable', 'sources', 'skills', 'workflows', 'project_context', 'staff', 'claim_work', 'classify_request'];
