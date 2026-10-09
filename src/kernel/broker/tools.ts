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
import { listEntities, listClaims, listRelations } from '../state/graph.ts';
import { listDriftFindings } from '../state/drift.ts';
import { extendLease, getStep, heldLease } from '../state/steps.ts';
import { lockStatus } from '../registry/lockfile.ts';
import { qualifySkill } from '../registry/qualification.ts';
import { emptyLock } from '../project/lock.ts';
import { constitutionCompleteness } from '../project/constitution.ts';
import { TIER_POLICIES } from '../policy/lattice.ts';
import { STATEMENT_KINDS, type StatementKind } from '../state/profile.ts';
import { getDeliverable, TRUST_STATES, type TrustState } from '../state/deliverables.ts';
import type { BrokerContext } from './context.ts';
import { bool, closed, list, num, obj, record, str, type JsonSchema, type ToolDefinition, ToolInputError } from './definition.ts';
import { getSession, recordAgent } from '../state/sessions.ts';
import { PERSON_ONLY_TRUST, PersonChannelRequiredError, personStepFor } from '../policy/channels.ts';
import { LEASE_MODES, MAIN_LANE, findOverlaps, leasesFor, normalizeLeasePath, type LeaseMode, type Overlap } from '../work/leases.ts';
import { asPeerData, type Handoff, type PeerData } from '../work/handoff.ts';
import { coordinationFor, presentSessions, recentActivity } from '../coord/awareness.ts';
import { acceptWork, claimWork as claimWorkItem, completeWork, handoffOf, handoffWork, listOffers, getWork, getWorkByLegacyId, listReady, queryWork, readinessOf, releaseWork, reopenWork, takeoverWork, updateWork, requalifyWork } from '../work/service.ts';
import { fileWork, linkWork, unlinkWork, workStructure } from '../work/structure.ts';
import { provenanceOf, type RefResolver } from '../project/evidence.ts';
import { runValidators } from '../workflow/validators.ts';
import { checkSlot, PERIOD_RELATIVES, PERIOD_SEMANTICS, resolvePeriod, type PeriodSpec, type ResolvedPeriod } from '../registry/slots.ts';
import { inputProblems } from '../registry/resolver.ts';
import type { RegisteredWorkflow } from '../registry/models.ts';
import { differsNext, OBJECTION_DISPOSITIONS, OBJECTIONS_EXAMPLE, readObjections, VALIDATED_BY_CHECKS, type Objection, type StartResult } from '../workflow/service.ts';
import { askedOf, type Assumption, type Declared, type JudgedBy } from '../workflow/asked.ts';
import { STAKE_AREAS } from '../workflow/consequence.ts';
import {
  CORE_EXAMPLE, COORDINATION_ACTIONS, COORDINATION_NEXT, DESTINATION_KINDS, GENERAL_CARRIER, INTAKE_KINDS, IntakeError, OPEN_ABOUT, SOURCE_ROLES,
  destinationConflict, matchWorkflows, questionsFor, slotQuestion, validateIntake, workflowInputFor,
  type Intake, type IntakeCatalog, type ValidatedIntake, type WorkflowMatch,
} from '../workflow/intake.ts';
import { settledConstraintText, settledTerms } from '../project/governance.ts';
import { listLiveDeliverables } from '../state/deliverables.ts';
import { appendActivity } from '../state/activity.ts';
import { skillQuality } from '../state/quality.ts';
import { projectResolver as resolverFor } from '../source/resolver.ts';
import { ensureSourceEntities } from '../source/entities.ts';
import { locatorProblem } from '../source/locators.ts';
import { getSource } from '../state/sources.ts';
import { SOURCE_ID, locatorCarriesCredentials } from '../project/sources-file.ts';
import { urlProblem } from '../project/urls.ts';
import { redact } from '../render/redact.ts';
import { REPORTED_TEXT_CAP } from '../source/service.ts';

/** What a step may cite in this project, as it stands now. */
export function projectResolver(ctx: BrokerContext): RefResolver {
  return resolverFor(ctx.store, ctx.root, null, { hostReads: ctx.policy?.hostReads ?? 'require' });
}

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
  async run(ctx) {
    const at = ctx.now();
    const moved: string[] = [];
    const hostRead: string[] = [];
    for (const s of ctx.sources.list()) {
      if (!ctx.sources.canRead(s.id)) {
        const f = ctx.sources.status(s.id, at).freshness;
        if (f === 'never_read' || f === 'stale') hostRead.push(s.id);
      } else if ((await ctx.sources.peek(s.id)) === true) moved.push(s.id);
    }
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
      : moved.length > 0 ? `${moved.join(', ')} changed since last read; refresh with sources before relying on them`
      : drift.length > 0 ? `${String(drift.length)} drift finding(s) open; read them with project_context drift and tell the person`
      : 'listen: answer questions plainly, remember what the person asks to keep, start an outcome when asked for work';
    return {
      construct: { version: ctx.version, project: { root: ctx.root, id: ctx.files.config?.id ?? null, name: ctx.files.config?.name ?? null, lane: ctx.lane } },
      session: { host: ctx.host.hostId, session: ctx.sessionId ?? ctx.host.sessionId, executor: ctx.host.executorId, actor: ctx.actor },
      profile: { onboarding: profile?.onboardingState ?? 'incomplete', missing, openQuestions: onboarding.map((d) => ({ id: d.id, question: d.question, options: d.options })), proposals },
      // Sources only the host can read: when it reads them, it reports what it read so changes are tracked.
      sources: { ...sources, changedSinceRead: moved, reportWhenRead: hostRead },
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

const TOPICS = ['summary', 'constitution', 'sources', 'decisions', 'runs', 'entities', 'claims', 'relations', 'drift', 'statements', 'quality', 'work', 'sessions', 'activity'] as const;

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
      case 'quality':
        return page(skillQuality(ctx.store), (q) => `${q.skill} ${q.version}`, query, limit);
      default:
        return null;
    }
  },
});

const remember = define<{ kind: StatementKind; text: string; assumptions: string[]; replaces?: string; contradicts: string[] }, unknown>({
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
      contradicts: { type: 'array', items: { type: 'string' }, description: 'For a decision: short terms it rules out ("exactly-once"), so later work stating them as current is caught. Only terms the person named.' },
    },
    required: ['kind', 'text'],
    additionalProperties: false,
  },
  validate(raw) {
    closed(raw, this.inputSchema);
    const assumptions = list(raw, 'assumptions').filter((a): a is string => typeof a === 'string' && a.trim().length > 0);
    const contradicts = list(raw, 'contradicts').filter((x): x is string => typeof x === 'string' && x.trim().length >= 3).map((x) => x.trim());
    return { kind: str(raw, 'kind', { oneOf: STATEMENT_KINDS })! as StatementKind, text: str(raw, 'text')!, assumptions, replaces: str(raw, 'replaces', { optional: true }), contradicts };
  },
  run(ctx, input) {
    // The person asked the model to keep this; the record says the model relayed it.
    const s = ctx.workflow.remember({ kind: input.kind, text: input.text, assumptions: input.assumptions, replaces: input.replaces, by: ctx.actor, channel: 'relay' });
    // Each ruled-out term becomes a checkable constraint tied to the decision; that is all that is created.
    const rules = input.kind === 'decision' ? input.contradicts.map((term) => ctx.workflow.remember({ kind: 'constraint', text: settledConstraintText(term, s.id), assumptions: [], by: ctx.actor, channel: 'relay' })) : [];
    return { remembered: { id: s.id, kind: s.kind, text: s.text, at: s.createdAt, channel: s.channel }, rulesOut: rules.map((r) => ({ id: r.id, text: r.text })), nothingElseCreated: true };
  },
});

/** When to call classify_request and what to send, with the built-in deliverable kinds by family. */
const CLASSIFY_DESCRIPTION = [
  'Call this when the person wants something produced, reviewed, kept up on a schedule, or handed to another agent, however they phrase it, questions included ("can you put together…").',
  'A plain question needs no call; the remember and work tools are called directly.',
  'Report your own reading: Construct does not read intent from the words.',
  'It checks the reading, works out periods and source ids, names the workflows whose declared deliverable fits, returns only the questions that block, and records nothing.',
  'kind: answer, remember, manage (produce or review something), maintain (keep it up on a schedule or an event), or coordinate (work alongside other agents).',
  'For manage or maintain, give deliverable: a listed kind, or other with describe.',
  'Listed kinds: review/ challenge, architecture, delivery-plan, design-conformance, experience, implementation, operational-readiness, product, security-privacy, strategy-execution, drift, standing; document/ prd, rfc, proposal, revision; research/brief; memo/issue-spotting; constitution/review; publication; anything else: other with describe.',
  'Prefer period.relative or quarter over computing dates.',
  'Example: {"kind":"manage","words":"<their words>","deliverable":{"kind":"other","describe":"architecture diagram"},"period":{"semantics":"evidence_window","from":"2026-07-01","to":"2026-09-30","phrase":"only covering 2026-07-01 to 2026-09-30"},"sources":[{"name":"Jira","role":"read"}]}.',
  'Then ask the person every returned question in one message, and call start_outcome with the returned intake.',
].join(' ');

/** The typed reading a host reports, closed at every level; its vocabularies are the ones that never change with the registry. */
const INTAKE_SCHEMA: JsonSchema = {
  type: 'object',
  properties: {
    words: { type: 'string', description: 'The person’s request, verbatim.' },
    kind: { type: 'string', description: 'What they ask for.', enum: INTAKE_KINDS },
    deliverable: {
      type: 'object',
      description: 'For manage or maintain: what they want back.',
      properties: {
        kind: { type: 'string', description: 'A listed kind, a family, or other.' },
        describe: { type: 'string', description: 'In a few words; required with other.' },
      },
      required: ['kind'],
      additionalProperties: false,
    },
    skill: { type: 'string', description: 'The skill whose method fits, by id.' },
    workflowId: { type: 'string', description: 'A workflow to start, if you know it.' },
    target: { type: 'string', description: 'The document, file or system worked on.' },
    scope: { type: 'string', description: 'What it covers, if narrower.' },
    period: {
      type: 'object',
      description: 'The period they named.',
      properties: {
        semantics: { type: 'string', description: 'as_of: how things stood at its end; changed_during: what changed in it; evidence_window: only evidence dated in it.', enum: PERIOD_SEMANTICS },
        relative: { type: 'string', description: 'Relative to today.', enum: PERIOD_RELATIVES },
        n: { type: 'number', description: 'Days, for last_n_days.' },
        quarter: { type: 'number', description: '1 to 4.' },
        year: { type: 'number', description: 'Four digits.' },
        from: { type: 'string', description: 'YYYY-MM-DD.' },
        to: { type: 'string', description: 'YYYY-MM-DD.' },
        timezone: { type: 'string', description: 'IANA, such as Europe/Berlin.' },
        phrase: { type: 'string', description: 'Their words for it.' },
      },
      required: ['semantics'],
      additionalProperties: false,
    },
    sources: {
      type: 'array',
      description: 'The systems they named.',
      items: {
        type: 'object',
        properties: {
          name: { type: 'string', description: 'As named, such as Jira.' },
          id: { type: 'string', description: 'Its declared id, if any.' },
          role: { type: 'string', description: 'read (the default) or subject.', enum: SOURCE_ROLES },
        },
        required: ['name'],
        additionalProperties: false,
      },
    },
    destination: {
      type: 'object',
      description: 'Where the result goes.',
      properties: {
        kind: { type: 'string', description: 'What kind of place.', enum: DESTINATION_KINDS },
        ref: { type: 'string', description: 'A file path, a place in the source, or an address.' },
        name: { type: 'string', description: 'For registered_source: its id.' },
      },
      required: ['kind'],
      additionalProperties: false,
    },
    schedule: {
      type: 'object',
      description: 'For maintain: when it runs.',
      properties: {
        cron: { type: 'string', description: 'Five fields.' },
        timezone: { type: 'string', description: 'IANA; required with cron.' },
        event: { type: 'string', description: 'An event name.' },
        phrase: { type: 'string', description: 'Their words for it.' },
      },
      additionalProperties: false,
    },
    coordination: { type: 'string', description: 'For coordinate: which action.', enum: COORDINATION_ACTIONS },
    stakes: {
      type: 'object',
      description: 'What it touches; only raises rigor.',
      properties: {
        reversible: { type: 'boolean', description: 'False when it is hard to undo.' },
        affects: { type: 'array', description: 'What it touches.', items: { type: 'string', enum: STAKE_AREAS } },
      },
      additionalProperties: false,
    },
    open: {
      type: 'array',
      description: 'What the conversation leaves open.',
      items: {
        type: 'object',
        properties: {
          about: { type: 'string', description: 'What it is about.', enum: OPEN_ABOUT },
          question: { type: 'string', description: 'As you would put it to the person.' },
          blocking: { type: 'boolean', description: 'True when work cannot start without it.' },
          assumption: { type: 'string', description: 'If not blocking, what you take as given.' },
        },
        required: ['question', 'blocking'],
        additionalProperties: false,
      },
    },
    inputs: { type: 'object', description: 'Workflow inputs by their own keys.' },
  },
  required: ['words', 'kind'],
  additionalProperties: false,
};

/** What a reading is checked against in this project, now. */
function intakeCatalog(ctx: BrokerContext): IntakeCatalog {
  return {
    workflows: ctx.workflows.list(),
    skills: ctx.skills.list(),
    sources: ctx.sources.list().map((s) => ({ id: s.id, kind: s.kind, locator: s.locator })),
    at: ctx.now(),
    projectRoot: ctx.root,
  };
}

/** A reading the host model can fix comes back as wrong input naming the field. */
function fromIntake<T>(fn: () => T): T {
  try {
    return fn();
  } catch (error) {
    if (error instanceof IntakeError) throw new ToolInputError(error.message, { field: error.field, ...(error.allowed ? { allowed: error.allowed } : {}), example: error.example });
    throw error;
  }
}

/** What the host declared beside the workflow input: the inputs to every later judgment. */
function declaredOf(intake: Intake): Declared {
  return { stakes: intake.stakes, chosenSkill: intake.skill, words: intake.words };
}

/** The host that reported the reading, and the client it named at the handshake. */
function judgedByHost(ctx: BrokerContext): JudgedBy {
  return { by: 'host', host: ctx.host.hostId, client: ctx.sessionId ? getSession(ctx.store, ctx.sessionId)?.clientName ?? null : null };
}

/**
 * A workflow's input from the reading. Inputs given by a workflow's own keys
 * belong to the first match; another match takes only the ones it declares.
 * When the reading's destination and a given one disagree, the person's
 * question settles it and neither is mapped.
 */
function mappedInput(intake: Intake, workflow: RegisteredWorkflow, explicit: Readonly<Record<string, unknown>>, own: boolean): { readonly input: Record<string, unknown>; readonly missing: readonly string[] } {
  const declared = Object.keys(workflow.manifest.inputSchema);
  const reading = own ? intake : { ...intake, inputs: Object.fromEntries(Object.entries(intake.inputs).filter(([k]) => declared.includes(k))) };
  return fromIntake(() => workflowInputFor(destinationConflict(reading, explicit) ? { ...reading, destination: null } : reading, workflow, explicit));
}

/** A skill's use-when text: its first sentence, at most 200 characters. */
function firstSentence(text: string, cap = 200): string {
  const flat = text.replace(/\s+/g, ' ').trim();
  const end = flat.search(/[.!?](?:\s|$)/);
  const sentence = end >= 0 ? flat.slice(0, end + 1) : flat;
  return sentence.length <= cap ? sentence : `${sentence.slice(0, cap - 1).trimEnd()}…`;
}

/** The skills the matches bind, and the chosen one; for the general carrier with no method chosen, every method and professional skill. */
function skillCatalog(ctx: BrokerContext, intake: Intake, found: readonly WorkflowMatch[]): Record<string, { title: string; category: string; useWhen: string }> {
  const ids = new Set<string>([...(intake.skill ? [intake.skill] : []), ...found.flatMap((m) => m.skills)]);
  if (found[0]?.workflowId === GENERAL_CARRIER && intake.skill === null) {
    for (const s of ctx.skills.list()) if (s.manifest.category === 'method' || s.manifest.category === 'professional') ids.add(s.manifest.id);
  }
  const out: Record<string, { title: string; category: string; useWhen: string }> = {};
  for (const id of ids) {
    const s = ctx.skills.get(id);
    if (s) out[id] = { title: s.manifest.title, category: s.manifest.category, useWhen: firstSentence(s.description) };
  }
  return out;
}

/** The command the person runs to put a standing workflow on a clock; only values Construct checked are filled in. */
function scheduleCommand(workflowId: string, schedule: Intake['schedule']): string {
  const event = schedule?.event && /^[A-Za-z0-9._:-]+$/.test(schedule.event) ? schedule.event : null;
  if (event && !schedule?.cron) return `construct workflow schedule ${workflowId} --event=${event}`;
  const cron = schedule?.cron && /^[A-Za-z0-9*,/\- ]+$/.test(schedule.cron) ? schedule.cron : '…';
  return `construct workflow schedule ${workflowId} --cron='${cron}' --timezone=${schedule?.timezone ?? '…'}`;
}

/** The one instruction classify_request ends on. */
function classifyNext(validated: ValidatedIntake, first: string | null, open: number, challenge: boolean): string {
  const { intake } = validated;
  if (intake.kind === 'answer') return 'Answer in chat. Nothing was recorded.';
  if (intake.kind === 'remember') return 'Call remember with the person’s wording and the kind of statement it is. Nothing else is created.';
  if (intake.kind === 'coordinate') return COORDINATION_NEXT[intake.coordination!];
  const unregistered = validated.resolved.sources.filter((s) => !s.registered && !s.candidates?.length).length;
  const prefix = unregistered > 0
    ? `${String(unregistered)} of the systems in your reading ${unregistered === 1 ? 'is' : 'are'} not registered with Construct; declare each one the person named with sources action declare, then report what you read before citing it. `
    : '';
  if (first === null) {
    return `${prefix}No workflow here produces ${intake.deliverable?.kind ?? 'this'} ${intake.kind === 'maintain' ? 'on a schedule or an event; tell the person, and offer to run it once now instead (kind manage)' : 'for this reading; tell the person what the listed workflows can do instead'}.`;
  }
  if (open > 0) return `${prefix}Put these ${String(open)} question(s) to the person in one message, then call start_outcome with workflowId "${first}" and this intake with their answers applied.`;
  return `${prefix}Call start_outcome with workflowId "${first}" and this intake, or another match whose skills fit better.${challenge ? ' This work must be challenged before it is accepted.' : ''}${intake.kind === 'maintain' ? ` The person sets the clock: ${scheduleCommand(first, intake.schedule)}` : ''}`;
}

const classify = define<Record<string, unknown>, unknown>({
  name: 'classify_request',
  title: 'Report your reading of a request',
  description: CLASSIFY_DESCRIPTION,
  surface: 'interactive',
  readOnly: true,
  inputSchema: INTAKE_SCHEMA,
  validate(raw) {
    try {
      closed(raw, this.inputSchema);
    } catch (error) {
      // The person's words go in words, with the reading beside them.
      if (error instanceof ToolInputError && error.field === 'text') {
        throw new ToolInputError('"text" is not an input of this tool: put the person’s words, verbatim, in "words", with your reading of them beside it', { field: 'text', allowed: Object.keys(this.inputSchema.properties), example: CORE_EXAMPLE });
      }
      throw error;
    }
    return raw;
  },
  run(ctx, raw) {
    const catalog = intakeCatalog(ctx);
    const validated = fromIntake(() => validateIntake(raw, catalog, 'classify'));
    const { intake } = validated;
    const declared = declaredOf(intake);
    const found = matchWorkflows(intake, catalog);
    const checked = found.map((m, i) => {
      const { input, missing } = mappedInput(intake, ctx.workflows.get(m.workflowId)!, {}, i === 0);
      const { preflight } = ctx.workflow.preflight(m.workflowId, input, { declared });
      return {
        match: { workflowId: m.workflowId, title: m.title, deliverableKind: m.deliverableKind, because: m.because, status: preflight.status, summary: preflight.summary, reasons: preflight.reasons, approvalsAhead: preflight.approvalsAhead, input, missing },
        judgment: preflight.judgment,
      };
    });
    const { questions, hostQuestions } = fromIntake(() => questionsFor(validated, found[0] ?? null, catalog));
    const judgment = checked[0]?.judgment ?? ctx.workflow.judge({ workflowId: null, input: {}, declared });
    return {
      recorded: false,
      judgedBy: judgedByHost(ctx),
      kind: intake.kind,
      intake,
      resolved: validated.resolved,
      normalized: validated.normalized,
      matches: checked.map((c) => c.match),
      skills: skillCatalog(ctx, intake, found),
      questions,
      hostQuestions,
      assumptions: validated.assumptions,
      flags: validated.flags,
      judgment,
      next: classifyNext(validated, found[0]?.workflowId ?? null, questions.length + hostQuestions.length, judgment.challenge),
    };
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
    if (!id) throw new ToolInputError(`"id" is required for ${action}`, { field: 'id' });
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
    if (!id) throw new ToolInputError('"id" is required for show', { field: 'id' });
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

const NOTHING_STARTED = 'Nothing started. Put these to the person in one message, then call start_outcome again with their answers.';

/** Input a workflow refuses: an undeclared key, or a value its type does not take. Each comes back naming input.<key>. */
function refuseWrongInput(ctx: BrokerContext, workflow: RegisteredWorkflow, input: Readonly<Record<string, unknown>>): void {
  const m = workflow.manifest;
  const declared = Object.keys(m.inputSchema);
  const slotContext = { at: ctx.now(), sourceIds: ctx.sources.list().map((s) => s.id) };
  for (const [key, value] of Object.entries(input)) {
    const problems = inputProblems({ ...m, requiredInputs: [] }, { [key]: value }, slotContext);
    if (problems.length === 0) continue;
    throw new ToolInputError(`${problems.map((p) => p.message).join('; ')}. ${problems[0]!.remedy}`, { field: `input.${key}`, ...(declared.includes(key) ? {} : { allowed: declared }) });
  }
}

/** Workflows a session can start: manage or maintain, started by hand. */
function startable(w: RegisteredWorkflow): boolean {
  return (w.manifest.interactionClass === 'manage' || w.manifest.interactionClass === 'maintain') && w.manifest.triggers.includes('manual');
}

function startedResult(r: StartResult, normalized: readonly unknown[], assumptions: readonly Assumption[]): Record<string, unknown> {
  return {
    started: true,
    run: { id: r.run.id, state: r.run.state, workflow: r.run.workflowId },
    created: r.created,
    preflight: r.preflight,
    differs: r.differs,
    superseded: r.superseded,
    normalized,
    assumptions,
    ...(r.differs.length > 0 ? { next: differsNext(r.differs) } : {}),
  };
}

const startOutcome = define<{ workflowId: string; input?: Record<string, unknown>; intake?: Record<string, unknown> }, unknown>({
  name: 'start_outcome',
  title: 'Start an outcome',
  description: 'Start a workflow run in this session. Pass the intake classify_request returned, with the person’s answers applied; Construct checks it again here, so skipping classify_request skips no check, and if a required detail or a blocking question is still open nothing starts and you get the questions back. Without an intake, pass the workflow input yourself. If this work is already running you get that run back, with what you gave differently named. Returns the run and what it needs; then call claim_work to do the next step here. Never start work for a plain question.',
  surface: 'interactive',
  readOnly: false,
  inputSchema: {
    type: 'object',
    properties: {
      workflowId: { type: 'string', description: 'Which workflow: one classify_request matched.' },
      input: { type: 'object', description: 'Workflow inputs by their keys; with an intake, only what the reading does not carry.' },
      intake: { type: 'object', description: 'The intake classify_request returned, with the person’s answers applied; Construct checks it again.' },
    },
    required: ['workflowId'],
    additionalProperties: false,
  },
  validate(raw) {
    closed(raw, this.inputSchema);
    const workflowId = str(raw, 'workflowId')!;
    const input = obj(raw, 'input', { optional: true });
    const intake = obj(raw, 'intake', { optional: true });
    if (!input && !intake) {
      throw new ToolInputError('give "intake", the reading classify_request returned with the person’s answers applied, or "input", the workflow input', { field: 'intake', example: { intake: CORE_EXAMPLE } });
    }
    return { workflowId, ...(input ? { input } : {}), ...(intake ? { intake } : {}) };
  },
  run(ctx, { workflowId, input, intake }) {
    const explicit = input ?? {};
    if (intake) {
      // The reading is checked again here: a start never rests on a check the host may have skipped.
      const catalog = intakeCatalog(ctx);
      const validated = fromIntake(() => validateIntake(intake, catalog, 'start'));
      const matches = matchWorkflows(validated.intake, catalog);
      const match = matches.find((m) => m.workflowId === workflowId);
      if (!match) throw new ToolInputError(`${workflowId} does not carry this reading; start one of the workflows it matched`, { field: 'workflowId', allowed: matches.map((m) => m.workflowId) });
      const workflow = ctx.workflows.get(workflowId)!;
      const { input: mapped } = mappedInput(validated.intake, workflow, explicit, true);
      refuseWrongInput(ctx, workflow, mapped);
      const { questions, hostQuestions } = fromIntake(() => questionsFor(validated, match, catalog, explicit));
      if (questions.length > 0 || hostQuestions.length > 0) {
        return { started: false, recorded: false, questions, hostQuestions, normalized: validated.normalized, next: NOTHING_STARTED };
      }
      const { intake: reading, resolved } = validated;
      const r = ctx.workflow.start({
        workflowId,
        input: mapped,
        trigger: 'manual',
        asked: {
          intake: reading,
          periodSpec: reading.period,
          sources: { registered: [...new Set(reading.sources.filter((s) => s.role === 'read' && s.id !== null).map((s) => s.id!))], named: resolved.sources.map((s) => ({ name: s.name, id: s.id, registered: s.registered })) },
          declared: declaredOf(reading),
          judgedBy: judgedByHost(ctx),
          assumptions: validated.assumptions,
        },
      });
      return startedResult(r, validated.normalized, validated.assumptions);
    }
    const workflow = ctx.workflows.get(workflowId);
    if (!workflow || !startable(workflow)) throw new ToolInputError(`no workflow "${workflowId}" can be started here`, { field: 'workflowId', allowed: ctx.workflows.list().filter(startable).map((w) => w.manifest.id) });
    refuseWrongInput(ctx, workflow, explicit);
    const missing = workflow.manifest.requiredInputs.filter((k) => explicit[k] === undefined);
    if (missing.length > 0) return { started: false, recorded: false, questions: missing.map((slot) => slotQuestion(slot, workflow)), hostQuestions: [], normalized: [], next: NOTHING_STARTED };
    const r = ctx.workflow.start({ workflowId, input: explicit, trigger: 'manual' });
    return startedResult(r, [], r.preflight.assumptions.map((text) => ({ about: 'period', text, by: 'kernel' as const })));
  },
});

const claimWork = define<{ runId?: string; includeSkillBody: boolean }, unknown>({
  name: 'claim_work',
  title: 'Claim the next step',
  description: 'Take the next ready step of a run to do in this session. Returns the step, its inputs, the skill bound to it (text on request), and instructions. If the run is waiting on a decision, returns that decision instead so you can surface it. A step the person approved for another session is held for it, and a step beyond what this session may do is refused; either comes back with who or why. A blocked run comes back with its reasons and what would unblock it.',
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
        intake: p.intake,
        method: p.method,
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
      // An excerpt is kept with the step, so it is kept without credentials, as recorded source text is.
      return { ref, excerpt: typeof r.excerpt === 'string' ? redact(r.excerpt) : undefined };
    });
    return { stepRunId: str(raw, 'stepRunId')!, token: leaseToken(raw), output: obj(raw, 'output')!, evidence, noData: bool(raw, 'noData', false) };
  },
  run(ctx, input) {
    if (!getStep(ctx.store, input.stepRunId)) throw new Error(`no step ${input.stepRunId}`);
    const leased = heldLease(ctx.store, { id: input.stepRunId, owner: ctx.host.executorId, nonce: input.token });
    if (!leased) throw new Error(`step ${input.stepRunId} is not held by this session under that token; claim it again`);
    const resolve = projectResolver(ctx);
    const r = ctx.workflow.submit({ leased, output: input.output, evidence: input.evidence, noData: input.noData, resolve });
    return {
      step: { id: r.step.id, state: r.step.state, reason: r.step.stateReason },
      validation: r.validation,
      // How much of this step rests on what Construct opened itself versus what the host reports it read.
      evidence: provenanceOf(input.evidence, resolve),
      run: { id: r.run.id, state: r.run.state },
      deliverable: r.deliverable ? { id: r.deliverable.id, trust: r.deliverable.trustState } : null,
      // Restated keys whose value differs from what the step was handed: the deliverable carries what was handed.
      ...(r.ignored.length > 0 ? { ignored: r.ignored } : {}),
    };
  },
});

/** A lease token as given: the claim's secret string. */
function leaseToken(raw: Record<string, unknown>): string {
  const token = raw.token;
  if (typeof token !== 'string' || !token.trim()) throw new ToolInputError('"token" is required: the token claim_work returned', { field: 'token' });
  return token.trim();
}

const runStatus = define<{ runId: string }, unknown>({
  name: 'run_status',
  title: 'Run status',
  description: 'Where a run stands: its state, each step, the deliverables and how far they are trusted, any decision it waits on, and what it was asked to cover (the period in dates, the sources it names, who judged the reading).',
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
    const asked = askedOf(v.run);
    return { run: { id: v.run.id, workflow: v.run.workflowId, state: v.run.state, reason: v.run.stateReason, preflight: v.run.preflight, asked: { period: asked.period ?? null, sources: asked.sources ?? null, judgedBy: asked.judgedBy ?? null } }, steps: v.steps.map((s) => ({ id: s.id, step: s.stepId, state: s.state, attempts: s.attempts, reason: s.stateReason })), deliverables: v.deliverables.map((d) => ({ id: d.id, kind: d.kind, trust: d.trustState, verification: d.verification, body: d.body })), openDecisions: v.openDecisions.map((d) => ({ id: d.id, kind: d.kind, question: d.question, options: d.options })) };
  },
});

const inbox = define<{ runId?: string; owner?: string }, unknown>({
  name: 'inbox',
  title: 'Decisions waiting on the person',
  description: 'The approvals, questions, and proposed statements that belong to the person, in plain words, with the options each accepts, and who decides each when the constitution names owners for that area. Surface them conversationally; never decide them yourself. Pass owner to see one person\'s (unowned items included).',
  surface: 'interactive',
  readOnly: true,
  inputSchema: { type: 'object', properties: { runId: { type: 'string', description: 'Only this run’s.' }, owner: { type: 'string', description: 'Only this owner’s, plus unowned ones.' } }, additionalProperties: false },
  validate(raw) {
    closed(raw, this.inputSchema);
    return { runId: str(raw, 'runId', { optional: true }), owner: str(raw, 'owner', { optional: true }) };
  },
  run(ctx, { runId, owner }) {
    const owners = ctx.files.constitution?.owners ?? [];
    return listInbox(ctx.store, runId)
      .map((row) => {
        const subject = row.kind === 'inbox_item' ? getDecision(ctx.store, row.id)?.subject ?? {} : {};
        return { ...row, owner: ownerFor(owners, `${row.question} ${JSON.stringify(subject)}`) };
      })
      .filter((d) => !owner || d.owner === null || d.owner.toLowerCase() === owner.toLowerCase());
  },
});

/**
 * Who decides a question, from the constitution's owners: the first owner one of whose "decides" areas the
 * question names. Owners live in a committed file, so everyone on the project routes the same way.
 */
export function ownerFor(owners: readonly { readonly name: string; readonly decides: readonly string[] }[], text: string): string | null {
  const t = text.toLowerCase();
  for (const o of owners) for (const area of o.decides) if (area.trim().length >= 3 && t.includes(area.trim().toLowerCase())) return o.name;
  return null;
}

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
      return { decision: { id: r.decision.id, state: r.decision.state, resolvedBy: r.decision.resolvedBy }, run: r.run ? { id: r.run.id, state: r.run.state } : null, ...followUp(ctx, existing, String(resolution)) };
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

const SOURCE_ACTIONS = ['list', 'show', 'refresh', 'report', 'declare'] as const;
/** Kinds a session may declare: systems the host reads with its own tools. Directory and git let Construct read files itself, so only the person adds those. */
const DECLARABLE_KINDS = ['github', 'jira', 'docs', 'hris', 'other'] as const;
const DECLARE_ONLY = ['kind', 'purpose', 'locator'] as const;
const DECLARED_PURPOSE = 'named by the person; declared by your assistant in this session';
const PURPOSE_CAP = 200;
const LOCATOR_CAP = 512;
const LOCATOR_EXAMPLES: Readonly<Record<string, string>> = { github: 'owner/repo', jira: 'PROJ', docs: 'confluence:space:ENG' };

interface SourcesInput {
  action: (typeof SOURCE_ACTIONS)[number];
  id?: string;
  items: Record<string, unknown>[];
  partial: boolean;
  kind?: (typeof DECLARABLE_KINDS)[number];
  purpose?: string;
  locator?: string;
}

/** A suggested id for a name that is not one yet: lowercase, dashes for anything else. */
function idExample(name: string): string {
  const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^[^a-z]+/, '').replace(/-+$/, '').slice(0, 64);
  return SOURCE_ID.test(slug) ? slug : 'jira';
}

function declareInput(raw: Record<string, unknown>, id: string | undefined): Pick<SourcesInput, 'id' | 'kind' | 'purpose' | 'locator'> {
  if (!id) throw new ToolInputError('"id" is required for declare: a short name for the system, such as jira or web', { field: 'id', example: 'jira' });
  if (!SOURCE_ID.test(id)) throw new ToolInputError('"id" is lowercase letters, digits and dashes, starting with a letter, at most 64 characters', { field: 'id', example: idExample(id) });
  const kind = raw.kind;
  if (kind === 'directory' || kind === 'git') {
    throw new ToolInputError('a directory or git source is declared by the person with construct source add, because it lets Construct read files itself', { field: 'kind', allowed: DECLARABLE_KINDS, example: 'other' });
  }
  const k = str(raw, 'kind', { oneOf: DECLARABLE_KINDS }) as SourcesInput['kind'];
  const rawPurpose = str(raw, 'purpose', { optional: true });
  const purpose = rawPurpose?.replace(/[\u0000-\u001f\u007f\s]+/g, ' ').trim();
  if (purpose !== undefined && purpose.length > PURPOSE_CAP) throw new ToolInputError(`"purpose" is one sentence of at most ${String(PURPOSE_CAP)} characters`, { field: 'purpose' });
  const locator = str(raw, 'locator', { optional: true })?.trim() || undefined;
  if (locator !== undefined) {
    const example = LOCATOR_EXAMPLES[k!];
    if (locator.length > LOCATOR_CAP || /[\u0000-\u001f\u007f]/.test(locator)) throw new ToolInputError(`"locator" is one line of at most ${String(LOCATOR_CAP)} characters`, { field: 'locator', example });
    if (locatorCarriesCredentials(locator)) throw new ToolInputError('"locator" carries credentials; your connector holds them, and Construct never records them', { field: 'locator', example });
    const problem = locatorProblem(k!, locator);
    if (problem) throw new ToolInputError(problem, { field: 'locator', example });
  }
  return { id, kind: k, purpose: purpose || undefined, locator };
}

const sources = define<SourcesInput, unknown>({
  name: 'sources',
  title: 'Sources',
  description: 'The systems and documents this project reads: what each is for, what it is trusted to settle, whether it is reachable and fresh. Declare a system the person named (a tracker, a wiki, chat, a monitoring tool) with action declare before reporting what you read from it; pages from the open web go under one source named web with kind other. Refresh reads one now and records whether it changed. Report records what you read from a source Construct cannot read itself (a live tracker, a wiki) through your own tools, so changes there are tracked and finished work that cited them is flagged: give each item its ref (a key or page id), its url when it has one, title, updatedAt, and the text you read; set partial when you read only some items. Report only items you cite, with the passage you rely on.',
  surface: 'interactive',
  readOnly: false,
  inputSchema: {
    type: 'object',
    properties: {
      action: { type: 'string', description: 'list, show, refresh, report, or declare.', enum: SOURCE_ACTIONS },
      id: { type: 'string', description: 'The source id, for show, refresh, report, and declare: lowercase letters, digits and dashes, starting with a letter.' },
      items: { type: 'array', description: 'For report: {ref, url?, title?, updatedAt?, text?, kind?} for each item you read; url is the http(s) address a person would open for it.', items: { type: 'object' } },
      partial: { type: 'boolean', description: 'For report: you read only some of the source; items you did not report are kept, not treated as removed.' },
      kind: { type: 'string', description: 'For declare: what kind of system it is; other covers chat, monitoring tools, and the open web.', enum: DECLARABLE_KINDS },
      purpose: { type: 'string', description: 'For declare: what the person uses it for, in one sentence.' },
      locator: { type: 'string', description: 'For declare, when the system has one: where it is (PROJ for jira, owner/repo for github, provider:container:id for docs). Never credentials.' },
    },
    required: ['action'],
    additionalProperties: false,
  },
  validate(raw) {
    closed(raw, this.inputSchema);
    const action = str(raw, 'action', { oneOf: SOURCE_ACTIONS }) as SourcesInput['action'];
    const id = str(raw, 'id', { optional: true });
    const items = list(raw, 'items').map((e) => record(e));
    const partial = bool(raw, 'partial', false);
    if (action === 'declare') return { action, items, partial, ...declareInput(raw, id) };
    for (const key of DECLARE_ONLY) {
      if (raw[key] !== undefined && raw[key] !== null) throw new ToolInputError(`"${key}" is for declare only`, { field: key });
    }
    return { action, id, items, partial };
  },
  async run(ctx, { action, id, items, partial, kind, purpose, locator }) {
    const at = ctx.now();
    if (action === 'list') return ctx.sources.list().map((s) => ctx.sources.status(s.id, at));
    if (!id) throw new ToolInputError(`"id" is required for ${action}`, { field: 'id' });
    const active = ctx.sources.list();
    if (action === 'declare') {
      if (active.some((s) => s.id === id)) return { declared: false, already: true, source: ctx.sources.status(id, at) };
      if (getSource(ctx.store, id)) throw new ToolInputError(`source "${id}" was retired; declare it under a new id`, { field: 'id', example: `${id}-2`.slice(0, 64) });
      // A declared source lives in this machine's state only, is treated as confidential, and settles nothing.
      ctx.store.transaction(() => {
        ctx.sources.addLocal({ id, kind: kind!, purpose: purpose ?? DECLARED_PURPOSE, locator: locator ?? null, authorityLevel: 'informative', authoritativeFor: [], notAuthoritativeFor: [], freshnessHours: null, sensitivity: 'confidential', read: true, write: false }, at);
        ensureSourceEntities(ctx.store, at, ctx.nextId);
        appendActivity(ctx.store, { at, kind: 'source.declared', actor: ctx.actor, payload: { sourceId: id, kind, by: 'relayed' } });
      });
      return {
        declared: true,
        source: { id, kind, origin: 'local', sensitivity: 'confidential', authority: 'informative' },
        next: 'Report what you read from it with sources action report (ref, url, updatedAt, and the passage you rely on) before citing it. It stays on this machine; the person can commit it with construct source add.',
      };
    }
    if (!active.some((s) => s.id === id)) {
      throw new ToolInputError(`no source "${id}" is declared; declare it with sources action declare (id, kind), then ${action === 'report' ? 'report again' : 'report what you read from it'}`, { field: 'id', allowed: active.map((s) => s.id) });
    }
    if (action === 'show') return ctx.sources.status(id, at);
    if (action === 'report') {
      if (items.length === 0) throw new ToolInputError('"items" is required for report: what you read, one entry per item', { field: 'items' });
      const parsed = items.map((i, n) => {
        if (typeof i.ref !== 'string' || i.ref.trim() === '') throw new ToolInputError(`items[${String(n)}] needs a ref`, { field: 'items' });
        const opt = (k: string) => (typeof i[k] === 'string' ? (i[k] as string) : undefined);
        const url = i.url === undefined || i.url === null ? undefined : typeof i.url === 'string' ? i.url.trim() : '';
        const problem = url === undefined ? null : urlProblem(url);
        if (problem) throw new ToolInputError(`items[${String(n)}].url ${problem}`, { field: `items[${String(n)}].url`, example: 'https://acme.atlassian.net/browse/PLAT-101' });
        return { ref: i.ref.trim(), title: opt('title'), kind: opt('kind'), updatedAt: opt('updatedAt'), text: opt('text'), ...(url !== undefined ? { url } : {}) };
      });
      const reported = ctx.sources.reportRead(id, { items: parsed, partial }, at, () => ctx.nextId('snap'));
      if (!reported.truncated?.length) return reported;
      return { ...reported, next: `Construct kept the first ${String(REPORTED_TEXT_CAP / 1024)} KiB of the text of ${reported.truncated.join(', ')}; a quote or figure past that cannot be checked, so report the passage you rely on as its own item.` };
    }
    return ctx.sources.refresh(id, at, () => ctx.nextId('snap'));
  },
});

/**
 * After the person answers a stale-work question, what starting the work they chose would look like. Nothing
 * starts on its own: the host offers it, and start_outcome runs only if the person wants it.
 */
function followUp(ctx: BrokerContext, decision: ReturnType<typeof getDecision>, resolution: string): { suggestedOutcomes?: { workflowId: string; input: Record<string, unknown>; why: string }[] } {
  const subject = (decision?.subject ?? null) as { deliverableIds?: string[]; driftFindingIds?: string[] } | null;
  if (!subject?.deliverableIds?.length) return {};
  const said = resolution.toLowerCase();
  const out: { workflowId: string; input: Record<string, unknown>; why: string }[] = [];
  for (const [i, deliverableId] of subject.deliverableIds.entries()) {
    const finding = subject.driftFindingIds?.[i] ? listDriftFindings(ctx.store, {}).find((f) => f.id === subject.driftFindingIds![i]) : undefined;
    const change = finding?.summary ?? 'material it drew on changed';
    if (said.startsWith('revise')) {
      const body = (listLiveDeliverablesFor(ctx, deliverableId)?.body ?? {}) as { artifact?: unknown };
      out.push({ workflowId: 'revise-deliverable', input: { deliverable: deliverableId, change, ...(typeof body.artifact === 'string' ? { target: body.artifact } : {}) }, why: `revise ${deliverableId} for: ${change}` });
    } else if (said.startsWith('re-run') || said.startsWith('rerun')) {
      const d = listLiveDeliverablesFor(ctx, deliverableId);
      const run = d ? listRuns(ctx.store, {}).find((x) => x.id === d.runId) : undefined;
      if (run) out.push({ workflowId: run.workflowId, input: (run.input ?? {}) as Record<string, unknown>, why: `run ${run.workflowId} again with its original input` });
    }
  }
  return out.length ? { suggestedOutcomes: out } : {};
}

function listLiveDeliverablesFor(ctx: BrokerContext, id: string) {
  return listLiveDeliverables(ctx.store).find((d) => d.id === id);
}

interface CheckAnswerInput {
  answer: string;
  citations: { ref: string; excerpt?: string }[];
  period?: Record<string, unknown>;
  outsidePeriod?: { ref: string; why: string }[];
}

/** The checks a plain answer gets: nothing that needs an artifact, a template, or a workflow's shape. */
export const ANSWER_CHECKS = ['citations_present', 'evidence_refs_resolve', 'excerpts_match', 'numbers_grounded', 'superseded_acknowledged', 'settled_not_contradicted'] as const;

const checkAnswer = define<CheckAnswerInput, unknown>({
  name: 'check_answer',
  title: 'Check an answer before giving it',
  description: 'Before you state facts about this project in a plain answer, pass the answer and what it rests on. Construct checks that each citation names something real, quotes match, figures come from what was cited, superseded documents are named as such, and, when the answer covers a period, that nothing cited was updated after it ends; it returns the problems. It starts nothing and records only that a check happened and how it went; fix what it finds or say plainly what you could not support.',
  surface: 'interactive',
  readOnly: false,
  inputSchema: {
    type: 'object',
    properties: {
      answer: { type: 'string', description: 'The answer you are about to give, as you would give it.' },
      citations: { type: 'array', description: 'What it rests on: {ref, excerpt?} entries.', items: { type: 'object' } },
      period: { type: 'object', description: 'The period the answer covers, when it covers one: {semantics: as_of | changed_during | evidence_window, and one of relative (such as last_quarter), quarter with or without year, year, or from and to as YYYY-MM-DD}.' },
      outsidePeriod: { type: 'array', description: 'Cited items updated after the period that belong in the answer anyway: {ref, why} entries.', items: { type: 'object' } },
    },
    required: ['answer'],
    additionalProperties: false,
  },
  validate(raw) {
    closed(raw, this.inputSchema);
    const citations = list(raw, 'citations').map((e) => {
      const r = record(e);
      return { ref: typeof r.ref === 'string' ? r.ref : '', excerpt: typeof r.excerpt === 'string' ? r.excerpt : undefined };
    });
    const period = obj(raw, 'period', { optional: true });
    const outsidePeriod = list(raw, 'outsidePeriod').map((e) => {
      const r = record(e);
      return { ref: typeof r.ref === 'string' ? r.ref : '', why: typeof r.why === 'string' ? r.why : '' };
    });
    return { answer: str(raw, 'answer')!, citations, ...(period ? { period } : {}), ...(outsidePeriod.length ? { outsidePeriod } : {}) };
  },
  run(ctx, { answer, citations, period: spec, outsidePeriod }) {
    // A period is checked and worked out at the moment of asking, before anything is recorded.
    let period: ResolvedPeriod | null = null;
    if (spec) {
      const at = ctx.now();
      const wrong = checkSlot('period', 'period', spec, { at, sourceIds: [] });
      if (wrong.length) throw new ToolInputError(`${wrong.map((p) => p.message).join('; ')}. ${wrong[0]!.remedy}`, { field: 'period', example: { semantics: 'changed_during', relative: 'last_quarter' } });
      period = resolvePeriod(spec as unknown as PeriodSpec, at);
    }
    const resolve = projectResolver(ctx);
    const settled = settledTerms(listStatements(ctx.store, { kind: 'constraint', status: 'confirmed' }));
    const checks: string[] = [...ANSWER_CHECKS, ...(period ? ['within_period'] : [])];
    const output = { summary: answer, ...(outsidePeriod ? { outsidePeriod } : {}) };
    const results = runValidators(checks, { output, expectedKeys: [], evidence: citations, resolvableRefs: new Set(), resolve, settled, period });
    const problems = results.flatMap((r) => r.problems.map((p) => ({ check: r.validator, problem: p })));
    // Counted, so how often answers are checked is something a person can see, not something to hope for.
    appendActivity(ctx.store, { at: ctx.now(), kind: 'answer.checked', actor: ctx.actor, payload: { ok: problems.length === 0, problems: problems.length, citations: citations.length } });
    // Admitted on the host's word alone (policy.hostReads accept): the person should hear which parts those are.
    const unverified = [...new Set(citations.filter((c) => resolve(c.ref)?.provenance === 'unverified').map((c) => c.ref))];
    const onWord = unverified.length === 0
      ? ''
      : `; no recorded read holds ${unverified.slice(0, 5).join(', ')}${unverified.length > 5 ? ` (+${String(unverified.length - 5)} more)` : ''}, so say the parts resting on ${unverified.length === 1 ? 'it' : 'them'} are unverified, or record what you read with sources action report and check again`;
    return {
      ok: problems.length === 0,
      problems,
      evidence: provenanceOf(citations, resolve),
      ...(period ? { period: { from: period.from, to: period.to, timezone: period.timezone, assumptions: period.assumptions } } : {}),
      next: (problems.length === 0
        ? 'give the answer; say which parts rest on reported sources if any'
        : 'fix what is listed, or give the answer with the unsupported parts named as unsupported') + onWord,
    };
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
    if (!id) throw new ToolInputError('"id" is required for show', { field: 'id' });
    const m = getStaffMember(ctx.store, id);
    if (!m) throw new Error(`no staff member ${id}`);
    return m;
  },
});

/** The trust states promote_deliverable moves a deliverable to: validated is set only by a step's passing checks. */
const PROMOTABLE = TRUST_STATES.filter((t) => t !== 'validated');

const promote = define<{ deliverableId: string; to: TrustState; reason?: string; objections?: readonly Objection[] }, unknown>({
  name: 'promote_deliverable',
  title: 'Move a deliverable’s trust',
  description: 'After the person has reviewed a deliverable: record a challenge with the objections it raised, or ask for their acceptance or to make it final. Accepted and final are the person’s own answer: Construct asks them directly when the host can, and otherwise the question waits in the inbox. Validated is set only by passing checks, never by this tool. A finished step never moves trust.',
  surface: 'interactive',
  readOnly: false,
  destructive: true,
  inputSchema: {
    type: 'object',
    properties: {
      deliverableId: { type: 'string', description: 'The deliverable id.' },
      to: { type: 'string', description: 'The trust state to move to.', enum: PROMOTABLE },
      reason: { type: 'string', description: 'Why, in the person’s words.' },
      objections: {
        type: 'array',
        description: 'For challenged: each objection the challenge raised and what was done about it (fixed, accepted, rejected, open); an empty list says it found nothing.',
        items: {
          type: 'object',
          properties: { objection: { type: 'string', description: 'What the challenge objected to.' }, disposition: { type: 'string', description: 'What was done about it.', enum: OBJECTION_DISPOSITIONS } },
          required: ['objection', 'disposition'],
          additionalProperties: false,
        },
      },
    },
    required: ['deliverableId', 'to'],
    additionalProperties: false,
  },
  validate(raw) {
    closed(raw, this.inputSchema);
    if (raw.to === 'validated') throw new ToolInputError(`${VALIDATED_BY_CHECKS}; move it to challenged, accepted, or another state`, { field: 'to', allowed: PROMOTABLE });
    const to = str(raw, 'to', { oneOf: PROMOTABLE }) as TrustState;
    const given = { deliverableId: str(raw, 'deliverableId')!, to, reason: str(raw, 'reason', { optional: true }) };
    if (to !== 'challenged') {
      if (raw.objections !== undefined) throw new ToolInputError('"objections" is only for to: challenged', { field: 'objections' });
      return given;
    }
    if (raw.objections === undefined || raw.objections === null) {
      throw new ToolInputError('"objections" is required for challenged: each objection the challenge raised and what was done about it; an empty list says it found nothing', { field: 'objections', example: OBJECTIONS_EXAMPLE });
    }
    const read = readObjections(raw.objections);
    if (!('objections' in read)) {
      const one = OBJECTIONS_EXAMPLE[0]!;
      const example = read.field.endsWith('.disposition') ? one.disposition : read.field.endsWith('.objection') ? one.objection : read.field === 'objections' ? OBJECTIONS_EXAMPLE : one;
      throw new ToolInputError(read.message, { field: read.field, ...(read.allowed ? { allowed: read.allowed } : {}), example });
    }
    return { ...given, objections: read.objections };
  },
  async run(ctx, { deliverableId, to, reason, objections }) {
    if (PERSON_ONLY_TRUST.has(to)) {
      const pending = ctx.workflow.requestPromotion({ deliverableId, to, by: ctx.actor, reason });
      const asked = await askThePerson(ctx, pending.id, null);
      if (asked && (asked.decision as { state: string }).state !== 'open') {
        const d = getDeliverable(ctx.store, deliverableId);
        return { ...asked, deliverable: { id: deliverableId, trust: d?.trustState ?? 'unchanged' } };
      }
      return { deliverable: { id: deliverableId, trust: 'unchanged' }, pendingDecision: pending.id, personRequired: true, ...(asked ? { asked: asked.asked } : {}), next: personStepFor(pending.id) };
    }
    const verification = to === 'challenged' ? { challenge: { objections: objections ?? [] } } : undefined;
    const d = ctx.workflow.promote({ deliverableId, to, by: ctx.actor, channel: 'relay', reason, verification });
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
  if (items.length > MAX_LEASE_PATHS) throw new ToolInputError(`"paths" takes at most ${String(MAX_LEASE_PATHS)} entries; reserve a directory instead`, { field: 'paths' });
  const use = raw.action === 'claim' ? 'reserve' : 'check';
  return items.map((p) => {
    if (typeof p !== 'string' || !p.trim()) throw new ToolInputError('"paths" holds non-empty strings', { field: 'paths' });
    try {
      return normalizeLeasePath(p, use);
    } catch (e) {
      throw new ToolInputError((e as Error).message, { field: 'paths' });
    }
  });
}

function matching(value: string | undefined, pattern: RegExp, field: string, message: string): string | undefined {
  if (value === undefined) return undefined;
  if (!pattern.test(value.trim())) throw new ToolInputError(message, { field });
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
  if (values.some((v) => typeof v !== 'string')) throw new ToolInputError(`"${key}" must contain strings`, { field: key });
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
      agent: matching(str(raw, 'agent', { optional: true }), AGENT_NAME, 'agent', '"agent" is a name of letters, digits, dot, dash, or underscore, at most 40 characters'),
      paths: raw.paths === undefined ? undefined : leasePaths(raw),
      mode: str(raw, 'mode', { optional: true, oneOf: [...LEASE_MODES] }) as LeaseMode | undefined,
      packet: obj(raw, 'packet', { optional: true }),
      to: matching(str(raw, 'to', { optional: true }), HANDOFF_TARGET, 'to', '"to" names a session or a session’s agent, such as ses_ab12/reviewer'),
    };
  },
  run(ctx, { action, id, title, kind, description, parent, serves, blockedBy, related, acceptance, risk, sources, removeParent, reason, token, agent, paths, mode, packet, to }) {
    const at = ctx.now();
    if (action === 'list') return queryWork(ctx.store, { query: title, parentId: parent, limit: 50 });
    if (action === 'offers') return listOffers(ctx.store, at, claimantOf(ctx, agent)).map((o) => ({ work: o.work, handoff: handoffAsData(o.handoff) }));
    if (action === 'check') {
      if (!paths || paths.length === 0) throw new ToolInputError('"paths" is required for check', { field: 'paths' });
      const exclude = id ? (getWork(ctx.store, id) ?? getWorkByLegacyId(ctx.store, id))?.id : undefined;
      return overlapReport(findOverlaps(ctx.store, { paths, laneRoot: ctx.lane?.root ?? MAIN_LANE, now: at, mode, excludeWorkId: exclude }));
    }
    if (action === 'ready') return listReady(ctx.store, at);
    if (action === 'add') {
      if (!title) throw new ToolInputError('"title" is required for add', { field: 'title' });
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
    if (!id) throw new ToolInputError(`"id" is required for ${action}`, { field: 'id' });
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
      if (!reason) throw new ToolInputError('requalify needs a reason: what was checked against the changed source', { field: 'reason' });
      return requalifyWork(ctx.store, { id: item.id, reason, at, actor: ctx.actor });
    }
    if (action === 'link') return linkWork(ctx.store, { id: item.id, parentId: parent, serves, blockedBy, related, at, actor: ctx.actor, nextId: ctx.nextId });
    if (action === 'unlink') return unlinkWork(ctx.store, { id: item.id, parent: removeParent, blockedBy, related, at, actor: ctx.actor });
    const who = claimantFor(ctx, agent, at);
    if (action === 'handoff') {
      if (!token) throw new ToolInputError('"token" is required for handoff: the one your claim returned', { field: 'token' });
      if (!packet) throw new ToolInputError('"packet" is required for handoff: at least state and next', { field: 'packet' });
      return handoffWork(ctx.store, { id: item.id, owner: who.owner, token, packet, to, now: at });
    }
    if (action === 'accept') {
      const taken = acceptWork(ctx.store, { id: item.id, ...who, until, now: at });
      return { ...taken, handoff: handoffAsData(taken.handoff) };
    }
    if (action === 'claim') return claimWorkItem(ctx.store, { id: item.id, ...who, until, now: at, token, paths, mode });
    if (action === 'complete') return completeWork(ctx.store, { id: item.id, owner: who.owner, token, at, reason });
    if (action === 'release') {
      if (!token) throw new ToolInputError('"token" is required for release: the one your claim returned', { field: 'token' });
      return releaseWork(ctx.store, { id: item.id, owner: who.owner, token, at });
    }
    if (action === 'takeover') {
      if (!reason) throw new ToolInputError('takeover needs a reason', { field: 'reason' });
      return takeoverWork(ctx.store, { id: item.id, ...who, until, now: at, reason, processAlive: ctx.processAlive });
    }
    if (!reason) throw new ToolInputError('reopen needs a reason', { field: 'reason' });
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
    return { work: { stepRunId: p.leased.id, owner: p.leased.leaseOwner, token: p.leased.nonce, leaseUntil: p.leased.leaseUntil, run: { id: p.run.id, workflow: p.run.workflowId }, step: { id: p.step.id, title: p.step.title, tier: p.step.tier, outputs: p.step.outputs, validators: p.step.validators }, skill: p.skill ? { id: p.skill.id, version: p.skill.version, body: p.skill.body() } : null, inputs: p.inputs, intake: p.intake, method: p.method, instructions: p.instructions }, waitingOn: null };
  },
});

/** Every tool, in the order a host sees them. */
export const TOOLS: readonly Tool<unknown, unknown>[] = [
  bootstrap, classify, projectContext, remember, workflows, skills, startOutcome, claimWork, submitWork, runStatus, inbox, decide, sources, checkAnswer, staff, promote, work, delegate, claimStep, heartbeat,
] as unknown as readonly Tool<unknown, unknown>[];

export function toolsFor(surface: 'interactive' | 'headless'): readonly Tool<unknown, unknown>[] {
  return TOOLS.filter((t) => t.surface === 'both' || t.surface === surface);
}

/** What the headless surface must never be able to do, by tool name. */
export const HEADLESS_FORBIDDEN: readonly string[] = ['remember', 'start_outcome', 'decide', 'promote_deliverable', 'sources', 'skills', 'workflows', 'project_context', 'staff', 'claim_work', 'classify_request', 'work', 'delegate'];
