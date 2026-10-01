/**
 * kernel/broker/tools.ts — every tool Construct offers a host, declared once.
 *
 * Interactive tools serve the person's own session. Headless tools serve an
 * explicitly configured runner and are limited to pre-resolved steps,
 * leases, output, and status; nothing on that surface can change project
 * configuration, grant itself anything, resolve a decision, or finalize its
 * own output. Descriptions speak plainly; plumbing stays out of them.
 */

import { listStatements, getProfile, getStatement, missingProfileFields } from '../state/profile.ts';
import { delegate } from './delegate.ts';
import { listActiveRuns, listRuns } from '../state/runs.ts';
import { getDecision, listOpenDecisions } from '../state/decisions.ts';
import { applyOnboardingAnswers, listInbox, onboardingStatus, resolveProposal, type OnboardingAnswers } from '../project/onboarding.ts';
import { listStaffMembers, getStaffMember } from '../state/staff.ts';
import { listEntities, listClaims, listRelations, getEntity } from '../state/graph.ts';
import { listDriftFindings } from '../state/drift.ts';
import { extendLease, getStep, heldLease } from '../state/steps.ts';
import { lockStatus } from '../registry/lockfile.ts';
import { qualifySkill } from '../registry/qualification.ts';
import { emptyLock } from '../project/lock.ts';
import { constitutionCompleteness } from '../project/constitution.ts';
import { TIER_POLICIES } from '../policy/lattice.ts';
import { STATEMENT_KINDS, type StatementKind } from '../state/profile.ts';
import { getDeliverable, TRUST_STATES, type TrustState } from '../state/deliverables.ts';
import { assessConsequence } from '../workflow/consequence.ts';
import type { BrokerContext } from './context.ts';
import { bool, closed, list, num, obj, record, str, type ToolDefinition, ToolInputError } from './definition.ts';
import { recordAgent } from '../state/sessions.ts';
import { PERSON_ONLY_TRUST, PersonChannelRequiredError, personStepFor } from '../policy/channels.ts';
import { createRouter, type Router } from '../skills/routing.ts';
import { LEASE_MODES, MAIN_LANE, findOverlaps, leasesFor, normalizeLeasePath, type LeaseMode, type Overlap } from '../work/leases.ts';
import { asPeerData, type Handoff, type PeerData } from '../work/handoff.ts';
import { coordinationFor, presentSessions, recentActivity } from '../coord/awareness.ts';
import { acceptWork, claimWork as claimWorkItem, completeWork, handoffOf, handoffWork, listOffers, getWork, getWorkByLegacyId, listReady, queryWork, readinessOf, releaseWork, reopenWork, takeoverWork, updateWork, requalifyWork } from '../work/service.ts';
import { fileWork, linkWork, unlinkWork, workStructure } from '../work/structure.ts';

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
    const proposals = onboardingStatus(ctx.store).proposalsAwaitingReview;
    const runs = listActiveRuns(ctx.store);
    const sources = ctx.sources.summary(at);
    const lock = lockStatus(ctx.files.lock ?? emptyLock(), ctx.skills.list(), ctx.workflows.list());
    const skew = lock.filter((r) => r.state !== 'current');
    const drift = listDriftFindings(ctx.store, { status: 'open' });
    const missing = missingProfileFields(profile);
    const next =
      onboarding.length > 0 ? `answer the ${String(onboarding.length)} setup question(s) with decide`
      : proposals > 0 ? `review ${String(proposals)} proposed statement(s) with inbox`
      : open.length > 0 ? `${String(open.length)} decision(s) wait on the person; show them with inbox`
      : runs.length > 0 ? `${String(runs.length)} run(s) active; continue with claim_work`
      : 'listen: answer questions plainly, remember what the person asks to keep, start an outcome when asked for work';
    return {
      construct: { version: ctx.version, project: { root: ctx.root, id: ctx.files.config?.id ?? null, name: ctx.files.config?.name ?? null, lane: ctx.lane } },
      session: { host: ctx.host.hostId, session: ctx.sessionId ?? ctx.host.sessionId, executor: ctx.host.executorId, actor: ctx.actor },
      profile: { onboarding: profile?.onboardingState ?? 'incomplete', missing, openQuestions: onboarding.map((d) => ({ id: d.id, question: d.question, options: d.options })), proposals },
      sources,
      registry: { skills: ctx.skills.list().length, workflows: ctx.workflows.list().length, locked: lock.filter((r) => r.state === 'current').length, skew: skew.map((r) => `${r.kind} ${r.id} ${r.state}`) },
      capabilities: { available: [...ctx.host.available].sort(), maxTier: ctx.host.maxTier, restrictions: ctx.host.restrictions, budgetCents: ctx.host.budgetCents },
      tiers: Object.values(TIER_POLICIES).map((p) => ({ tier: p.tier, requirement: p.requirement })),
      decisions: { open: open.length },
      runs: runs.map((r) => ({ id: r.id, workflow: r.workflowId, state: r.state })),
      drift: { open: drift.length },
      coordination: coordinationFor(ctx.store, { sessionId: ctx.sessionId, laneRoot: ctx.lane?.root, now: at }),
      next,
    };
  },
});

const TOPICS = ['summary', 'constitution', 'sources', 'decisions', 'runs', 'entities', 'claims', 'relations', 'drift', 'statements', 'work', 'sessions', 'activity'] as const;

function page<T>(items: readonly T[], text: (t: T) => string, query: string | undefined, limit: number): { items: T[]; total: number; truncated: boolean; query: string | null } {
  const q = query?.trim().toLowerCase();
  const matched = q ? items.filter((i) => text(i).toLowerCase().includes(q)) : [...items];
  const sliced = matched.slice(0, limit);
  return { items: sliced, total: matched.length, truncated: sliced.length < matched.length, query: q ?? null };
}

const projectContext = define<{ topic: (typeof TOPICS)[number]; query?: string; limit: number }, unknown>({
  name: 'project_context',
  title: 'Project context',
  description: 'Targeted reads of what Construct knows: the constitution, sources, decisions, runs, entities, claims, relations, drift findings, remembered statements, work, the sessions present in the project, or recent activity. Ask for one topic at a time; pass a query to narrow. Filter happens before the page; the result names how many matched and whether more remain.',
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
    switch (topic) {
      case 'summary': {
        const c = ctx.files.constitution;
        return { constitution: c ? { ...c, completeness: constitutionCompleteness(c) } : null, sources: ctx.sources.summary(ctx.now()), openDecisions: listOpenDecisions(ctx.store).length, activeRuns: listActiveRuns(ctx.store).length, readyWork: listReady(ctx.store, ctx.now()).length };
      }
      case 'constitution':
        return ctx.files.constitution;
      case 'sources': {
        const p = page(ctx.sources.list(), (s) => `${s.id} ${s.kind} ${s.purpose}`, query, limit);
        return { ...p, items: p.items.map((s) => ctx.sources.status(s.id, ctx.now())) };
      }
      case 'decisions':
        return page(listInbox(ctx.store), (d) => `${d.id} ${d.question} ${d.kind}`, query, limit);
      case 'runs':
        return page(listRuns(ctx.store, { limit: 10_000 }), (r) => `${r.id} ${r.workflowId} ${r.state}`, query, limit);
      case 'entities':
        return page(listEntities(ctx.store, { limit: 10_000 }), (e) => `${e.id} ${e.kind} ${e.name}`, query, limit);
      case 'claims':
        return page(listClaims(ctx.store), (c) => `${c.id} ${c.claimType} ${c.statement}`, query, limit);
      case 'relations':
        return page(listRelations(ctx.store), (r) => `${r.id} ${r.kind} ${r.fromId} ${r.toId}`, query, limit);
      case 'drift':
        return page(listDriftFindings(ctx.store), (f) => `${f.id} ${f.kind} ${f.summary}`, query, limit);
      case 'statements':
        return page(listStatements(ctx.store), (s) => `${s.kind} ${s.text}`, query, limit);
      case 'work':
        return page(queryWork(ctx.store, { query, limit: 10_000 }).items, (w) => `${w.id} ${w.title} ${w.status} ${w.kind}`, query, limit);
      case 'sessions':
        return page(presentSessions(ctx.store, { now: ctx.now(), sessionId: ctx.sessionId }), (s) => `${s.id} ${s.host} ${s.client ?? ''} ${s.lane} ${s.branch ?? ''} ${s.agents.join(' ')}`, query, limit);
      case 'activity':
        return page(recentActivity(ctx.store, 500), (a) => `${a.kind} ${a.sessionId ?? ''} ${a.agent ?? ''} ${a.actor ?? ''} ${JSON.stringify(a.payload.content)}`, query, limit);
      default:
        return null;
    }
  },
});

const remember = define<{ kind: StatementKind; text: string; assumptions: string[]; replaces?: string }, unknown>({
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
      assumptions: { type: 'array', description: 'Load-bearing assumptions this governing record rests on.', items: { type: 'string' } },
      replaces: { type: 'string', description: 'The id of a statement this one supersedes.' },
    },
    required: ['kind', 'text'],
    additionalProperties: false,
  },
  validate(raw) {
    closed(raw, this.inputSchema);
    const assumptions = list(raw, 'assumptions').filter((a): a is string => typeof a === 'string' && a.trim().length > 0);
    return { kind: str(raw, 'kind', { oneOf: STATEMENT_KINDS })! as StatementKind, text: str(raw, 'text')!, assumptions, replaces: str(raw, 'replaces', { optional: true }) };
  },
  run(ctx, input) {
    // The person asked the model to keep this; the record says the model relayed it.
    const s = ctx.workflow.remember({ ...input, by: ctx.actor, channel: 'relay' });
    return { remembered: { id: s.id, kind: s.kind, text: s.text, at: s.createdAt, channel: s.channel }, nothingElseCreated: true };
  },
});

const classify = define<{ text: string }, unknown>({
  name: 'classify_request',
  title: 'What kind of request is this',
  description: 'Call this first for any request that is not obviously a plain question. Tells you whether it is a question (answer it, record nothing), something to remember, an outcome to manage, a standing outcome to maintain, or a matter of working alongside other agents (which the work tool serves), and ranks the skills that fit the person’s own words so you can choose without them naming one. You are the judge: the ranking orders, it does not decide.',
  surface: 'interactive',
  readOnly: true,
  inputSchema: { type: 'object', properties: { text: { type: 'string', description: 'The request in the person’s words.' } }, required: ['text'], additionalProperties: false },
  validate(raw) {
    closed(raw, this.inputSchema);
    return { text: str(raw, 'text')! };
  },
  run(ctx, { text }) {
    const c = ctx.workflow.classify(text);
    const ranked = routerFor(ctx.skills.list()).route(text);
    const byId = new Map(ctx.skills.list().map((s) => [s.manifest.id, s]));
    const skills = ranked
      .filter((r) => r.band !== 'unlikely')
      .map((r) => {
        const s = byId.get(r.id)!;
        return { id: r.id, band: r.band, title: s.manifest.title, category: s.manifest.category, useWhen: s.description, nearestExample: r.nearestExample, workflows: workflowsUsing(ctx, r.id) };
      });
    const likely = skills.filter((s) => s.band === 'likely');
    let classification = { ...c };
    if (c.class === 'answer' && c.confidence < 0.8 && !c.coordination && likely.some((s) => s.workflows.length > 0)) {
      classification = {
        class: 'manage',
        confidence: Math.max(c.confidence, 0.6),
        why: 'the request matches professional work even though it did not open with a work verb',
        confirmBeforeProceeding: true,
        rememberKind: null,
        coordination: null,
      };
    }
    const workflowsForClass = ctx.workflows.list().filter((w) => w.manifest.interactionClass === classification.class || (classification.class === 'maintain' && w.manifest.triggers.includes('schedule')));
    const suggestedWorkflows = [...new Set([...likely.flatMap((s) => s.workflows), ...workflowsForClass.map((w) => w.manifest.id)])]
      .map((id) => ctx.workflows.get(id))
      .filter((w) => w !== null)
      .filter(() => !(classification.class === 'answer' || classification.class === 'remember' || classification.coordination))
      .slice(0, 5)
      .map((w) => ({ id: w.manifest.id, title: w.manifest.title }));
    const activeContradictions = listRelations(ctx.store, { kind: 'contradicts' }).filter((r) => {
      if (r.status === 'retired') return false;
      const target = getEntity(ctx.store, r.toId);
      return !!target && (target.kind === 'decision' || target.kind === 'requirement') && target.status === 'active';
    }).length;
    const judgment = assessConsequence(text, getProfile(ctx.store)?.scale ?? null, {
      likelySkills: likely.map((s) => s.id),
      activeContradictions,
    });
    const next =
      classification.coordination ? classification.coordination.next
      : classification.class === 'answer' ? 'answer it yourself; load no skill and record nothing, unless a likely skill below plainly fits the question'
      : classification.class === 'remember' ? 'call remember with the person’s wording'
      : likely.length === 0 ? 'no skill is a clear fit; answer, or ask one question about what the person wants produced'
      : judgment.challenge ? 'read the likely skills in order; this work needs professional challenge before it is treated as strongly validated; then resolve the workflow that carries the skill'
      : 'read the likely skills in order and choose by their useWhen text, not by rank alone; ask one question only when two fit and the difference changes the work; then resolve the workflow that carries the skill';
    return { ...classification, next, skills, suggestedWorkflows, judgment };
  },
});

// One router per catalog; the catalog changes only when a bundle digest does.
let routerCache: { key: string; router: Router } | null = null;
function routerFor(skills: readonly import('../registry/models.ts').RegisteredSkill[]): Router {
  const key = skills.map((s) => s.digest).join('|');
  if (routerCache && routerCache.key === key) return routerCache.router;
  const router = createRouter(skills.map((s) => ({ id: s.manifest.id, description: s.description, activation: s.manifest.activation, standDown: s.manifest.standDown, examples: s.examples })));
  routerCache = { key, router };
  return router;
}

function workflowsUsing(ctx: BrokerContext, skillId: string): string[] {
  return ctx.workflows.list().filter((w) => w.manifest.steps.some((st) => st.skill?.id === skillId)).map((w) => w.manifest.id);
}

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
    const lock = lockStatus(ctx.files.lock ?? emptyLock(), ctx.skills.list(), ctx.workflows.list()).find((r) => r.kind === 'skill' && r.id === id);
    const body = ctx.skills.body(id);
    return {
      ...s.manifest,
      origin: s.origin,
      digest: s.digest,
      files: s.files,
      qualification: qualifySkill(s, lock, body),
      body: includeBody ? body : undefined,
    };
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
  description: 'Take the next ready step of a run to do in this session. Returns the step, its inputs, the skill bound to it (text on request), and instructions. If the run is waiting on a decision, returns that decision instead so you can surface it. A step the person approved for another session is held for it, and a step beyond what this session may do is refused; either comes back with who or why.',
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
        token: p.leased.nonce,
        leaseUntil: p.leased.leaseUntil,
        run: { id: p.run.id, workflow: p.run.workflowId },
        step: { id: p.step.id, title: p.step.title, tier: p.step.tier, outputs: p.step.outputs, validators: p.step.validators, capabilities: p.step.capabilities },
        skill: p.skill ? { id: p.skill.id, version: p.skill.version, body: includeSkillBody ? p.skill.body() : undefined } : null,
        inputs: p.inputs,
        instructions: p.instructions,
        judgment: p.judgment,
      },
      waitingOn: null,
    };
  },
});

interface SubmitInput { stepRunId: string; token: string; output: Record<string, unknown>; evidence: { ref: string; excerpt?: string }[]; noData: boolean }

const submitWork = define<SubmitInput, unknown>({
  name: 'submit_work',
  title: 'Submit a step’s result',
  description: 'Hand back what a claimed step produced, with the evidence you read. The result is checked by the step’s validators; a failure comes back with what to fix and the step is retried if its policy allows. Say noData when the step found nothing. Only the session that claimed the step, holding the token its claim returned, can submit it.',
  surface: 'both',
  readOnly: false,
  inputSchema: {
    type: 'object',
    properties: {
      stepRunId: { type: 'string', description: 'From claim_work.' },
      token: { type: 'string', description: 'From claim_work: the lease’s secret.' },
      owner: { type: 'string', description: 'Ignored: the lease holder is the calling session.' },
      output: { type: 'object', description: 'The step’s result, with the keys it declared.' },
      evidence: { type: 'array', description: 'What was read: {ref, excerpt?} entries.', items: { type: 'object' } },
      noData: { type: 'boolean', description: 'The step found nothing to work on.' },
    },
    required: ['stepRunId', 'token', 'output'],
    additionalProperties: false,
  },
  validate(raw) {
    closed(raw, this.inputSchema);
    const evidence = list(raw, 'evidence').map((e) => {
      const r = record(e);
      const ref = typeof r.ref === 'string' ? r.ref : '';
      return { ref, excerpt: typeof r.excerpt === 'string' ? r.excerpt : undefined };
    });
    return { stepRunId: str(raw, 'stepRunId')!, token: leaseToken(raw), output: obj(raw, 'output')!, evidence, noData: bool(raw, 'noData', false) };
  },
  run(ctx, input) {
    if (!getStep(ctx.store, input.stepRunId)) throw new Error(`no step ${input.stepRunId}`);
    const leased = heldLease(ctx.store, { id: input.stepRunId, owner: ctx.host.executorId, nonce: input.token });
    if (!leased) throw new Error(`step ${input.stepRunId} is not held by this session under that token; claim it again`);
    const r = ctx.workflow.submit({ leased, output: input.output, evidence: input.evidence, noData: input.noData });
    return { step: { id: r.step.id, state: r.step.state, reason: r.step.stateReason }, validation: r.validation, run: { id: r.run.id, state: r.run.state }, deliverable: r.deliverable ? { id: r.deliverable.id, trust: r.deliverable.trustState } : null };
  },
});

/** A lease token as given: the claim's secret string. */
function leaseToken(raw: Record<string, unknown>): string {
  const token = raw.token;
  if (typeof token !== 'string' || !token.trim()) throw new ToolInputError('"token" is required: the token claim_work returned');
  return token.trim();
}

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
  description: 'The approvals, questions, and proposed statements that belong to the person, in plain words, with the options each accepts. Surface them conversationally; never decide them yourself.',
  surface: 'interactive',
  readOnly: true,
  inputSchema: { type: 'object', properties: { runId: { type: 'string', description: 'Only this run’s.' } }, additionalProperties: false },
  validate(raw) {
    closed(raw, this.inputSchema);
    return { runId: str(raw, 'runId', { optional: true }) };
  },
  run(ctx, { runId }) {
    return listInbox(ctx.store, runId);
  },
});

const decide = define<{ decisionId: string; resolution: string | string[] }, unknown>({
  name: 'decide',
  title: 'Relay the person’s decision',
  description: 'Record the answer the person gave to an open decision, in their words or as one of its options. An approval is scoped to exactly the action asked about and expires; it never widens. Approving an external or destructive action, or accepting a deliverable, needs the person to answer Construct directly: when the host can, Construct puts the question to them itself; otherwise it stays open and says how.',
  surface: 'interactive',
  readOnly: false,
  destructive: true,
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
  async run(ctx, { decisionId, resolution }) {
    // Whatever arrives here was relayed by the model in the host, so it is
    // recorded as relayed through that host, never as the person.
    const by = `relayed via ${ctx.host.hostId}`;
    // A setup question answered here is the same answer init would have taken
    // as a flag: it lands in the profile, and the question closes with it.
    const existing = getDecision(ctx.store, decisionId);
    const proposed = existing ? null : getStatement(ctx.store, decisionId);
    if (proposed?.status === 'proposed') {
      const answer = Array.isArray(resolution) ? resolution.join(' ') : resolution;
      const statement = resolveProposal(ctx.store, { id: decisionId, resolution: answer, at: ctx.now(), nextId: ctx.nextId, by, channel: 'relay' });
      return { decision: { id: statement.id, state: statement.status, resolvedBy: by }, run: null, statement: { id: statement.id, kind: statement.kind, status: statement.status } };
    }
    const onboarding = existing?.kind === 'clarification' && existing.state === 'open' ? onboardingAnswerFor(existing.subject, resolution) : null;
    if (onboarding) {
      const applied = applyOnboardingAnswers(ctx.store, { answers: onboarding, by, at: ctx.now(), nextId: ctx.nextId, channel: 'relay' });
      const decision = getDecision(ctx.store, decisionId)!;
      return { decision: { id: decision.id, state: decision.state, resolvedBy: decision.resolvedBy }, run: null, profile: { onboarding: applied.profile.onboardingState, missing: applied.missing } };
    }
    try {
      const r = ctx.workflow.decide({ decisionId, resolution, by, channel: 'relay' });
      return { decision: { id: r.decision.id, state: r.decision.state, resolvedBy: r.decision.resolvedBy }, run: r.run ? { id: r.run.id, state: r.run.state } : null };
    } catch (error) {
      if (!(error instanceof PersonChannelRequiredError)) throw error;
      const asked = await askThePerson(ctx, decisionId, `Your assistant relayed "${Array.isArray(resolution) ? resolution.join(' ') : resolution}".`);
      if (asked) return asked;
      return { decision: { id: decisionId, state: 'open' }, personRequired: true, next: error.message };
    }
  },
});

/**
 * Put an open decision to the person directly, when the host can show it to
 * them and nothing answers it for them. Their choice resolves the decision on
 * the elicitation channel; no answer leaves it open, and says so. Null when
 * the host cannot ask.
 */
async function askThePerson(ctx: BrokerContext, decisionId: string, relayed: string | null): Promise<Record<string, unknown> | null> {
  if (!ctx.askPerson) return null;
  const decision = getDecision(ctx.store, decisionId);
  if (!decision || decision.state !== 'open') return null;
  const options = decision.options && decision.options.length > 0 ? decision.options.map(String) : ['approve', 'decline'];
  const answer = await ctx.askPerson({
    message: `Construct needs your own answer; your assistant cannot give it for you. ${decision.question}${relayed ? ` ${relayed}` : ''}`,
    options,
  });
  if (!answer.answered) {
    const why = { declined: 'the person declined the prompt', cancelled: 'the person closed the prompt', timeout: 'the person did not answer the prompt in time', unavailable: 'the host could not show the prompt' }[answer.why];
    return { decision: { id: decisionId, state: 'open' }, personRequired: true, asked: why, next: personStepFor(decisionId) };
  }
  const by = `person via ${ctx.host.hostId} prompt`;
  const r = ctx.workflow.decide({ decisionId, resolution: answer.choice, by, channel: 'elicitation' });
  return { decision: { id: r.decision.id, state: r.decision.state, resolvedBy: r.decision.resolvedBy, resolution: answer.choice }, channel: 'elicitation', run: r.run ? { id: r.run.id, state: r.run.state } : null };
}

function onboardingAnswerFor(subject: unknown, resolution: string | readonly string[]): OnboardingAnswers | null {
  const id = subject !== null && typeof subject === 'object' ? (subject as { onboarding?: unknown }).onboarding : undefined;
  const answers = Array.isArray(resolution) ? (resolution as readonly string[]) : [resolution as string];
  if (id === 'scale') return { scale: answers.join(' ') as OnboardingAnswers['scale'] };
  if (id === 'primary_outcome') return { primaryOutcome: answers.join(' ') };
  if (id === 'protected_constraints') return { protectedConstraints: answers };
  return null;
}

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
  description: 'After the person has reviewed a deliverable: record a challenge verdict, or ask for their acceptance or to make it final. Accepted and final are the person’s own answer: Construct asks them directly when the host can, and otherwise the question waits in the inbox. A finished step never moves trust.',
  surface: 'interactive',
  readOnly: false,
  destructive: true,
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
  async run(ctx, { deliverableId, to, reason }) {
    if (PERSON_ONLY_TRUST.has(to)) {
      const pending = ctx.workflow.requestPromotion({ deliverableId, to, by: ctx.actor, reason });
      const asked = await askThePerson(ctx, pending.id, null);
      if (asked && (asked.decision as { state: string }).state !== 'open') {
        const d = getDeliverable(ctx.store, deliverableId);
        return { ...asked, deliverable: { id: deliverableId, trust: d?.trustState ?? 'unchanged' } };
      }
      return { deliverable: { id: deliverableId, trust: 'unchanged' }, pendingDecision: pending.id, personRequired: true, ...(asked ? { asked: asked.asked } : {}), next: personStepFor(pending.id) };
    }
    const d = ctx.workflow.promote({ deliverableId, to, by: ctx.actor, channel: 'relay', reason });
    return { deliverable: { id: d.id, trust: d.trustState } };
  },
});

const WORK_ACTIONS = ['list', 'ready', 'offers', 'show', 'add', 'update', 'link', 'unlink', 'requalify', 'claim', 'check', 'handoff', 'accept', 'complete', 'release', 'takeover', 'reopen'] as const;
type WorkAction = (typeof WORK_ACTIONS)[number];
const WORK_CLAIM_TERM_MS = 30 * 60_000;

/**
 * Who holds a claim: this session and the agent inside it. Two agents of one
 * session are two claimants; an agent the host did not vouch for is recorded
 * as reported. Without a session (a caller with none) the actor stands in.
 */
function claimantFor(ctx: BrokerContext, agent: string | undefined, at: string): { owner: string; session?: string; agent?: string; lane?: string; branch: string | null } {
  const who = claimantOf(ctx, agent);
  if (who.session && who.agent !== 'main') recordAgent(ctx.store, { sessionId: who.session, agent: who.agent!, attestation: 'reported', at, laneRoot: ctx.lane?.root });
  return who;
}

/** The claimant an agent of this session is, without recording anything. */
function claimantOf(ctx: BrokerContext, agent: string | undefined): { owner: string; session?: string; agent?: string; lane?: string; branch: string | null } {
  const where = { lane: ctx.lane?.root, branch: ctx.lane?.branch ?? null };
  if (!ctx.sessionId) return { owner: ctx.actor, ...where };
  const name = agent ?? 'main';
  return { owner: `${ctx.sessionId}/${name}`, session: ctx.sessionId, agent: name, ...where };
}

const MAX_LEASE_PATHS = 200;

/**
 * An agent's name within its session. Other sessions see it in the holder of
 * a claim, so it is an identifier, never a sentence.
 */
export const AGENT_NAME = /^[A-Za-z0-9][A-Za-z0-9._-]{0,39}$/;
/** Whom a handoff is offered to: a session, or a session's agent. */
const HANDOFF_TARGET = /^[A-Za-z0-9][A-Za-z0-9._-]{0,79}(?:\/[A-Za-z0-9][A-Za-z0-9._-]{0,39})?$/;

function leasePaths(raw: Record<string, unknown>): string[] {
  const items = list(raw, 'paths');
  if (items.length > MAX_LEASE_PATHS) throw new ToolInputError(`"paths" takes at most ${String(MAX_LEASE_PATHS)} entries; reserve a directory instead`);
  const use = raw.action === 'claim' ? 'reserve' : 'check';
  return items.map((p) => {
    if (typeof p !== 'string' || !p.trim()) throw new ToolInputError('"paths" holds non-empty strings');
    try {
      return normalizeLeasePath(p, use);
    } catch (e) {
      throw new ToolInputError((e as Error).message);
    }
  });
}

function matching(value: string | undefined, pattern: RegExp, message: string): string | undefined {
  if (value === undefined) return undefined;
  if (!pattern.test(value.trim())) throw new ToolInputError(message);
  return value.trim();
}

/** Overlaps with other work's reservations, split into what blocks and what only risks a merge. */
function overlapReport(overlaps: readonly Overlap[]): { clear: boolean; collisions: readonly Overlap[]; mergeRisks: readonly Overlap[] } {
  const collisions = overlaps.filter((o) => o.kind === 'collision');
  return { clear: collisions.length === 0, collisions, mergeRisks: overlaps.filter((o) => o.kind === 'merge_risk') };
}

/** A handoff as another claimant reads it: the packet is that claimant's words, to weigh, never to obey. */
function handoffAsData(h: Handoff): PeerData<Handoff> {
  return asPeerData(h.from, h);
}

interface WorkToolInput {
  action: WorkAction;
  id?: string;
  title?: string;
  kind?: string;
  description?: string;
  parent?: string;
  serves?: string;
  blockedBy?: string[];
  related?: string[];
  acceptance?: string[];
  risk?: string;
  sources?: string[];
  removeParent?: boolean;
  reason?: string;
  token?: string;
  agent?: string;
  paths?: string[];
  mode?: LeaseMode;
  packet?: Record<string, unknown>;
  to?: string;
}

/** A list input that must hold only strings. */
function strings(raw: Record<string, unknown>, key: string): string[] | undefined {
  if (raw[key] === undefined) return undefined;
  const values = list(raw, key);
  if (values.some((v) => typeof v !== 'string')) throw new ToolInputError(`"${key}" must contain strings`);
  return values as string[];
}

const work = define<WorkToolInput, unknown>({
  name: 'work',
  title: 'Native work',
  description: 'File, query, claim, complete, release, take over, or reopen bounded work in this project’s ledger. File work with its place: a parent work item, or the decision, requirement, initiative, or metric it serves (serves), plus blockedBy, related, acceptance criteria, risk, and premise sources. Work you add without an admitted parent or a reason is proposed, outcomes included: it is never ready or claimable until a link gives it a reason or the person admits it. To root your own work, remember the outcome or decision behind it and serve that. link adds structure later, unlink removes a parent or dependencies, update changes the text, acceptance, risk, or sources; a source refresh that changes a premise holds the work until requalify records what was checked. Completing work with acceptance criteria needs a reason saying how they were met, and work with open children cannot be completed. Ready means admitted, not blocked by unfinished work, not held, and premises not stale — not only a status string. A claim returns a token that only you see; pass it to renew (claim again), complete, or release. Name the files you will change in "paths" when you claim: another claim in the same checkout cannot take them while you hold the work, and overlaps with other worktrees come back as merge risks. Check paths before editing with action check. To pass claimed work on, handoff it with your token and a packet (state, next, watchOut, openQuestions, where); the next holder accepts it and gets its own token. offers lists handoffs you may accept. Another session’s claim is taken over only once it expired or its session went quiet, with a reason.',
  surface: 'interactive',
  readOnly: false,
  destructive: true,
  inputSchema: {
    type: 'object',
    properties: {
      action: { type: 'string', description: WORK_ACTIONS.join(', ') + '.', enum: [...WORK_ACTIONS] },
      id: { type: 'string', description: 'Work id or a preserved legacy id.' },
      title: { type: 'string', description: 'Title, for add and update.' },
      kind: { type: 'string', description: 'outcome, task, defect, or plan.', enum: ['outcome', 'task', 'defect', 'plan'] },
      description: { type: 'string', description: 'For add and update: what the work is, in enough detail to pick it up cold.' },
      parent: { type: 'string', description: 'For add and link: the work item this one is part of.' },
      serves: { type: 'string', description: 'For add and link: the decision, requirement, initiative, or metric this work serves, by entity id or governing statement id.' },
      blockedBy: { type: 'array', items: { type: 'string' }, description: 'For add, link, and unlink: work that must finish before this is ready.' },
      related: { type: 'array', items: { type: 'string' }, description: 'For add, link, and unlink: work that gives context without blocking.' },
      acceptance: { type: 'array', items: { type: 'string' }, description: 'For add and update: observable criteria a finished item meets, one each. update replaces the list.' },
      risk: { type: 'string', description: 'For add and update: what could go wrong.' },
      sources: { type: 'array', items: { type: 'string' }, description: 'For add and update: source ids whose refresh sends this work back for requalification.' },
      removeParent: { type: 'boolean', description: 'For unlink: remove the parent.' },
      reason: { type: 'string', description: 'Required for reopen, takeover, and requalify; for complete, required when the work has acceptance criteria, saying how they were met.' },
      token: { type: 'string', description: 'The token your claim returned: renews a claim, completes or releases it.' },
      agent: { type: 'string', description: 'Which agent in this session is acting, when the host runs several (for example a subagent’s name). Claims are held per agent.' },
      paths: { type: 'array', items: { type: 'string' }, description: 'Files or directories (ending in /) relative to the repository root, for claim and check. A claim reserves them while it is held.' },
      mode: { type: 'string', description: 'exclusive (the default) keeps other claims in this checkout off the paths; shared lets other shared claims read alongside.', enum: [...LEASE_MODES] },
      packet: { type: 'object', description: 'For handoff: state (where the work stands) and next (the next concrete step) are required; watchOut and openQuestions are lists; where holds branch, commit, and paths.' },
      to: { type: 'string', description: 'For handoff: the claimant (session/agent) or session to offer it to. Without it anyone here may accept.' },
    },
    required: ['action'],
    additionalProperties: false,
  },
  validate(raw) {
    closed(raw, this.inputSchema);
    return {
      action: str(raw, 'action', { oneOf: [...WORK_ACTIONS] }) as WorkAction,
      id: str(raw, 'id', { optional: true }),
      title: str(raw, 'title', { optional: true }),
      kind: str(raw, 'kind', { optional: true, oneOf: ['outcome', 'task', 'defect', 'plan'] }),
      description: str(raw, 'description', { optional: true }),
      parent: str(raw, 'parent', { optional: true }),
      serves: str(raw, 'serves', { optional: true }),
      blockedBy: strings(raw, 'blockedBy'),
      related: strings(raw, 'related'),
      acceptance: strings(raw, 'acceptance'),
      risk: str(raw, 'risk', { optional: true }),
      sources: strings(raw, 'sources'),
      removeParent: bool(raw, 'removeParent', false),
      reason: str(raw, 'reason', { optional: true }),
      token: str(raw, 'token', { optional: true }),
      agent: matching(str(raw, 'agent', { optional: true }), AGENT_NAME, '"agent" is a name of letters, digits, dot, dash, or underscore, at most 40 characters'),
      paths: raw.paths === undefined ? undefined : leasePaths(raw),
      mode: str(raw, 'mode', { optional: true, oneOf: [...LEASE_MODES] }) as LeaseMode | undefined,
      packet: obj(raw, 'packet', { optional: true }),
      to: matching(str(raw, 'to', { optional: true }), HANDOFF_TARGET, '"to" names a session or a session’s agent, such as ses_ab12/reviewer'),
    };
  },
  run(ctx, { action, id, title, kind, description, parent, serves, blockedBy, related, acceptance, risk, sources, removeParent, reason, token, agent, paths, mode, packet, to }) {
    const at = ctx.now();
    if (action === 'list') return queryWork(ctx.store, { query: title, parentId: parent, limit: 50 });
    if (action === 'offers') return listOffers(ctx.store, at, claimantOf(ctx, agent)).map((o) => ({ work: o.work, handoff: handoffAsData(o.handoff) }));
    if (action === 'check') {
      if (!paths || paths.length === 0) throw new Error('"paths" is required for check');
      const exclude = id ? (getWork(ctx.store, id) ?? getWorkByLegacyId(ctx.store, id))?.id : undefined;
      return overlapReport(findOverlaps(ctx.store, { paths, laneRoot: ctx.lane?.root ?? MAIN_LANE, now: at, mode, excludeWorkId: exclude }));
    }
    if (action === 'ready') return listReady(ctx.store, at);
    if (action === 'add') {
      if (!title) throw new Error('"title" is required for add');
      const filed = fileWork(ctx.store, {
        id: ctx.nextId('work'),
        kind: (kind as 'outcome' | 'task' | 'defect' | 'plan' | undefined) ?? 'task',
        title,
        description,
        parentId: parent,
        serves,
        blockedBy,
        related,
        acceptance,
        risk,
        sources,
        byPerson: false,
        at,
        actor: ctx.actor,
        nextId: ctx.nextId,
      });
      return { ...filed.work, admitted: filed.admitted, admittedBy: filed.admittedBy, next: filed.next };
    }
    if (!id) throw new Error(`"id" is required for ${action}`);
    const item = getWork(ctx.store, id) ?? getWorkByLegacyId(ctx.store, id);
    if (!item) throw new Error(`no work ${id}`);
    const until = new Date(Date.parse(at) + WORK_CLAIM_TERM_MS).toISOString();
    if (action === 'show') {
      const handoff = handoffOf(ctx.store, item.id);
      return { ...item, readiness: readinessOf(ctx.store, item, at), structure: workStructure(ctx.store, item), leases: leasesFor(ctx.store, item.id), handoff: handoff ? handoffAsData(handoff) : null };
    }
    if (action === 'update') {
      return updateWork(ctx.store, {
        id: item.id,
        expectedRevision: item.revision,
        at,
        actor: ctx.actor,
        title,
        description,
        acceptance,
        risk,
        premises: sources ? { sources } : undefined,
      });
    }
    if (action === 'requalify') {
      if (!reason) throw new Error('requalify needs a reason: what was checked against the changed source');
      return requalifyWork(ctx.store, { id: item.id, reason, at, actor: ctx.actor });
    }
    if (action === 'link') return linkWork(ctx.store, { id: item.id, parentId: parent, serves, blockedBy, related, at, actor: ctx.actor, nextId: ctx.nextId });
    if (action === 'unlink') return unlinkWork(ctx.store, { id: item.id, parent: removeParent, blockedBy, related, at, actor: ctx.actor });
    const who = claimantFor(ctx, agent, at);
    if (action === 'handoff') {
      if (!token) throw new Error('"token" is required for handoff: the one your claim returned');
      if (!packet) throw new Error('"packet" is required for handoff: at least state and next');
      return handoffWork(ctx.store, { id: item.id, owner: who.owner, token, packet, to, now: at });
    }
    if (action === 'accept') {
      const taken = acceptWork(ctx.store, { id: item.id, ...who, until, now: at });
      return { ...taken, handoff: handoffAsData(taken.handoff) };
    }
    if (action === 'claim') return claimWorkItem(ctx.store, { id: item.id, ...who, until, now: at, token, paths, mode });
    if (action === 'complete') return completeWork(ctx.store, { id: item.id, owner: who.owner, token, at, reason });
    if (action === 'release') {
      if (!token) throw new Error('"token" is required for release: the one your claim returned');
      return releaseWork(ctx.store, { id: item.id, owner: who.owner, token, at });
    }
    if (action === 'takeover') {
      if (!reason) throw new Error('takeover needs a reason');
      return takeoverWork(ctx.store, { id: item.id, ...who, until, now: at, reason, processAlive: ctx.processAlive });
    }
    if (!reason) throw new Error('reopen needs a reason');
    return reopenWork(ctx.store, { id: item.id, actor: ctx.actor, at, reason });
  },
});

const heartbeat = define<{ stepRunId: string; token: string }, unknown>({
  name: 'heartbeat',
  title: 'Keep a lease alive',
  description: 'The session working a claimed step says so, so its lease is not taken over. Any call from the session also extends its leases; this is for a long step with no other call. Fails if the lease was already lost.',
  surface: 'both',
  readOnly: false,
  inputSchema: {
    type: 'object',
    properties: {
      stepRunId: { type: 'string', description: 'From the claim.' },
      token: { type: 'string', description: 'From the claim: the lease’s secret.' },
      owner: { type: 'string', description: 'Ignored: the lease holder is the calling session.' },
    },
    required: ['stepRunId', 'token'],
    additionalProperties: false,
  },
  validate(raw) {
    closed(raw, this.inputSchema);
    return { stepRunId: str(raw, 'stepRunId')!, token: leaseToken(raw) };
  },
  run(ctx, { stepRunId, token }) {
    const at = ctx.now();
    const until = new Date(Date.parse(at) + 30 * 60_000).toISOString();
    if (!extendLease(ctx.store, { id: stepRunId, owner: ctx.host.executorId, nonce: token, until, at })) {
      throw new Error(`step ${stepRunId} is not held by this session under that token`);
    }
    return { leaseUntil: until };
  },
});

const claimStep = define<{ runId?: string }, unknown>({
  name: 'claim_step',
  title: 'Claim a pre-resolved step',
  description: 'A configured runner takes the next ready step of a run that was already resolved and gated. Returns the step, inputs, bound skill, and instructions, or what the run waits on. A step above this runner’s tier or beyond its capabilities is refused, with why.',
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
    return { work: { stepRunId: p.leased.id, owner: p.leased.leaseOwner, token: p.leased.nonce, leaseUntil: p.leased.leaseUntil, run: { id: p.run.id, workflow: p.run.workflowId }, step: { id: p.step.id, title: p.step.title, tier: p.step.tier, outputs: p.step.outputs, validators: p.step.validators }, skill: p.skill ? { id: p.skill.id, version: p.skill.version, body: p.skill.body() } : null, inputs: p.inputs, instructions: p.instructions }, waitingOn: null };
  },
});

/** Every tool, in the order a host sees them. */
export const TOOLS: readonly Tool<unknown, unknown>[] = [
  bootstrap, classify, projectContext, remember, workflows, skills, startOutcome, claimWork, submitWork, runStatus, inbox, decide, sources, staff, promote, work, delegate, claimStep, heartbeat,
] as unknown as readonly Tool<unknown, unknown>[];

export function toolsFor(surface: 'interactive' | 'headless'): readonly Tool<unknown, unknown>[] {
  return TOOLS.filter((t) => t.surface === 'both' || t.surface === surface);
}

/** What the headless surface must never be able to do, by tool name. */
export const HEADLESS_FORBIDDEN: readonly string[] = ['remember', 'start_outcome', 'decide', 'promote_deliverable', 'sources', 'skills', 'workflows', 'project_context', 'staff', 'claim_work', 'classify_request', 'work', 'delegate'];
