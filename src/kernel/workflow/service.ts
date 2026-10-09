/**
 * kernel/workflow/service.ts — one service runs a workflow from binding to
 * handback.
 *
 * It binds to the project and the host, resolves the workflow through the
 * registry, creates one idempotent run with the reading it started from
 * frozen on it, leases ready steps to whoever executes them (this session,
 * or a pinned headless runner), gates every step through the policy engine,
 * records outputs, evidence, attempts, and audit events transactionally,
 * pauses for decisions, resumes without repeating finished work, validates
 * load-bearing outputs, and promotes the deliverable only through the
 * kernel's own transitions.
 * Nothing here can enqueue a step the registry did not resolve.
 */

import { createHash } from 'node:crypto';
import type { StateStore } from '../state/open.ts';
import { appendActivity, listActivity } from '../state/activity.ts';
import { createRun, findActiveByWorkIdentity, getRun, getRunByKey, listActiveRuns, setCancelRequested, transitionRun, type WorkflowRun } from '../state/runs.ts';
import { addStep, claimStep, completeStep, expireDeadLeases, failStep, getStep, grantExtraAttempt, listSteps, transitionStep, type LeasedStep, type StepRun } from '../state/steps.ts';
import { getDeliverable, listDeliverables, setTrustState, upsertDraft, type Deliverable, type TrustState } from '../state/deliverables.ts';
import { getDecision, listOpenDecisions, listStepDecisions, raiseDecision, resolveDecision, withdrawDecision, type Decision } from '../state/decisions.ts';
import { addStatement, getProfile, getStatement, listStatements, type Statement, type StatementKind } from '../state/profile.ts';
import { addClaim, getEntity, listRelations } from '../state/graph.ts';
import { bindGoverningStatement, isGoverningKind, supersedeGoverning } from '../state/admission.ts';
import { approveAction, evaluateAction, type ActionRequest, type PolicyContext } from '../policy/engine.ts';
import { tierAtLeast } from '../policy/lattice.ts';
import { DECISION_CHANNELS, isPersonChannel, PERSON_ONLY_TIERS, PERSON_ONLY_TRUST, PersonChannelRequiredError, type DecisionChannel } from '../policy/channels.ts';
import { provides, type HostCapabilities } from '../registry/capability-registry.ts';
import { readySteps } from '../registry/dependency-graph.ts';
import type { RegisteredWorkflow, WorkflowManifest, WorkflowStep } from '../registry/models.ts';
import { resolveWorkflow, type Resolution, type SourceAvailability } from '../registry/resolver.ts';
import { checkSlot, normalizeSourceIds, resolvePeriod, slotIdentity, type PeriodSpec, type ResolvedPeriod } from '../registry/slots.ts';
import { calendarDate } from '../calendar.ts';
import type { SkillRegistry } from '../registry/skill-registry.ts';
import type { WorkflowRegistry } from '../registry/workflow-registry.ts';
import type { RegistryLock } from '../project/lock.ts';
import { INTAKE_FIELDS, OPEN_ABOUT, slotQuestion, type Intake, type IntakeDeliverable, type Question } from './intake.ts';
import { assessConsequence, judgmentRequired, wordsOf, type Judgment } from './consequence.ts';
import { askedFrom, askedOf, type AskedReading, type AskedSources, type Assumption, type Declared, type Firing } from './asked.ts';
import { provenanceOf, type RefResolver } from '../project/evidence.ts';
import { listSources } from '../state/sources.ts';
import { settledTerms } from '../project/governance.ts';
import { higherSensitivity } from './validators.ts';
import { getDriftFinding, setDriftStatus } from '../state/drift.ts';
import { detectDrift, recordDrift } from '../drift/detect.ts';
import { outsidePeriodOf, periodCoverage, runValidators, sourcesCoverage, unreadOf, type OutsidePeriod, type Unread, type ValidatorResult } from './validators.ts';
import { capped, flattenHost, quoteHost, renderPersonPrompt, type HostSaid } from '../render/person-prompt.ts';

function activeContradictionCount(store: StateStore): number {
  return listRelations(store, { kind: 'contradicts' }).filter((r) => {
    if (r.status === 'retired') return false;
    const target = getEntity(store, r.toId);
    return !!target && (target.kind === 'decision' || target.kind === 'requirement') && target.status === 'active';
  }).length;
}

export interface WorkflowServiceDeps {
  readonly store: StateStore;
  readonly skills: SkillRegistry;
  readonly workflows: WorkflowRegistry;
  readonly lock: RegistryLock;
  readonly host: HostCapabilities;
  readonly sources: () => readonly SourceAvailability[];
  readonly projectWritePolicy: 'managed' | 'never';
  readonly now: () => string;
  readonly nextId: (prefix: string) => string;
  readonly targetSystemFor?: (step: WorkflowStep) => string;
  readonly defaultLeaseMs?: number;
}

export interface StartInput {
  readonly workflowId: string;
  readonly input: Readonly<Record<string, unknown>>;
  readonly trigger: 'manual' | 'schedule' | 'event';
  /** Overrides the derived key; a scheduler passes its firing key. */
  readonly idempotencyKey?: string;
  readonly executorId?: string;
  readonly executorKind?: 'interactive' | 'headless';
  /** The reading the run starts from, frozen on the run once: the inputs to every later judgment. */
  readonly asked?: AskedReading;
  /** The instant a relative period is worked out against: a firing passes the time it was due; now otherwise. */
  readonly periodAt?: string;
  /** The caller's timezone, for a period that names none; UTC otherwise. */
  readonly timezone?: string;
  /** The standing trigger firing that started this run. */
  readonly firing?: Firing;
}

export interface StartResult {
  readonly run: WorkflowRun;
  readonly created: boolean;
  readonly resolution: Resolution;
  /** For a run that already existed, its own preflight, not the one this start's input would give. */
  readonly preflight: Preflight;
  /** For a run that already existed, the declared inputs this start gave differently; empty otherwise. */
  readonly differs: readonly string[];
  /** The blocked run of the same work that this start cancelled and replaced, if any. */
  readonly superseded: string | null;
}

export interface Preflight {
  readonly status: Resolution['status'];
  readonly summary: string;
  readonly approvalsAhead: readonly string[];
  /** Each reason with what would clear it; a missing input names its slot. */
  readonly reasons: readonly { readonly code: string; readonly stepId: string | null; readonly message: string; readonly remedy: string; readonly slot?: string }[];
  readonly flags: readonly string[];
  readonly judgment: Judgment;
  /** The period the work covers, in dates, when its input names one. */
  readonly period: ResolvedPeriod | null;
  /** What was taken as given to work the input out, in plain words. */
  readonly assumptions: readonly string[];
  /** One question for the person per required input that is missing. */
  readonly questions: readonly Question[];
}

/** The reading a step works from, in structured fields only: never the person's words, and systems that are not registered only as a count. */
export interface WorkIntake {
  readonly deliverable: IntakeDeliverable | null;
  readonly period: { readonly semantics: string; readonly from: string | null; readonly to: string; readonly phrase: string | null } | null;
  /** The declared sources the reading names, and how many systems it names that are not registered with Construct. */
  readonly sources: { readonly registered: readonly string[]; readonly unregistered: number };
  /** Where the result goes, by kind. */
  readonly destination: string | null;
  readonly assumptions: readonly Assumption[];
}

export interface WorkPacket {
  readonly leased: LeasedStep;
  readonly run: WorkflowRun;
  readonly step: WorkflowStep;
  readonly skill: { readonly id: string; readonly version: string; readonly digest: string; readonly body: () => string | null; readonly file: (relativePath: string) => Uint8Array | null } | null;
  readonly inputs: Readonly<Record<string, unknown>>;
  readonly instructions: readonly string[];
  readonly judgment: Judgment;
  /** The run's reading, when it started from one. */
  readonly intake: WorkIntake | null;
  /** For a step that binds no skill, the method the reading chose, when it is registered. */
  readonly method: { readonly id: string; readonly version: string; readonly title: string } | null;
}

/** Why a claim handed nothing out. */
export type WaitingOn =
  | { readonly kind: 'decision'; readonly decision: Decision }
  | { readonly kind: 'finished'; readonly state: WorkflowRun['state'] }
  /** The person approved the step for another executor, whose grant stands until `until`. */
  | { readonly kind: 'held'; readonly runId: string; readonly stepId: string; readonly executorId: string; readonly until: string | null }
  /** The step acts above what this executor may reach, or needs a capability it lacks. */
  | { readonly kind: 'refused'; readonly runId: string; readonly stepId: string; readonly reason: string }
  /** The run named is blocked: why, and each reason with what would clear it. */
  | { readonly kind: 'blocked'; readonly runId: string; readonly summary: string; readonly reasons: Preflight['reasons'] }
  | { readonly kind: 'nothing_ready' }
  | { readonly kind: 're_resolve'; readonly reason: string };

/** What a person may answer when checks keep failing. */
export const WAIVER_OPTIONS = ['accept with these problems', 'another attempt', 'stop'] as const;

/** A check a run went through without passing: on which step, what it found, and who accepted it on which channel. */
export interface Waiver {
  readonly stepId: string;
  readonly validator: string;
  readonly problems: readonly string[];
  /** Who answered the waiver question; null for a waiver recorded without it. */
  readonly acceptedBy: string | null;
  /** How that answer reached Construct; null when it was not recorded. */
  readonly channel: DecisionChannel | null;
}

/** What was done about one objection a challenge raised. */
export const OBJECTION_DISPOSITIONS = ['fixed', 'accepted', 'rejected', 'open'] as const;
export type ObjectionDisposition = (typeof OBJECTION_DISPOSITIONS)[number];

export interface Objection {
  readonly objection: string;
  readonly disposition: ObjectionDisposition;
}

/** What a challenge record must carry, shown when it is missing or malformed. */
export const OBJECTIONS_EXAMPLE: readonly Objection[] = [{ objection: 'the latency figure has no source', disposition: 'fixed' }];

/**
 * The objections a challenge raised, checked: a list (an empty one says the
 * challenge found nothing) of {objection, disposition}. Returns the list with
 * each objection trimmed, or the field that is wrong and why.
 */
export function readObjections(raw: unknown, field = 'objections'): { readonly objections: readonly Objection[] } | { readonly field: string; readonly message: string; readonly allowed?: readonly string[] } {
  if (!Array.isArray(raw)) return { field, message: `"${field}" must be a list of {objection, disposition}; an empty list says the challenge found nothing` };
  const objections: Objection[] = [];
  for (const [i, entry] of raw.entries()) {
    const at = `${field}[${String(i)}]`;
    if (entry === null || typeof entry !== 'object' || Array.isArray(entry)) return { field: at, message: `${at} must be an object {objection, disposition}` };
    const { objection, disposition, ...rest } = entry as Record<string, unknown>;
    const stray = Object.keys(rest);
    if (stray.length) return { field: `${at}.${stray[0]!}`, message: `${at} takes only objection and disposition, not ${stray.join(', ')}` };
    if (typeof objection !== 'string' || !objection.trim()) return { field: `${at}.objection`, message: `${at}.objection must say what the challenge objected to` };
    if (typeof disposition !== 'string' || !(OBJECTION_DISPOSITIONS as readonly string[]).includes(disposition)) {
      return { field: `${at}.disposition`, message: `${at}.disposition must be one of ${OBJECTION_DISPOSITIONS.join(', ')}`, allowed: OBJECTION_DISPOSITIONS };
    }
    objections.push({ objection: objection.trim(), disposition: disposition as ObjectionDisposition });
  }
  return { objections };
}

/** The verification keys the kernel writes when a step's checks pass, and the challenge record it writes itself: no caller sets them. */
const CHECKS_RECORD: ReadonlySet<string> = new Set(['validators', 'challengeRequired', 'evidence', 'challenge']);

/** Why a deliverable is never moved to validated by hand. */
export const VALIDATED_BY_CHECKS = "validated is set when the step's checks pass, not by promotion";

/** What each check needs from the output, said once to the host instead of discovered by failing. */
const VALIDATOR_GUIDANCE: Readonly<Record<string, string>> = {
  deliverable_complete: 'deliverable_complete needs a non-empty "summary" and one of "findings", "body", or "decisions".',
  schema: 'schema needs every declared output key present.',
  citations_present: 'citations_present needs evidence entries whose ref names a real project file (docs/a.md), a deliverable, or an item a recorded read holds (PLAT-101, confluence:98765, or the page\'s url); record what you read with sources action report before citing it.',
  evidence_refs_resolve: 'evidence_refs_resolve rejects any evidence ref that names nothing this project holds.',
  artifacts_exist: 'artifacts_exist needs "artifact" (or "changes") naming the file you wrote, and that file must exist and not be empty; a step whose outputs include "changes" may list none ("changes": [], "artifact": null).',
  numbers_grounded: 'numbers_grounded rejects any figure in the output, or in a document this step wrote (an artifact or changed file that is .md, .txt, .html, .csv and the like; code and configuration are not read for figures), that no cited source contains; a figure counts only when it is in text Construct holds (a file, or what you recorded reading), never in a document this step wrote, and a code or configuration file you changed may be cited for the values it now holds; an excerpt alone does not ground it. List computed figures under "derivations" as {value, expression}, where expression is arithmetic over cited figures.',
  template_conformance: 'template_conformance needs every section heading of the named template present in the artifact.',
  excerpts_match: 'excerpts_match needs every evidence excerpt to appear in the file or item it cites (case and spacing do not matter); an excerpt from something Construct holds no text for is not checked and supports nothing.',
  evidence_recorded: 'evidence_recorded needs at least one citation that holds content Construct can check: a project file, or an item whose text you recorded with sources action report.',
  within_period: 'within_period refuses a cited item whose recorded updatedAt falls after the period this run covers ends; an item that belongs anyway passes when the output lists it under "outsidePeriod" as {ref, why}. Items last updated before the period, items with no date, and project files pass and are counted in the deliverable.',
  named_sources_read: 'named_sources_read needs, for each source this run names, a cited item, file or folder read from it (cite it as <source>:<item>; naming the whole source does not count); a named source you could not read passes when the output lists it under "unread" as {source, why}.',
  superseded_acknowledged: 'superseded_acknowledged needs any superseded document you cite to be named as superseded in the output.',
  decision_ask_present: 'decision_ask_present needs a section headed with "decision" that names who decides (the audience input) and by when.',
  sources_diverse: 'sources_diverse needs citations from at least two independent places that hold content Construct can check (different files, recorded items, or web sites; pages of one site count once).',
  revision_linked: 'revision_linked needs "revises" (the deliverable id) and a "changeSummary" of what changed and why.',
  settled_not_contradicted: 'settled_not_contradicted rejects stating a term the person settled against as if it were current; say it was decided against or name the conflict.',
  sensitivity_cleared: 'sensitivity_cleared needs the person to clear confidential or restricted material for its audience (input clearedFor).',
  published_location: 'published_location needs "location": the URL or provider:id where it was published.',
  conflicts_declared: 'conflicts_declared needs a "conflicts" list (empty if none); each conflict gives "citations" naming at least the two sources that disagree.',
};

function validatorGuidance(names: readonly string[]): string[] {
  return names.map((n) => VALIDATOR_GUIDANCE[n]).filter((x): x is string => typeof x === 'string');
}

export interface ClaimOutcome {
  readonly packet: WorkPacket | null;
  readonly waitingOn: WaitingOn | null;
}

/** What gating one step for one claimer found. */
type Gate =
  | { readonly outcome: 'cleared' }
  | { readonly outcome: 'decision'; readonly decision: Decision }
  | { readonly outcome: 'held'; readonly executorId: string; readonly until: string | null };

const CLEARED: Gate = { outcome: 'cleared' };

/** Steps the kernel performs itself rather than handing to a claimer. */
function performedByKernel(step: WorkflowStep): boolean {
  return step.capabilities.includes('kernel:drift_detect');
}

export interface SubmitInput {
  readonly leased: LeasedStep;
  readonly output: Readonly<Record<string, unknown>>;
  readonly evidence?: readonly { readonly ref: string; readonly excerpt?: string }[];
  readonly noData?: boolean;
  readonly resolvableRefs?: ReadonlySet<string>;
  /** Resolves evidence and artifact references; the broker always supplies one. */
  readonly resolve?: RefResolver;
}

export interface SubmitResult {
  readonly step: StepRun;
  readonly validation: readonly ValidatorResult[];
  readonly run: WorkflowRun;
  readonly deliverable: Deliverable | null;
  /**
   * Keys the last step restated with a value other than the one it was
   * handed: the step's record keeps the restatement, and the deliverable
   * carries what it was handed.
   */
  readonly ignored: readonly string[];
}

export interface RunView {
  readonly run: WorkflowRun;
  readonly steps: readonly StepRun[];
  readonly deliverables: readonly Deliverable[];
  readonly openDecisions: readonly Decision[];
  readonly activity: number;
}

export interface WorkflowService {
  remember(input: {
    readonly kind: StatementKind;
    readonly text: string;
    readonly by: string;
    /** How the person's words arrived: relayed by the model unless they gave them on a channel of their own. */
    readonly channel?: DecisionChannel;
    readonly assumptions?: readonly string[];
    readonly replaces?: string;
  }): Statement;
  /** Resolve without starting; a period is worked out at `periodAt` (now when absent) in the caller's timezone. */
  preflight(workflowId: string, input: Readonly<Record<string, unknown>>, opts?: { readonly declared?: Declared | null; readonly periodAt?: string; readonly timezone?: string }): { readonly resolution: Resolution; readonly preflight: Preflight };
  /** The one judgment of how much rigor work gets: classify_request, preflight, packets, resume and acceptance all read it. */
  judge(input: { readonly workflowId: string | null; readonly input: Readonly<Record<string, unknown>>; readonly declared?: Declared | null }): Judgment;
  start(input: StartInput): StartResult;
  claimNext(input: { readonly runId?: string; readonly owner?: string; readonly leaseMs?: number }): ClaimOutcome;
  submit(input: SubmitInput): SubmitResult;
  fail(input: { readonly leased: LeasedStep; readonly error: unknown; readonly reason: string }): StepRun;
  /**
   * Resolve an open decision. `channel` says how the answer arrived; a relay
   * (the default) cannot approve an external or destructive action or accept
   * a deliverable, and such an approval leaves the decision open. The
   * person's approval of a question about a deliverable that has changed
   * since it was asked moves nothing: the question is withdrawn and asked
   * again as it stands, and the refusal names the new one.
   */
  decide(input: { readonly decisionId: string; readonly resolution: unknown; readonly by: string; readonly channel?: DecisionChannel }): { readonly decision: Decision; readonly run: WorkflowRun | null };
  cancel(input: { readonly runId: string; readonly by: string; readonly reason: string }): WorkflowRun;
  resume(runId: string): WorkflowRun;
  status(runId: string): RunView | null;
  /**
   * Trust promotions a person or a challenge performs; steps never do.
   * Accepted and final need a person channel. Validated is never promoted
   * to: only a step's passing checks set it. Challenged needs
   * verification.challenge.objections, the list of what the challenge
   * raised (empty when it found nothing), and records who challenged it.
   */
  promote(input: { readonly deliverableId: string; readonly to: TrustState; readonly by: string; readonly channel?: DecisionChannel; readonly verification?: unknown; readonly reason?: string }): Deliverable;
  /**
   * Ask the person to accept or finalize a deliverable: an inbox approval
   * they answer directly, whose question leads with what Construct checked,
   * waived, and could not check, and quotes the assistant's own words as the
   * assistant's. Reuses an open one while its question still describes the
   * deliverable as it stands; otherwise withdraws it and asks again.
   */
  requestPromotion(input: { readonly deliverableId: string; readonly to: TrustState; readonly by: string; readonly reason?: string }): Decision;
}

/** What an approval to move a deliverable's trust carries. */
export interface PromotionSubject {
  readonly deliverableId: string;
  readonly to: TrustState;
  readonly reason: string | null;
  readonly requestedBy: string;
}

/**
 * An approval of a question that no longer describes its deliverable as it
 * stands. Thrown inside the decision's transaction, so nothing of it is
 * applied, and caught outside it, where the question is asked again.
 */
class StaleAcceptance extends Error {
  readonly decisionId: string;
  readonly promote: PromotionSubject;

  constructor(decisionId: string, promote: PromotionSubject) {
    super(`${decisionId} no longer describes deliverable ${promote.deliverableId} as it stands`);
    this.name = 'StaleAcceptance';
    this.decisionId = decisionId;
    this.promote = promote;
  }
}

/** The inputs that say which piece of work a run is: the dedupe key, or every declared input when there is none. */
function identifyingKeys(m: RegisteredWorkflow['manifest']): readonly string[] {
  return m.dedupeKey.length ? m.dedupeKey : Object.keys(m.inputSchema);
}

/**
 * The work identity. A kernel-typed input is identified by what it means: a
 * period by its dates (so last_quarter asked on two days of one quarter is
 * one piece of work), source ids as a set.
 */
function idempotencyKeyFor(workflow: RegisteredWorkflow, input: Readonly<Record<string, unknown>>, trigger: string, identities: Readonly<Record<string, string>> = {}): string {
  const m = workflow.manifest;
  const keys = identifyingKeys(m);
  const material = keys.map((k) => (k in identities ? `${k}=${identities[k]!}` : `${k}=${JSON.stringify(input[k] ?? null)}`)).join('&');
  const hash = createHash('sha256').update(`${m.id}@${m.version}|${trigger}|${material}`).digest('hex').slice(0, 24);
  return `${m.id}:${hash}`;
}

/** A run input with its kernel-typed values worked out: the period in dates, source ids trimmed and without repeats. */
interface NormalizedInput {
  /** The input to store and resolve: the period exactly as given, source ids normalized. */
  readonly input: Readonly<Record<string, unknown>>;
  /** The period in dates, when the input gives one that checks out. */
  readonly period: ResolvedPeriod | null;
  readonly periodSpec: PeriodSpec | null;
  /** Every source id the input names, when it has a source ids input. */
  readonly sourceIds: readonly string[] | null;
  /** Identity material for each kernel-typed input given. */
  readonly identities: Readonly<Record<string, string>>;
}

function normalizeInput(m: WorkflowManifest, input: Readonly<Record<string, unknown>>, ctx: { readonly at: string; readonly timezone?: string; readonly sourceIds: readonly string[] }): NormalizedInput {
  const out: Record<string, unknown> = { ...input };
  const identities: Record<string, string> = {};
  let period: ResolvedPeriod | null = null;
  let periodSpec: PeriodSpec | null = null;
  let sourceIds: string[] | null = null;
  for (const [key, type] of Object.entries(m.inputSchema)) {
    if (out[key] === undefined) continue;
    if (type === 'source_ids') {
      out[key] = normalizeSourceIds(out[key]);
      const ids = out[key];
      if (Array.isArray(ids) && ids.every((id) => typeof id === 'string')) sourceIds = [...new Set([...(sourceIds ?? []), ...(ids as string[])])];
      identities[key] = slotIdentity('source_ids', out[key]);
    } else if (type === 'period') {
      if (checkSlot('period', key, out[key], ctx).length === 0) {
        periodSpec = out[key] as PeriodSpec;
        period = resolvePeriod(periodSpec, ctx.at, ctx.timezone);
      }
      identities[key] = slotIdentity('period', period ?? out[key]);
    }
  }
  return { input: out, period, periodSpec, sourceIds, identities };
}

/** The value a run gave a declared input, as its identity compares it: a kernel-typed one by meaning. */
function identityOf(m: WorkflowManifest, key: string, value: unknown, period: ResolvedPeriod | null): string {
  const type = m.inputSchema[key];
  if (type === 'period') return period ? slotIdentity('period', period) : canonicalJson(value);
  if (type === 'source_ids') return value === undefined ? canonicalJson(null) : slotIdentity('source_ids', value);
  return canonicalJson(value);
}

/** JSON with object keys in sorted order, so equal values give equal text; a missing value reads as null. */
function canonicalJson(value: unknown): string {
  return JSON.stringify(value ?? null, (_key, v: unknown) =>
    v && typeof v === 'object' && !Array.isArray(v)
      ? Object.fromEntries(Object.entries(v as Record<string, unknown>).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)))
      : v);
}

/** Names in a sentence: a, a and b, a, b and c. */
function listed(names: readonly string[]): string {
  return names.length <= 1 ? (names[0] ?? '') : `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]!}`;
}

/** The flag a start carries when the run it found was started with other values for these inputs. */
export function differsFlag(runId: string, keys: readonly string[]): string {
  return `run ${runId} already covers this work but was started with a different ${listed(keys)}; carry on with it, or cancel it and start again to use the new values`;
}

/** What the host is told to put to the person when the run it got back was started with other values. */
export function differsNext(keys: readonly string[]): string {
  return `Tell the person this work is already running with different ${listed(keys)}, and ask whether to carry on with it or cancel it and start again.`;
}

/** The fields of a reading on which two readings differ. */
function readingDiffers(was: Intake | null | undefined, now: Intake | null | undefined): string[] {
  if (!was || !now) return [];
  return INTAKE_FIELDS.filter((k) => canonicalJson(was[k]) !== canonicalJson(now[k]));
}

/** The flag a start carries when the run it found was started from a different reading. */
export function readingDiffersFlag(runId: string, fields: readonly string[]): string {
  const named = fields.map((f) => (f === 'open' ? 'open items' : f));
  return `run ${runId} was started from a reading that differs in its ${listed(named)}; it keeps its own reading, so carry on with it, or cancel it and start again for this reading to apply`;
}

/**
 * The reading frozen on a new run: what the caller declared, with the period,
 * the source ids and the firing taken from the start itself rather than from
 * anything the caller said about them. A period the reading names for a
 * workflow that takes none is worked out here from the reading; declared
 * sources it names, when the workflow takes no source ids, are kept only
 * while they are declared. Null when there is nothing to keep.
 */
function frozenReading(given: AskedReading | undefined, normalized: NormalizedInput, firing: Firing | null, clock: { readonly at: string; readonly timezone?: string; readonly sourceIds: readonly string[] }): AskedReading | null {
  const caller = given ? askedFrom(given) : null;
  const named = caller?.sources?.named ?? [];
  let period = normalized.period;
  let periodSpec = normalized.periodSpec;
  const read = caller?.intake?.period ?? caller?.periodSpec ?? null;
  if (!period && read && checkSlot('period', 'period', read, { at: clock.at, timezone: clock.timezone, sourceIds: [] }).length === 0) {
    periodSpec = read;
    period = resolvePeriod(read, clock.at, clock.timezone);
  }
  const registered = normalized.sourceIds ?? (caller?.sources?.registered ?? []).filter((id) => clock.sourceIds.includes(id));
  const sources: AskedSources | null = normalized.sourceIds || registered.length || named.length ? { registered, named } : null;
  if (!caller && !period && !sources && !firing) return null;
  return {
    ...(caller && 'intake' in caller ? { intake: caller.intake } : {}),
    ...(caller && 'declared' in caller ? { declared: caller.declared } : {}),
    ...(caller && 'judgedBy' in caller ? { judgedBy: caller.judgedBy } : {}),
    ...(caller && 'assumptions' in caller ? { assumptions: caller.assumptions } : {}),
    ...(period ? { period, periodSpec } : {}),
    ...(sources ? { sources } : {}),
    ...(firing ? { firing } : {}),
  };
}

/** What a step is handed of the run's reading: structured fields only. */
function workIntakeOf(asked: AskedReading): WorkIntake | null {
  const intake = asked.intake;
  if (!intake) return null;
  const p = asked.period ?? null;
  const named = asked.sources?.named ?? [];
  return {
    deliverable: intake.deliverable,
    period: p ? { semantics: p.semantics, from: p.from, to: p.to, phrase: p.phrase ?? null } : null,
    sources: { registered: [...(asked.sources?.registered ?? [])], unregistered: named.filter((n) => !n.registered).length },
    destination: intake.destination?.kind ?? null,
    // A kernel note about an unregistered system names it; the count above stands in for it.
    assumptions: (asked.assumptions ?? []).filter((a) => !(a.by === 'kernel' && a.about === 'sources')),
  };
}

/** The declared source a citation names by its id (`<id>`, `<id>:<item>` or `source:<id>:<item>`), or null; a web address names none. */
function namedSourceOf(ref: string, sources: ReadonlyMap<string, unknown>): string | null {
  const raw = ref.trim().replace(/^source:/, '');
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(raw)) return null;
  const colon = raw.indexOf(':');
  const head = colon > 0 ? raw.slice(0, colon) : raw;
  return sources.has(head) ? head : null;
}

/** Whether a step reads the project, its context, or a source. */
function readsAnything(capabilities: readonly string[]): boolean {
  return capabilities.some((c) => c === 'read_project_context' || c === 'read_project_files' || c.startsWith('read_source'));
}

function isObject(x: unknown): x is Record<string, unknown> {
  return x !== null && typeof x === 'object' && !Array.isArray(x);
}

/** What a resolved citation can be that the project holds itself, so no source's sensitivity label applies to it. */
const PROJECT_HELD: ReadonlySet<string> = new Set(['file', 'directory', 'deliverable', 'record', 'surface']);

/** How long the whole acceptance prompt kept beside a cut one may be. */
const BRIEF_RECORD_CAP = 8000;

/** What each period semantics means, in the person's terms. */
const PERIOD_MEANS: Readonly<Record<string, string>> = {
  as_of: 'how things stood at its end',
  changed_during: 'what changed during it',
  evidence_window: 'only evidence dated in it',
};

/** The text of one entry of a step's assumptions list: a string, or an object's text, assumption or statement. */
function assumptionText(entry: unknown): string | null {
  if (typeof entry === 'string') return entry.trim() || null;
  if (!isObject(entry)) return null;
  for (const key of ['text', 'assumption', 'statement']) {
    const v = entry[key];
    if (typeof v === 'string' && v.trim()) return v.trim();
  }
  return null;
}

/** A count with its noun, singular or plural. */
function counted(n: number, one: string, many = `${one}s`): string {
  return `${String(n)} ${n === 1 ? one : many}`;
}

export function createWorkflowService(deps: WorkflowServiceDeps): WorkflowService {
  const { store } = deps;
  /**
   * What the person has said is settled reaches every step that reads: a source that contradicts a remembered
   * decision or constraint is a conflict to name, not a fact to adopt.
   */
  const governingInstructions = (capabilities: readonly string[]): string[] => {
    if (!readsAnything(capabilities)) return [];
    const settled = listStatements(store, { status: 'confirmed' }).filter((st) => st.kind === 'decision' || st.kind === 'constraint');
    if (settled.length === 0) return [];
    const shown = settled.slice(-12).map((st) => `[${st.kind} ${st.id}] ${st.text.length > 200 ? `${st.text.slice(0, 200)}…` : st.text}`);
    return [`Settled by the person (newest last${settled.length > 12 ? `, ${String(settled.length - 12)} older not shown; read them with project_context statements` : ''}): ${shown.join(' | ')}. Where a source disagrees with one of these, list it under conflicts and cite the statement as statement:<id>.`];
  };
  /** Terms the person settled against: constraints of the form Do not state "X" as current. */
  const settled = () => settledTerms(listStatements(store, { kind: 'constraint', status: 'confirmed' }));
  /**
   * The highest sensitivity among the sources the whole run cited, and the
   * deliverable it acts on, if any. A citation that names a declared source
   * by its id counts against that source even when no recorded read holds
   * the item, so a step that went through on a waiver keeps the label.
   */
  const sensitivityFor = (run: WorkflowRun, current: readonly { readonly ref: string }[], resolve?: RefResolver): string | null => {
    let level: string | null = null;
    const input = (run.input ?? {}) as { deliverable?: unknown };
    if (typeof input.deliverable === 'string') {
      const d = getDeliverable(store, input.deliverable.replace(/^deliverable:/, ''));
      const ds = (d?.body as { sensitivity?: unknown } | null)?.sensitivity;
      if (typeof ds === 'string') level = higherSensitivity(level, ds);
    }
    if (!resolve) return level;
    const bySource = new Map(listSources(store, {}).map((x) => [x.id, x.sensitivity]));
    for (const e of runEvidence(run.id, current)) {
      const id = resolve(e.ref)?.sourceId ?? namedSourceOf(e.ref, bySource);
      if (id) level = higherSensitivity(level, bySource.get(id) ?? null);
    }
    return level;
  };
  /**
   * How many of the run's citations name no declared source and nothing the
   * project holds itself, so no sensitivity label applies to them: a page no
   * declared source covers, or a citation that resolves to nothing. Null
   * where no resolver was supplied to place them.
   */
  const sensitivityUnknownFor = (run: WorkflowRun, current: readonly { readonly ref: string }[], resolve?: RefResolver): number | null => {
    if (!resolve) return null;
    const bySource = new Map(listSources(store, {}).map((x) => [x.id, x.sensitivity]));
    let unknown = 0;
    for (const e of runEvidence(run.id, current)) {
      const r = resolve(e.ref);
      if (r?.sourceId ?? namedSourceOf(e.ref, bySource)) continue;
      if (r && PROJECT_HELD.has(r.kind)) continue;
      unknown += 1;
    }
    return unknown;
  };
  /**
   * The answer that lets this step through its failing checks: the latest
   * answered waiver question for it, when that answer accepted the output.
   * Null when there is none, or when the latest answer asked for another
   * attempt or stopped.
   */
  const waiverOf = (stepRunId: string): Decision | null => {
    const answered = listStepDecisions(store, stepRunId).filter((d) => d.state === 'resolved' && (d.subject as { waiverFor?: string } | null)?.waiverFor === stepRunId);
    const latest = answered[answered.length - 1];
    return latest && String(latest.resolution ?? '').toLowerCase().startsWith('accept') ? latest : null;
  };
  /** The checks a waiver question named: the ones the answer to it accepted. */
  const waivedChecks = (d: Decision): string[] => {
    const subject = (d.subject ?? {}) as { validators?: unknown; problems?: unknown };
    if (Array.isArray(subject.validators)) return subject.validators.filter((v): v is string => typeof v === 'string');
    const problems = Array.isArray(subject.problems) ? subject.problems.filter((p): p is string => typeof p === 'string') : [];
    return [...new Set(problems.map((p) => p.split(':')[0]!.trim()).filter(Boolean))];
  };
  /** Any step of the run went through on a waiver; its deliverable is then never called validated. */
  const runHasWaiver = (runId: string): boolean => listSteps(store, runId).some((st) => Array.isArray((st.output as { waived?: unknown } | null)?.waived));
  /** Every check the run's steps went through without passing, with who accepted it and how, in step order. */
  const runWaivers = (runId: string): Waiver[] => {
    const out: Waiver[] = [];
    for (const st of listSteps(store, runId)) {
      const output = (st.output ?? {}) as { waived?: unknown; waivedBy?: { by?: unknown; channel?: unknown } };
      if (!Array.isArray(output.waived)) continue;
      const by = typeof output.waivedBy?.by === 'string' ? output.waivedBy.by : null;
      const channel = (DECISION_CHANNELS as readonly unknown[]).includes(output.waivedBy?.channel) ? (output.waivedBy!.channel as DecisionChannel) : null;
      for (const w of output.waived as { validator?: unknown; problems?: unknown }[]) {
        if (!w || typeof w.validator !== 'string') continue;
        const problems = Array.isArray(w.problems) ? w.problems.filter((p): p is string => typeof p === 'string') : [];
        out.push({ stepId: st.stepId, validator: w.validator, problems, acceptedBy: by, channel });
      }
    }
    return out;
  };
  /** Every distinct citation the run's finished steps made, plus this one's: what the deliverable rests on. */
  const runEvidence = (runId: string, current: readonly { readonly ref: string }[]): { ref: string }[] => {
    const refs = new Set(current.map((e) => e.ref));
    for (const st of listSteps(store, runId)) {
      if (st.state !== 'succeeded') continue;
      const ev = (st.output as { evidence?: unknown } | null)?.evidence;
      if (Array.isArray(ev)) for (const e of ev) if (e && typeof (e as { ref?: unknown }).ref === 'string') refs.add((e as { ref: string }).ref);
    }
    return [...refs].map((ref) => ({ ref }));
  };
  /** The keys coverageFor writes into a deliverable over what its last step was handed. */
  const coverageKeys = (run: WorkflowRun): string[] => {
    const asked = askedOf(run);
    return [...(asked.period ? ['period'] : []), ...((asked.sources?.registered ?? []).length ? ['sources'] : [])];
  };
  /**
   * What a deliverable says about the period its run covers and the sources
   * it names: where everything the run cited falls against the period, which
   * named sources something was cited from, and what the run's finished
   * steps (and this one) listed under outsidePeriod and unread. Null where
   * no resolver was supplied to place the citations.
   */
  const coverageFor = (run: WorkflowRun, current: readonly { readonly ref: string }[], output: unknown, resolve?: RefResolver): Record<string, unknown> => {
    const asked = askedOf(run);
    const ids = asked.sources?.registered ?? [];
    if (!asked.period && ids.length === 0) return {};
    const evidence = runEvidence(run.id, current);
    const outputs = [...listSteps(store, run.id).filter((st) => st.state === 'succeeded').map((st) => st.output), output];
    const outside: OutsidePeriod[] = outputs.flatMap(outsidePeriodOf);
    const unread: Unread[] = outputs.flatMap(unreadOf);
    return {
      ...(asked.period ? { period: { ...asked.period, coverage: resolve ? periodCoverage(evidence, resolve, asked.period, outside) : null } } : {}),
      ...(ids.length ? { sources: resolve ? sourcesCoverage(evidence, resolve, ids, unread) : { named: [...ids], read: null, unread: null } } : {}),
    };
  };
  /**
   * What a deliverable says: what the step returned, then what the last step
   * was handed (which wins over a restatement), the step's evidence, the
   * highest sensitivity among what the run cited and the deliverable it acts
   * on (null when none carries a label), how many citations come from no
   * declared source so their sensitivity is unknown, how much of the run's
   * evidence Construct opened itself or holds only on the host's word, where it
   * falls against the period and the named sources, and every check the
   * run went through without passing, with who accepted it and how. The
   * kernel's keys win over the step's own; waived is left out when nothing
   * was waived, and a waivedBy the step sent is never kept.
   */
  const deliverableBody = (run: WorkflowRun, output: Readonly<Record<string, unknown>>, handed: Readonly<Record<string, unknown>>, evidence: readonly { readonly ref: string; readonly excerpt?: string }[], sensitivity: string | null, resolve?: RefResolver): Record<string, unknown> => {
    const waived = runWaivers(run.id);
    return {
      ...output,
      ...handed,
      evidence,
      sensitivity: sensitivity ?? null,
      sensitivityUnknown: sensitivityUnknownFor(run, evidence, resolve),
      provenance: resolve ? provenanceOf(runEvidence(run.id, evidence), resolve) : null,
      ...coverageFor(run, evidence, output, resolve),
      waived: waived.length ? waived : undefined,
      waivedBy: undefined,
    };
  };

  const leaseMs = deps.defaultLeaseMs ?? 30 * 60_000;
  const policyContext = (interactionClass: PolicyContext['interactionClass'], at: string): PolicyContext => ({
    at,
    interactionClass,
    projectWritePolicy: deps.projectWritePolicy,
    explicitRememberRequest: interactionClass === 'remember',
  });

  /** When and in what timezone a period input is checked: a run's own at the instant its period was worked out. */
  interface PeriodClock { readonly periodAt?: string; readonly timezone?: string }

  function clockOf(run: WorkflowRun): PeriodClock {
    const period = askedOf(run).period;
    return period ? { periodAt: period.resolvedAt, timezone: period.timezone } : {};
  }

  function resolutionFor(workflowId: string, input: Readonly<Record<string, unknown>>, executorId: string, clock: PeriodClock = {}): Resolution {
    return resolveWorkflow({
      workflowId,
      input,
      skills: deps.skills,
      workflows: deps.workflows,
      lock: deps.lock,
      host: { ...deps.host, executorId },
      sources: deps.sources(),
      store,
      at: deps.now(),
      periodAt: clock.periodAt,
      timezone: clock.timezone,
      targetSystemFor: deps.targetSystemFor,
    });
  }

  /**
   * The resolution a run is created or re-resolved on: the resolver's answer,
   * and for a workflow that blocks on stale data, blocked by any stale or
   * unread source its steps read.
   */
  function startResolution(workflowId: string, input: Readonly<Record<string, unknown>>, executorId: string, clock: PeriodClock = {}): Resolution {
    const resolution = resolutionFor(workflowId, input, executorId, clock);
    const m = resolution.workflow?.manifest;
    if (!m || m.onStaleData !== 'block' || (resolution.status !== 'runnable' && resolution.status !== 'outdated')) return resolution;
    const kinds = new Set(m.steps.flatMap((s) => s.sources.map((src) => src.kind)));
    const stale = deps.sources().filter((s) => kinds.has(s.kind) && (s.freshness === 'stale' || s.freshness === 'never_read'));
    if (stale.length === 0) return resolution;
    return {
      ...resolution,
      status: 'blocked',
      reasons: [...resolution.reasons, ...stale.map((s) => ({ code: 'stale_source' as const, stepId: null, message: `${s.id} is ${s.freshness === 'stale' ? 'stale' : 'unread'} and this workflow blocks on stale data`, remedy: `Refresh ${s.id}.` }))],
      summary: `${m.id} ${m.version} is blocked: ${stale.map((s) => `${s.id} ${s.freshness === 'stale' ? 'stale' : 'unread'}`).join(', ')} (onStaleData: block)`,
    };
  }

  /** Structure sets the floor; declared stakes, the chosen skill and the words only raise it. */
  function judgmentFor(workflow: RegisteredWorkflow | null, steps: readonly WorkflowStep[], input: Readonly<Record<string, unknown>>, declared?: Declared | null): Judgment {
    return assessConsequence({
      scale: getProfile(store)?.scale ?? null,
      workflowChallenge: workflow?.manifest.deliverable.challenge ?? false,
      stepTiers: steps.map((s) => s.tier),
      boundSkills: steps.flatMap((s) => (s.skill ? [s.skill.id] : [])),
      chosenSkill: declared?.chosenSkill ?? null,
      activeContradictions: activeContradictionCount(store),
      stakes: declared?.stakes ?? null,
      words: wordsOf(input, declared?.words ?? undefined),
    });
  }

  /** Recomputed every time from the run's frozen steps and reading; run.preflight.judgment is only what was shown. */
  function judgmentOf(run: WorkflowRun): Judgment {
    return judgmentFor(deps.workflows.get(run.workflowId), stepsOf(run), (run.input ?? {}) as Record<string, unknown>, askedOf(run).declared);
  }

  /** What raised a judgment, in plain words; the workflow's own flag when nothing else did. */
  function raisedBy(judgment: Judgment): string {
    const raised = judgment.signals.filter((s) => s.raises).map((s) => s.detail);
    return raised.length ? raised.join('; ') : 'the workflow declares that its deliverable must be challenged';
  }

  /**
   * A named source whose last read cannot cover a period that has ended:
   * never read, or last read on a day before the period's end.
   */
  function coverageFlags(period: ResolvedPeriod | null, sourceIds: readonly string[] | null): string[] {
    if (!period || !sourceIds?.length || period.to > calendarDate(deps.now(), period.timezone)) return [];
    const known = new Map(deps.sources().map((s) => [s.id, s]));
    const flags: string[] = [];
    for (const id of sourceIds) {
      const source = known.get(id);
      if (!source) continue;
      const read = source.lastReadAt ? calendarDate(source.lastReadAt, period.timezone) : null;
      if (read === null) flags.push(`${id} has not been read here, so nothing shows the period up to ${period.to} is covered; read it so the whole period is covered`);
      else if (read < period.to) flags.push(`${id} was last read ${read}, before the period ends (${period.to}); read it again so the whole period is covered`);
    }
    return flags;
  }

  function preflightOf(resolution: Resolution, input: Readonly<Record<string, unknown>> = {}, declared?: Declared | null, slots: { readonly period?: ResolvedPeriod | null; readonly sourceIds?: readonly string[] | null } = {}): Preflight {
    const flags: string[] = [];
    if (resolution.workflow?.manifest.onStaleData === 'proceed_flagged') {
      const stale = deps.sources().filter((s) => s.freshness === 'stale');
      if (stale.length) flags.push(`proceeding with stale sources: ${stale.map((s) => s.id).join(', ')}`);
    }
    const period = slots.period ?? null;
    flags.push(...coverageFlags(period, slots.sourceIds ?? null));
    const judgment = judgmentFor(resolution.workflow, resolution.plan.map((p) => p.step), input, declared);
    if (judgment.challenge) flags.push(`challenge required: ${judgment.why}`);
    const workflow = resolution.workflow;
    return {
      status: resolution.status,
      summary: resolution.summary,
      approvalsAhead: resolution.plan.filter((p) => p.needsApproval).map((p) => p.step.id),
      reasons: resolution.reasons.map((r) => ({ code: r.code, stepId: r.stepId, message: r.message, remedy: r.remedy, ...(r.slot ? { slot: r.slot } : {}) })),
      flags,
      judgment,
      period,
      assumptions: period?.assumptions ?? [],
      questions: workflow ? resolution.reasons.flatMap((r) => (r.code === 'missing_step_input' && r.slot ? [slotQuestion(r.slot, workflow)] : [])) : [],
    };
  }

  /** The preflight of a run that exists, from its frozen reading. */
  function runPreflight(run: WorkflowRun, resolution: Resolution): Preflight {
    const asked = askedOf(run);
    return preflightOf(resolution, (run.input ?? {}) as Record<string, unknown>, asked.declared, { period: asked.period, sourceIds: asked.sources?.registered ?? null });
  }

  function stepsOf(run: WorkflowRun): readonly WorkflowStep[] {
    const frozen = run.bindings as { steps?: readonly WorkflowStep[] } | null;
    if (frozen && Array.isArray(frozen.steps) && frozen.steps.length > 0) return frozen.steps;
    return deps.workflows.get(run.workflowId)?.manifest.steps ?? [];
  }

  /**
   * Resolve a blocked run again where it stands, inside the caller's
   * transaction. Once nothing blocks it, it gets its steps and is ready;
   * otherwise it stays blocked with the reasons as they are now.
   */
  function resumeBlocked(run: WorkflowRun, at: string, reason: string): { readonly run: WorkflowRun; readonly resolution: Resolution; readonly preflight: Preflight } {
    const input = (run.input ?? {}) as Record<string, unknown>;
    const resolution = startResolution(run.workflowId, input, run.executorId, clockOf(run));
    const preflight = runPreflight(run, resolution);
    if (resolution.status === 'runnable' || resolution.status === 'outdated') {
      const roots = new Set(readySteps(resolution.workflow!.manifest.steps, new Set()).map((s) => s.id));
      if (listSteps(store, run.id).length === 0) {
        resolution.plan.forEach((bound, i) => addStep(store, { id: deps.nextId('step'), runId: run.id, stepId: bound.step.id, ordinal: i, permissionTier: bound.step.tier, maxAttempts: bound.step.retry.maxAttempts, input: { skill: bound.skill, needsApproval: bound.needsApproval }, ready: roots.has(bound.step.id), at }));
      }
      return { run: transitionRun(store, { id: run.id, to: 'ready', at, reason, preflight }), resolution, preflight };
    }
    transitionRun(store, { id: run.id, to: 'preflight', at, reason: 'still blocked', preflight });
    return { run: transitionRun(store, { id: run.id, to: 'blocked', at, reason: resolution.summary }), resolution, preflight };
  }

  /** Mark every pending step whose needs are done as ready, and settle the run when everything is terminal. */
  function advance(runId: string, at: string): WorkflowRun {
    return store.transaction(() => {
      const run = getRun(store, runId)!;
      if (['succeeded', 'failed', 'cancelled'].includes(run.state)) return run;
      if (run.cancelRequested) {
        const stepRuns = listSteps(store, runId);
        const leased = stepRuns.filter((s) => s.state === 'leased');
        for (const s of stepRuns) {
          if (s.state === 'pending' || s.state === 'ready' || s.state === 'waiting_for_decision') {
            transitionStep(store, { id: s.id, to: 'cancelled', at, reason: run.stateReason ?? 'cancelled' });
          }
        }
        if (leased.length === 0) {
          return transitionRun(store, { id: runId, to: 'cancelled', at, reason: run.stateReason ?? 'cancelled' });
        }
        return run;
      }
      const manifestSteps = stepsOf(run);
      const stepRuns = listSteps(store, runId);
      const done = new Set(stepRuns.filter((s) => s.state === 'succeeded' || s.state === 'skipped').map((s) => s.stepId));
      for (const ready of readySteps(manifestSteps, done)) {
        const sr = stepRuns.find((s) => s.stepId === ready.id);
        if (sr && sr.state === 'pending') transitionStep(store, { id: sr.id, to: 'ready', at });
      }
      const after = listSteps(store, runId);
      const failed = after.find((s) => s.state === 'failed');
      if (failed) {
        for (const s of after) if (s.state === 'pending' || s.state === 'ready') transitionStep(store, { id: s.id, to: 'cancelled', at, reason: `step ${failed.stepId} failed` });
        return transitionRun(store, { id: runId, to: 'failed', at, reason: `step ${failed.stepId} failed: ${failed.stateReason ?? 'no reason recorded'}` });
      }
      const cancelled = after.find((s) => s.state === 'cancelled');
      if (cancelled && after.every((s) => ['succeeded', 'skipped', 'cancelled', 'failed'].includes(s.state))) {
        return transitionRun(store, { id: runId, to: 'cancelled', at, reason: cancelled.stateReason ?? `step ${cancelled.stepId} cancelled` });
      }
      if (after.every((s) => s.state === 'succeeded' || s.state === 'skipped')) {
        return transitionRun(store, { id: runId, to: 'succeeded', at });
      }
      if (run.state === 'ready' && after.some((s) => s.state === 'leased')) return transitionRun(store, { id: runId, to: 'running', at });
      return getRun(store, runId)!;
    });
  }

  /** A step's inputs; one read from a period input gets the period in dates the run was created with. */
  function inputsFor(run: WorkflowRun, step: WorkflowStep): Record<string, unknown> {
    const runInput = (run.input ?? {}) as Record<string, unknown>;
    const stepRuns = listSteps(store, run.id);
    const schema = deps.workflows.get(run.workflowId)?.manifest.inputSchema ?? {};
    const period = askedOf(run).period ?? null;
    const out: Record<string, unknown> = {};
    for (const [key, ref] of Object.entries(step.inputs)) {
      if (ref.startsWith('input.')) {
        const name = ref.slice('input.'.length);
        out[key] = schema[name] === 'period' && period ? period : runInput[name];
      } else {
        const [, upstreamId, output] = ref.split('.') as [string, string, string];
        const upstream = stepRuns.find((s) => s.stepId === upstreamId);
        out[key] = upstream && upstream.output && typeof upstream.output === 'object' ? (upstream.output as Record<string, unknown>)[output] : undefined;
      }
    }
    const answers = runInput.answers;
    if (answers && typeof answers === 'object') out.answers = answers;
    return out;
  }

  /** The run's last step, which hands the deliverable back. */
  function isLastStep(run: WorkflowRun, step: WorkflowStep): boolean {
    const frozen = stepsOf(run);
    return frozen[frozen.length - 1]?.id === step.id;
  }

  /**
   * What the last step is handed and the deliverable carries: each input it
   * declares, under its own name, that has a value. Any other step hands
   * nothing on.
   */
  function handedTo(run: WorkflowRun, step: WorkflowStep): Record<string, unknown> {
    if (!isLastStep(run, step)) return {};
    const inputs = inputsFor(run, step);
    const out: Record<string, unknown> = {};
    for (const key of Object.keys(step.inputs)) if (inputs[key] !== undefined) out[key] = inputs[key];
    return out;
  }

  /** Why this service's host may not perform `step`, or null when it may. */
  function beyondHost(step: WorkflowStep): string | null {
    if (!tierAtLeast(deps.host.maxTier, step.tier)) {
      return `step ${step.id} acts at ${step.tier}; this executor may reach ${deps.host.maxTier} at most`;
    }
    const missing = step.capabilities.filter((c) => !provides(deps.host, c));
    if (missing.length > 0) return `step ${step.id} needs ${missing.join(', ')}, which this executor does not have`;
    return null;
  }

  /**
   * Gate a step for the executor about to claim it. An approval covers the
   * executor it was given to, so a different session claiming the same step
   * gets its own decision rather than inheriting another session's grant.
   */
  function gateStep(run: WorkflowRun, stepRun: StepRun, step: WorkflowStep, at: string, executorId: string): Gate {
    if (step.tier === 'observe' || step.tier === 'draft') return CLEARED;
    const request: ActionRequest = {
      tier: step.tier,
      targetSystem: deps.targetSystemFor ? deps.targetSystemFor(step) : (step.sources[0]?.kind ?? (step.tier === 'project_write' ? 'project' : 'external')),
      targetResource: step.tier === 'project_write' ? run.id : ((run.input as Record<string, unknown> | null)?.target as string | undefined) ?? `${run.workflowId}:${step.id}`,
      operation: `${step.title} (${run.workflowId}/${step.id})`,
      workflowId: run.workflowId,
      executorId,
      runId: run.id,
    };
    const context = policyContext(run.interactionClass, at);
    const decision = evaluateAction(store, request, context);
    if (decision.allowed) return CLEARED;
    const open = listOpenDecisions(store, run.id).find((d) => d.stepRunId === stepRun.id);
    if (open) return { outcome: 'decision', decision: open };
    // The person approved this step for a different executor. While that
    // executor's grant stands, the step waits for it: another claimer neither
    // inherits the approval nor puts a fresh question in front of the person.
    // Once the grant has lapsed it covers no one, and this claimer is asked.
    for (const d of listStepDecisions(store, stepRun.id).reverse()) {
      if (d.kind !== 'approval' || d.state !== 'resolved' || d.resolution !== 'approve') continue;
      const approvedFor = (d.subject as { request?: ActionRequest } | null)?.request?.executorId;
      if (!approvedFor || approvedFor === executorId) continue;
      const theirs = evaluateAction(store, { ...request, executorId: approvedFor }, context);
      if (theirs.allowed && theirs.grant) return { outcome: 'held', executorId: approvedFor, until: theirs.grant.endsAt };
    }
    // One unit: the question, the step's pause, and the run's pause land together
    // or not at all. A run whose first step needs the question has started.
    const raised = store.transaction(() => {
      const question = raiseDecision(store, {
        id: deps.nextId('decision'),
        kind: decision.denial.stepUp.kind === 'approval' ? 'approval' : 'blocked',
        question: decision.denial.stepUp.kind === 'approval' ? decision.denial.stepUp.description : `${decision.denial.missing}. ${decision.denial.stepUp.description}`,
        runId: run.id,
        stepRunId: stepRun.id,
        options: decision.denial.stepUp.kind === 'approval' ? ['approve', 'decline'] : undefined,
        subject: { request, stepUp: decision.denial.stepUp, attempted: decision.denial.attempted, safeNow: decision.denial.safeNow },
        at,
      });
      if (stepRun.state === 'ready') transitionStep(store, { id: stepRun.id, to: 'waiting_for_decision', at, reason: 'awaiting approval' });
      const current = getRun(store, run.id)!;
      if (current.state === 'ready') transitionRun(store, { id: run.id, to: 'running', at });
      if (current.state === 'ready' || current.state === 'running') transitionRun(store, { id: run.id, to: 'waiting_for_decision', at, reason: `step ${step.id} needs a decision` });
      return question;
    });
    return { outcome: 'decision', decision: raised };
  }

  /** Perform a step the kernel runs itself: deterministic drift detection needs no host. */
  function runKernelStep(run: WorkflowRun, sr: StepRun, step: WorkflowStep, at: string): void {
    const leased = claimStep(store, { owner: 'kernel', now: at, leaseUntil: new Date(Date.parse(at) + 60_000).toISOString(), runId: run.id, stepRunId: sr.id });
    if (!leased) return;
    const detected = detectDrift(store, { at, requireDecisionForChanges: false });
    const { recorded, alreadyOpen } = recordDrift(store, { runId: run.id, detected, at, nextId: deps.nextId });
    completeStep(store, { id: leased.id, owner: 'kernel', token: leased.token, at, output: { findings: detected, recordedFindingIds: recorded.map((f) => f.id), alreadyOpen, noDrift: detected.length === 0, evidence: detected.flatMap((d) => d.evidence.map((e) => ({ ref: e.ref, excerpt: e.note }))) } });
    appendActivity(store, { at, kind: 'step.kernel_ran', runId: run.id, stepRunId: sr.id, actor: 'kernel', payload: { stepId: step.id, findings: detected.length, recorded: recorded.length } });
  }

  /** What one run offers a claimer: a packet or a reason to stop, else the first hold or refusal met. */
  interface RunClaim {
    readonly outcome: ClaimOutcome | null;
    readonly held: Extract<WaitingOn, { kind: 'held' }> | null;
    readonly refused: Extract<WaitingOn, { kind: 'refused' }> | null;
  }

  /**
   * Gate and lease within one run. The caller holds the write transaction, so
   * no other session can make a step ready, or take one, between the gate
   * clearing a step and this claimer leasing it; and only a cleared step is
   * leased. A held or refused step is passed over, so the run's other ready
   * steps stay claimable.
   */
  function claimInRun(runId: string, who: string, at: string, leaseUntil: string): RunClaim {
    let held: RunClaim['held'] = null;
    let refused: RunClaim['refused'] = null;
    const stop = (waitingOn: WaitingOn): RunClaim => ({ outcome: { packet: null, waitingOn }, held, refused });
    let run = getRun(store, runId);
    if (!run || run.state === 'blocked') return { outcome: null, held, refused };
    if (run.state === 'waiting_for_decision') {
      const open = listOpenDecisions(store, run.id)[0];
      if (open) return stop({ kind: 'decision', decision: open });
      run = transitionRun(store, { id: run.id, to: 'running', at });
    }
    if (['succeeded', 'failed', 'cancelled'].includes(run.state)) return { outcome: null, held, refused };
    const currentWorkflow = deps.workflows.get(run.workflowId);
    if (run.workflowDigest && currentWorkflow && currentWorkflow.digest !== run.workflowDigest) {
      return stop({ kind: 're_resolve', reason: `workflow ${run.workflowId} changed since this run was bound; re-resolve before continuing` });
    }
    advance(run.id, at);
    const manifestSteps = stepsOf(run);
    // A kernel step can make further steps ready; each pass gates what is ready now.
    for (let pass = 0; pass <= manifestSteps.length; pass += 1) {
      const cleared: { readonly sr: StepRun; readonly step: WorkflowStep }[] = [];
      for (const sr of listSteps(store, run.id).filter((s) => s.state === 'ready')) {
        const step = manifestSteps.find((s) => s.id === sr.stepId)!;
        const beyond = performedByKernel(step) ? null : beyondHost(step);
        if (beyond) {
          refused ??= { kind: 'refused', runId: run.id, stepId: step.id, reason: beyond };
          continue;
        }
        const gate = gateStep(getRun(store, run.id)!, sr, step, at, who);
        if (gate.outcome === 'decision') return stop({ kind: 'decision', decision: gate.decision });
        if (gate.outcome === 'held') {
          held ??= { kind: 'held', runId: run.id, stepId: step.id, executorId: gate.executorId, until: gate.until };
          continue;
        }
        cleared.push({ sr, step });
      }
      const kernelSteps = cleared.filter((c) => performedByKernel(c.step));
      if (kernelSteps.length > 0) {
        for (const { sr, step } of kernelSteps) runKernelStep(run, sr, step, at);
        advance(run.id, at);
        continue;
      }
      for (const sr of listSteps(store, run.id).filter((s) => s.state === 'ready')) {
        const boundSkill = (sr.input as { skill?: { id: string; digest: string } | null } | null)?.skill ?? null;
        const registeredSkill = boundSkill ? deps.skills.get(boundSkill.id) : null;
        if (boundSkill && registeredSkill && registeredSkill.digest !== boundSkill.digest) {
          return stop({ kind: 're_resolve', reason: `skill ${boundSkill.id} changed since this run was bound; re-resolve before continuing` });
        }
      }
      const next = cleared[0];
      if (!next) break;
      const leased = claimStep(store, { owner: who, now: at, leaseUntil, runId: run.id, stepRunId: next.sr.id });
      if (!leased) break;
      const fresh = getRun(store, run.id)!;
      if (fresh.state === 'ready') transitionRun(store, { id: run.id, to: 'running', at });
      return { outcome: { packet: packetFor(leased, next.step), waitingOn: null }, held, refused };
    }
    return { outcome: null, held, refused };
  }

  /**
   * What every step of a run is told about the period it covers and the
   * sources it names; a step that checks citations against the period is
   * also told what it refuses. A period the workflow takes no input for is
   * named as unchecked, and systems the reading names that are not
   * registered are counted, never named.
   */
  function readingInstructions(run: WorkflowRun, step: WorkflowStep): string[] {
    const asked = askedOf(run);
    const lines: string[] = [];
    const p = asked.period;
    const schema = deps.workflows.get(run.workflowId)?.manifest.inputSchema;
    const checksPeriod = !schema || Object.values(schema).includes('period');
    if (p && checksPeriod) {
      const covers = p.semantics === 'as_of'
        ? `This run covers things as of ${p.to} (${p.timezone}) in this run's reading. Describe them as they stood at the end of that day.`
        : `This run covers ${p.from ?? 'the start'} to ${p.to} (${p.timezone}; ${p.semantics === 'changed_during' ? 'what changed during it' : 'evidence window'}) in this run's reading.`;
      const refused = step.validators.includes('within_period')
        ? ` An item updated after ${p.to} is refused unless you list it under "outsidePeriod" as {ref, why}, saying why it belongs.`
        : '';
      lines.push(covers + refused);
    } else if (p) {
      lines.push(`The period in this run's reading is ${p.from ? `${p.from}..${p.to}` : `as of ${p.to}`} (${p.semantics}); this workflow does not check it, so keep to it yourself.`);
    }
    const ids = asked.sources?.registered ?? [];
    if (ids.length) lines.push(`Read the sources this run names: ${ids.join(', ')}; cite items as <source>:<item>. Before you submit, record what you read with sources action report; a source Construct reads itself takes action refresh instead. A named source you could not read goes under "unread" as {source, why}.`);
    const unregistered = (asked.sources?.named ?? []).filter((n) => !n.registered).length;
    if (unregistered > 0 && readsAnything(step.capabilities)) {
      lines.push(`This request named ${String(unregistered)} system(s) that are not registered with Construct. Read only ones the person named, declare each with sources action declare and report what you read before citing it; say plainly that Construct could not check anything you did not report.`);
    }
    return lines;
  }

  /** The method the run's reading chose, for a step that binds no skill of its own and does judgment work. */
  function methodFor(run: WorkflowRun, step: WorkflowStep, bound: unknown): WorkPacket['method'] {
    if (bound || step.skill || !step.capabilities.includes('model_review')) return null;
    const chosen = askedOf(run).declared?.chosenSkill ?? null;
    const skill = chosen ? deps.skills.get(chosen) : null;
    return skill ? { id: skill.manifest.id, version: skill.manifest.version, title: skill.manifest.title } : null;
  }

  /**
   * What a step accepted with its failing checks is told, by how that answer
   * arrived: the person's own word, or the host's relay of it, which is
   * recorded as the host's and never as the person's.
   */
  function waiverInstruction(waiver: Decision | null): string {
    if (!waiver) return '';
    const checks = waivedChecks(waiver).join(', ') || 'the ones the question named';
    if (waiver.channel && isPersonChannel(waiver.channel)) {
      return `The person accepted this step's output with its failing checks (${checks}). Resubmit the output they reviewed; the deliverable will list these checks as waived and will not be called validated.`;
    }
    if (waiver.channel === 'relay') {
      return `You relayed "accept with these problems"; Construct records that as your relay, not as the person's own answer. Resubmit the same output; the deliverable will list these checks (${checks}) as waived, will not be called validated, and the person will see the waiver before accepting it.`;
    }
    return `This step's failing checks (${checks}) were accepted, and Construct holds no record of how that answer arrived. Resubmit the same output; the deliverable will list these checks as waived, will not be called validated, and the person will see the waiver before accepting it.`;
  }

  /** Everything the claimer needs to do one leased step. */
  function packetFor(leased: LeasedStep, step: WorkflowStep): WorkPacket {
    const run = getRun(store, leased.runId)!;
    const bound = (leased.input as { skill?: { id: string; version: string; digest: string } | null } | null)?.skill ?? null;
    const registered = bound ? deps.skills.get(bound.id) : null;
    const judgment = judgmentOf(run);
    const workflowChallenge = deps.workflows.get(run.workflowId)?.manifest.deliverable.challenge ?? false;
    const needsChallenge = judgmentRequired(workflowChallenge, judgment);
    // A key the step also returns is its own to restate; the rest the deliverable already carries, the period and
    // named sources with what the run's citations cover.
    const method = methodFor(run, step, bound);
    const handed = Object.keys(handedTo(run, step)).filter((k) => !step.outputs.includes(k));
    const covered = coverageKeys(run);
    const asReceived = handed.filter((k) => !covered.includes(k));
    const withCoverage = handed.filter((k) => covered.includes(k));
    const carriedParts = [
      asReceived.length ? `${asReceived.join(', ')} into the deliverable as this step received them` : '',
      withCoverage.length ? `${withCoverage.join(', ')}${asReceived.length ? '' : ' into the deliverable'} with what the run's citations cover` : '',
    ].filter(Boolean);
    const instructions = [
      `Step ${step.id}: ${step.title}.`,
      step.tier === 'observe' || step.tier === 'draft' ? 'Read and draft only; apply nothing.' : `This step may act at ${step.tier}; the gate has already been passed for exactly this step.`,
      step.outputs.length ? `Return an object with: ${step.outputs.join(', ')}.` : 'Return an object with what you found.',
      carriedParts.length ? `Construct carries ${carriedParts.join(', and ')}; return only what this step adds.` : '',
      step.validators.length ? `It will be checked by: ${step.validators.join(', ')}.` : '',
      ...validatorGuidance(step.validators),
      method ? `Use the ${method.title} method for this step; load it with skills show (id ${method.id}) and includeBody.` : '',
      ...readingInstructions(run, step),
      ...governingInstructions(step.capabilities),
      waiverInstruction(waiverOf(leased.id)),
      'Cite every source you read as evidence entries.',
      needsChallenge
        ? `This run must be challenged before it is accepted: ${raisedBy(judgment)}. Apply adversarial review before calling the result strongly validated; do not wait to be asked.`
        : judgment.depth === 'light'
          ? 'The person set this up as a side project and nothing in the work raised the stakes: keep the process small; no adversarial review is required.'
          : '',
    ].filter(Boolean);
    return {
      leased,
      run,
      step,
      skill: bound && registered
        ? { id: bound.id, version: bound.version, digest: bound.digest, body: () => deps.skills.body(bound.id), file: (p) => deps.skills.file(bound.id, p) }
        : null,
      inputs: inputsFor(run, step),
      instructions,
      judgment,
      intake: workIntakeOf(askedOf(run)),
      method,
    };
  }

  /** Everything a trust move to `to` must satisfy, checked before the person is asked and again when it applies. */
  function assertPromotable(deliverableId: string, to: TrustState): Deliverable {
    const current = getDeliverable(store, deliverableId);
    if (!current) throw new Error(`no deliverable ${deliverableId}`);
    if (to === 'validated') throw new Error(VALIDATED_BY_CHECKS);
    if (to === 'final' && current.trustState !== 'accepted') throw new Error('a deliverable is final only after it was accepted');
    const run = getRun(store, current.runId);
    if (run && (to === 'accepted' || to === 'final')) {
      if (activeContradictionCount(store) > 0) {
        throw new Error('an active contradiction stands against a governing obligation; it cannot become a trusted finished outcome');
      }
      const workflow = deps.workflows.get(run.workflowId);
      const judgment = judgmentOf(run);
      if (judgmentRequired(workflow?.manifest.deliverable.challenge ?? false, judgment) && to === 'accepted' && current.trustState !== 'challenged') {
        throw new Error(`this outcome is accepted only after a recorded challenge, because ${raisedBy(judgment)}`);
      }
      const body = current.body && typeof current.body === 'object' ? (current.body as Record<string, unknown>) : null;
      if (body) {
        const facts = runValidators(['no_placeholder_facts'], { output: body, expectedKeys: [], evidence: [], resolvableRefs: new Set() });
        if (facts[0] && !facts[0].ok) throw new Error(facts[0].problems.join('; '));
      }
    }
    return current;
  }

  /**
   * The open question asking the person to move a deliverable to `to`, as
   * the deliverable stands now: an open one whose question still describes
   * it, or a new one. Every other open question about the same move is
   * withdrawn, so only the current one waits.
   */
  function askForPromotion(input: { readonly deliverableId: string; readonly to: TrustState; readonly by: string; readonly reason?: string | null }, at: string): Decision {
    const { deliverableId, to, by, reason } = input;
    return store.transaction(() => {
      const current = assertPromotable(deliverableId, to);
      const asking = listOpenDecisions(store, current.runId).filter((d) => {
        const p = (d.subject as { promote?: PromotionSubject } | null)?.promote;
        return d.kind === 'approval' && p?.deliverableId === deliverableId && p.to === to;
      });
      const standing = asking.find((d) => d.question === acceptanceBrief(current, to, d.id));
      for (const d of asking) if (d !== standing) withdrawDecision(store, { id: d.id, reason: 'superseded by a current brief', at });
      if (standing) return standing;
      const id = deps.nextId('decision');
      const question = acceptanceBrief(current, to, id);
      const whole = acceptanceBrief(current, to, undefined, BRIEF_RECORD_CAP);
      return raiseDecision(store, {
        id,
        kind: 'approval',
        question,
        runId: current.runId,
        options: ['approve', 'decline'],
        // The whole prompt is kept beside a cut one, for construct inbox show.
        subject: { promote: { deliverableId, to, reason: reason ?? null, requestedBy: by } satisfies PromotionSubject, ...(whole !== question ? { brief: whole } : {}) },
        at,
      });
    });
  }

  /** How a waiver's answer reached Construct, in the person's terms. */
  function waivedHow(w: Waiver): string {
    if (w.channel && isPersonChannel(w.channel)) return 'by you';
    return w.channel === 'relay' ? 'relayed by your assistant' : 'with no record of who answered';
  }

  /**
   * The declared sources an assistant declared from chat, and the person has
   * not added since, that this deliverable rests on: ones the run cited or
   * names, and ones declared by the run's session or while the run worked,
   * up to when the deliverable was made. A declaration after that, by any
   * session, is not this deliverable's.
   */
  function assistantDeclared(run: WorkflowRun, d: Deliverable, cited: ReadonlySet<string>): string[] {
    const local = new Set(listSources(store, { status: 'active' }).filter((x) => x.origin === 'local').map((x) => x.id));
    if (local.size === 0) return [];
    const out: string[] = [];
    const page = 1000;
    for (let after = 0; ; ) {
      const events = listActivity(store, { kind: 'source.declared', afterId: after, limit: page });
      for (const e of events) {
        const id = isObject(e.payload) ? e.payload.sourceId : undefined;
        if (typeof id !== 'string' || !local.has(id) || out.includes(id)) continue;
        const sameSession = run.sessionId !== null && e.sessionId === run.sessionId;
        const whileWorking = e.at <= d.createdAt && (sameSession || e.at >= run.createdAt);
        if (cited.has(id) || whileWorking) out.push(id);
      }
      if (events.length < page) break;
      after = events[events.length - 1]!.id;
    }
    return out;
  }

  /**
   * What the person is asked before a deliverable moves to accepted or
   * final: the move, from the trust it holds now; then what Construct holds,
   * one fact per line (checks waived and by whom, the checks that passed,
   * how much of what it rests on Construct opened itself, a verification the
   * assistant reports running, the highest sensitivity cited, sources the
   * assistant declared, systems named but never registered, where the
   * citations fall against the period and the named sources, and the
   * challenge record); then the assistant's own words, quoted under their
   * label. Each list shows three entries and how many more. Cut at the
   * prompt cap, pointing at `more` for the rest.
   */
  function acceptanceBrief(d: Deliverable, to: TrustState, more?: string, cap?: number): string {
    const run = getRun(store, d.runId);
    const body = isObject(d.body) ? d.body : {};
    const verification = isObject(d.verification) ? d.verification : {};
    const asked = run ? askedOf(run) : {};
    const facts: string[] = [];
    const said: HostSaid[] = [];

    const waivers = run ? runWaivers(run.id) : [];
    if (waivers.length) facts.push(`Waived: ${capped(waivers.map((w) => `${w.validator} on step ${w.stepId} (${waivedHow(w)})`))}. A run that went through on a waiver is never called validated.`);
    const checks = Array.isArray(verification.validators) ? verification.validators.filter(isObject) : [];
    if (checks.length && checks.every((c) => c.ok === true)) facts.push(`Construct's checks passed on the last step: ${capped(checks.map((c) => String(c.validator)), 3, ', ')}.`);

    const p = isObject(body.provenance) ? body.provenance : null;
    if (p) {
      const n = (k: string): number => (typeof p[k] === 'number' ? (p[k] as number) : 0);
      const total = n('witnessed') + n('reported') + n('unverified') + n('unresolved');
      const unchecked = n('unverified') + n('unresolved');
      facts.push(total === 0
        ? 'Nothing this rests on was cited.'
        : `Construct opened ${String(n('witnessed'))} of ${counted(total, 'thing')} this rests on; ${String(n('reported'))} ${n('reported') === 1 ? 'is' : 'are'} your assistant's report of what it read; ${String(unchecked)} could not be checked.`);
    }

    if (run) {
      const verifying = new Set(stepsOf(run).filter((st) => st.validators.includes('verification_result')).map((st) => st.id));
      const verified = listSteps(store, run.id).filter((st) => st.state === 'succeeded' && verifying.has(st.stepId) && isObject(st.output));
      const out = verified.length ? (verified[verified.length - 1]!.output as Record<string, unknown>) : null;
      if (out) {
        const v = isObject(out.verification) ? out.verification : out;
        const command = v.command ?? out.command;
        const exit = v.exitStatus ?? v.exit ?? out.exitStatus;
        const status = typeof exit === 'number' && Number.isInteger(exit) ? `exit ${String(exit)}` : 'no exit status given';
        facts.push(typeof command === 'string' && command.trim()
          ? `Verification: ${quoteHost(command)} was run and reported by your assistant (${status}); Construct did not run it.`
          : `Verification was reported by your assistant without a command (${status}); Construct did not run it.`);
      }
    }

    const level = typeof body.sensitivity === 'string' ? body.sensitivity : null;
    const unknown = typeof body.sensitivityUnknown === 'number' ? body.sensitivityUnknown : 0;
    const unknownText = unknown > 0 ? `${counted(unknown, 'citation')} ${unknown === 1 ? 'comes' : 'come'} from no declared source, so ${unknown === 1 ? 'its' : 'their'} sensitivity is unknown` : '';
    if (level) facts.push(`Highest sensitivity cited: ${level}${unknownText ? `; ${unknownText}` : ''}.`);
    else if (unknownText) facts.push(`No cited source carries a sensitivity label; ${unknownText}.`);

    // Coverage is read only where the kernel wrote it: a run with no period or named sources leaves those keys to the step.
    const coverage = (asked.sources?.registered ?? []).length && isObject(body.sources) ? body.sources : null;
    const named = Array.isArray(coverage?.named) ? coverage.named.filter((x): x is string => typeof x === 'string') : [...(asked.sources?.registered ?? [])];
    const readFrom = Array.isArray(coverage?.read) ? coverage.read.filter((x): x is string => typeof x === 'string') : [];
    if (run) {
      const cited = new Set([...named, ...readFrom]);
      const bySource = new Map(listSources(store, {}).map((x) => [x.id, x.sensitivity]));
      for (const e of runEvidence(run.id, [])) {
        const id = namedSourceOf(e.ref, bySource);
        if (id) cited.add(id);
      }
      const declared = assistantDeclared(run, d, cited);
      if (declared.length) facts.push(`Declared by your assistant, not added by you: ${capped(declared, 3, ', ')}.`);
    }
    const unregistered = (asked.sources?.named ?? []).filter((x) => !x.registered);
    if (unregistered.length) facts.push(`${counted(unregistered.length, 'system')} the request named ${unregistered.length === 1 ? 'is' : 'are'} not registered with Construct, so Construct could not check anything read from ${unregistered.length === 1 ? 'it' : 'them'}.`);

    const period = asked.period && isObject(body.period) ? body.period : null;
    if (period && typeof period.to === 'string') {
      const range = typeof period.from === 'string' ? `${period.from}..${period.to}` : `as of ${period.to}`;
      const means = PERIOD_MEANS[String(period.semantics)] ?? String(period.semantics);
      const cov = isObject(period.coverage) ? period.coverage : null;
      const len = (k: string): number => (Array.isArray(cov?.[k]) ? (cov[k] as unknown[]).length : 0);
      const placed = cov ? `; ${counted(len('before') + len('undated'), 'cited item')} ${len('before') + len('undated') === 1 ? 'is' : 'are'} dated before it or undated${len('after') ? `; ${String(len('after'))} dated after it` : ''}` : '';
      facts.push(`Covers ${range} (${means})${placed}.`);
    }
    // Only a run whose reads were placed can say a named source gave it nothing.
    const notCited = Array.isArray(coverage?.read) ? named.filter((id) => !readFrom.includes(id)) : [];
    if (notCited.length) facts.push(`Nothing was cited from ${capped(notCited, 3, ', ')}, which this run names.`);

    const challenge = isObject(verification.challenge) ? verification.challenge : null;
    if (challenge) {
      const objections = Array.isArray(challenge.objections) ? challenge.objections.filter(isObject) : [];
      const open = objections.filter((o) => o.disposition === 'open');
      const where = challenge.sameSessionAsRun === true ? 'the session that ran the work' : challenge.sameSessionAsRun === false ? 'another session' : 'a session Construct could not identify';
      const by = typeof challenge.by === 'string' && challenge.by.trim() ? flattenHost(challenge.by, 80) : 'someone not recorded';
      facts.push(`Challenged by ${by}, from ${where}: ${counted(objections.length, 'objection')}, ${String(open.length)} open.`);
      for (const o of open) if (typeof o.objection === 'string') said.push({ about: 'open objection', text: o.objection });
    }

    // What the assistant said, quoted: its assumptions, its reasons for what falls after the period or was not read, the objections a challenge left open, where it says the result goes, the systems it named, and the request as it relayed it.
    const hostAssumptions: { about: string; text: string }[] = [];
    const seen = new Set<string>();
    const assume = (about: string, text: string): void => {
      const key = flattenHost(text).toLowerCase();
      if (!key || seen.has(key)) return;
      seen.add(key);
      hostAssumptions.push({ about, text });
    };
    for (const a of asked.assumptions ?? []) if (a.by === 'host') assume(`assumption (${(OPEN_ABOUT as readonly string[]).includes(a.about) ? a.about : 'other'})`, a.text);
    if (run) {
      for (const st of listSteps(store, run.id)) {
        if (st.state !== 'succeeded' || !isObject(st.output) || !Array.isArray(st.output.assumptions)) continue;
        for (const entry of st.output.assumptions) {
          const text = assumptionText(entry);
          if (text) assume(`assumption (step ${st.stepId})`, text);
        }
      }
    }
    const acknowledged = Array.isArray((period?.coverage as { acknowledged?: unknown } | undefined)?.acknowledged) ? ((period!.coverage as { acknowledged: unknown[] }).acknowledged.filter(isObject)) : [];
    const unreadWhy = Array.isArray(coverage?.unread) ? coverage.unread.filter(isObject) : [];
    const destination = asked.intake?.destination?.name ?? null;
    const words = asked.intake?.words ?? asked.declared?.words ?? null;
    return renderPersonPrompt({
      lead: `Move deliverable ${d.id} (${d.kind}) from ${d.trustState} to ${to}?`,
      facts,
      hostSaid: [
        ...hostAssumptions,
        ...acknowledged.map((x) => ({ about: 'dated after the period', text: `${String(x.ref)}: ${String(x.why)}` })),
        ...unreadWhy.map((x) => ({ about: 'not read', text: `${String(x.source)}: ${String(x.why)}` })),
        ...said,
        ...(destination ? [{ about: 'destination', text: destination }] : []),
        ...unregistered.map((x) => ({ about: 'named, not registered', text: x.name })),
        ...(words ? [{ about: 'request', text: words }] : []),
      ],
      more,
      cap,
    });
  }

  /**
   * The verification a deliverable carries once challenged: what it already
   * held, what the challenger gave, and the challenge record itself, with the
   * objections it raised, who raised them, and whether they did so from the
   * session that ran the work (null when either session is unknown).
   */
  function challengeVerification(current: Deliverable, verification: unknown, by: string): Record<string, unknown> {
    const given = verification !== null && typeof verification === 'object' && !Array.isArray(verification) ? (verification as Record<string, unknown>) : {};
    const read = readObjections((given.challenge as { objections?: unknown } | undefined)?.objections, 'verification.challenge.objections');
    if (!('objections' in read)) {
      throw new Error(`a challenge is recorded with the objections it raised: ${read.message} (each {objection, disposition: ${OBJECTION_DISPOSITIONS.join(' | ')}})`);
    }
    const held = current.verification !== null && typeof current.verification === 'object' && !Array.isArray(current.verification) ? (current.verification as Record<string, unknown>) : {};
    // What the checks recorded stays as they recorded it; the challenger adds beside it.
    const offered = Object.fromEntries(Object.entries(given).filter(([k]) => !CHECKS_RECORD.has(k)));
    const session = deps.host.sessionId;
    const runSession = getRun(store, current.runId)?.sessionId ?? null;
    return { ...held, ...offered, challenge: { objections: read.objections, by, session, sameSessionAsRun: session && runSession ? session === runSession : null } };
  }

  function applyPromotion(input: { readonly deliverableId: string; readonly to: TrustState; readonly by: string; readonly at: string; readonly verification?: unknown; readonly reason?: string | null }): Deliverable {
    const current = assertPromotable(input.deliverableId, input.to);
    // The verification column is replaced, not merged, so a challenge record is built over what it already holds.
    const verification = input.to === 'challenged' ? challengeVerification(current, input.verification, input.by) : input.verification;
    return setTrustState(store, { id: input.deliverableId, trustState: input.to, actor: input.by, at: input.at, verification, reason: input.reason ?? undefined });
  }

  return {
    remember({ kind, text, by, channel = 'relay', assumptions = [], replaces }) {
      const at = deps.now();
      const decision = evaluateAction(store, { tier: 'project_write', targetSystem: 'construct-state', targetResource: 'statements', operation: `remember: ${text}`, executorId: deps.host.executorId }, policyContext('remember', at));
      if (!decision.allowed) throw new Error(decision.denial.missing);
      return store.transaction(() => {
        const statement = addStatement(store, { id: deps.nextId('st'), kind, text, provenance: 'user', channel, at });
        const entity = isGoverningKind(kind) ? bindGoverningStatement(store, statement, at, deps.nextId) : null;
        if (replaces) {
          if (!getStatement(store, replaces)) throw new Error(`no statement ${replaces} to replace`);
          supersedeGoverning(store, { olderId: replaces, successor: statement, at, nextId: deps.nextId });
        }
        if (entity) {
          for (const assumption of assumptions) {
            if (!assumption.trim()) continue;
            addClaim(store, {
              id: deps.nextId('claim'),
              subjectId: entity.id,
              claimType: 'assumption',
              statement: assumption,
              provenance: 'user',
              authority: 'authoritative',
              sensitivity: 'internal',
              confidence: 1,
              observedAt: at,
              at,
            });
          }
        }
        appendActivity(store, { at, kind: 'remember', actor: by, payload: { statementId: statement.id, kind, entityId: entity?.id ?? null } });
        return statement;
      });
    },

    preflight(workflowId, input, opts = {}) {
      const m = deps.workflows.get(workflowId)?.manifest;
      const clock = { periodAt: opts.periodAt ?? deps.now(), timezone: opts.timezone };
      const normalized = m ? normalizeInput(m, input, { at: clock.periodAt, timezone: clock.timezone, sourceIds: deps.sources().map((s) => s.id) }) : null;
      const given = normalized?.input ?? input;
      const resolution = resolutionFor(workflowId, given, deps.host.executorId, clock);
      return { resolution, preflight: preflightOf(resolution, given, opts.declared, { period: normalized?.period, sourceIds: normalized?.sourceIds }) };
    },

    judge({ workflowId, input, declared }) {
      const workflow = workflowId ? deps.workflows.get(workflowId) : null;
      return judgmentFor(workflow, workflow?.manifest.steps ?? [], input, declared);
    },

    start(input) {
      const at = deps.now();
      const executorId = input.executorId ?? deps.host.executorId;
      const executorKind = input.executorKind ?? (deps.host.sessionId ? 'interactive' : 'headless');
      const workflow = deps.workflows.get(input.workflowId);
      if (!workflow) {
        const resolution = resolutionFor(input.workflowId, input.input, executorId);
        throw new Error(resolution.reasons[0]?.message ?? `no workflow ${input.workflowId}`);
      }
      const m = workflow.manifest;
      if (m.interactionClass === 'remember' || m.interactionClass === 'answer') {
        throw new Error(`${m.id} is a ${m.interactionClass} workflow; it records or answers without a run`);
      }
      if (!m.triggers.includes(input.trigger)) throw new Error(`${m.id} does not accept ${input.trigger} triggers (it accepts ${m.triggers.join(', ')})`);
      // The period is worked out once, here, at the instant the start names; the run keeps it in dates from then on.
      const clock: PeriodClock = { periodAt: input.periodAt ?? at, timezone: input.timezone };
      const normalized = normalizeInput(m, input.input, { at: clock.periodAt!, timezone: clock.timezone, sourceIds: deps.sources().map((s) => s.id) });
      const given = normalized.input;
      const asked = frozenReading(input.asked, normalized, input.firing ?? null, { at: clock.periodAt!, timezone: clock.timezone, sourceIds: deps.sources().map((s) => s.id) });
      const declared = asked?.declared ?? null;
      const keyExplicit = input.idempotencyKey;
      const workIdentity = idempotencyKeyFor(workflow, given, input.trigger === 'manual' ? 'manual' : `${input.trigger}:${at.slice(0, 16)}`, normalized.identities);
      const activeSingle = (): WorkflowRun | null => (m.concurrency === 'single' ? listActiveRuns(store).find((r) => r.workflowId === m.id && r.state !== 'blocked') ?? null : null);
      const singleFlag = (active: WorkflowRun) => `an active ${m.id} run (${active.id}) already exists; concurrency is single`;
      /** Whether a run gave this declared input the same value this start gives it; a period compares by its dates. */
      const sameValue = (run: WorkflowRun, key: string): boolean => {
        const was = (run.input ?? {}) as Record<string, unknown>;
        return identityOf(m, key, was[key], askedOf(run).period ?? null) === identityOf(m, key, given[key], normalized.period);
      };
      /** The work is already under way: hand back that run with its own preflight, and say which declared inputs this start gave differently. */
      const reuse = (existing: WorkflowRun, flags: readonly string[] = []): StartResult => {
        const existingInput = (existing.input ?? {}) as Record<string, unknown>;
        // The stale-data rule decides whether a run may start, so it applies only to a run still waiting to.
        const resolution = existing.state === 'blocked'
          ? startResolution(existing.workflowId, existingInput, existing.executorId, clockOf(existing))
          : resolutionFor(existing.workflowId, existingInput, existing.executorId, clockOf(existing));
        const pf = runPreflight(existing, resolution);
        const differs = Object.keys(m.inputSchema).filter((k) => !sameValue(existing, k));
        const readingOther = readingDiffers(askedOf(existing).intake, asked?.intake);
        return {
          run: existing,
          created: false,
          resolution,
          preflight: { ...pf, flags: [...pf.flags, ...flags, ...(differs.length ? [differsFlag(existing.id, differs)] : []), ...(readingOther.length ? [readingDiffersFlag(existing.id, readingOther)] : [])] },
          differs,
          superseded: null,
        };
      };
      if (keyExplicit) {
        const existingByKey = getRunByKey(store, keyExplicit);
        if (existingByKey) return reuse(existingByKey);
      } else {
        const inFlight = findActiveByWorkIdentity(store, workIdentity, { includeBlocked: false });
        if (inFlight) return reuse(inFlight);
      }
      const key = keyExplicit ?? `${workIdentity}:${deps.nextId('inv')}`;
      const active = activeSingle();
      if (active) return reuse(active, [singleFlag(active)]);
      const resolution = startResolution(m.id, given, executorId, clock);
      const preflight = preflightOf(resolution, given, declared, { period: normalized.period, sourceIds: normalized.sourceIds });
      const resolves = resolution.status === 'runnable' || resolution.status === 'outdated';
      return store.transaction(() => {
        // Another session may have started the same work between the checks
        // above and this write lock; under the lock the answer is final.
        const raced = keyExplicit ? getRunByKey(store, keyExplicit) : findActiveByWorkIdentity(store, workIdentity, { includeBlocked: false });
        if (raced) return reuse(raced);
        const racedSingle = activeSingle();
        if (racedSingle) return reuse(racedSingle, [singleFlag(racedSingle)]);
        // A blocked run of the same work is never handed back as if it were under way. Started again with
        // the same input, it is resolved again where it stands; started with other input, it is replaced.
        // A manual start that fills in what a blocked run left out of the work's identity, or gave a value
        // its check refused, and agrees on the rest, is the same work corrected; a blocked run that names
        // other work is left alone.
        const identifying = identifyingKeys(m);
        const sourceIds = deps.sources().map((x) => x.id);
        const leftOut = (r: WorkflowRun, k: string): boolean => {
          const was = ((r.input ?? {}) as Record<string, unknown>)[k];
          if (was === undefined || was === null) return true;
          const type = m.inputSchema[k];
          return (type === 'period' || type === 'source_ids') && checkSlot(type, k, was, { at: clockOf(r).periodAt ?? at, timezone: clockOf(r).timezone, sourceIds }).length > 0;
        };
        const sameWork = (r: WorkflowRun): boolean => {
          if (r.workIdentity === workIdentity) return true;
          if (r.workflowId !== m.id || r.triggerKind !== 'manual' || input.trigger !== 'manual') return false;
          return identifying.every((k) => leftOut(r, k) || sameValue(r, k));
        };
        const blocked = listActiveRuns(store).filter((r) => r.state === 'blocked' && sameWork(r));
        if (!keyExplicit) {
          const same = blocked.find((r) => r.workIdentity === workIdentity && canonicalJson(r.input) === canonicalJson(given));
          if (same) return { ...resumeBlocked(same, at, 'resolved again when the same work was started'), created: false, differs: [], superseded: null };
        }
        const { run } = createRun(store, {
          id: deps.nextId('run'),
          workflowId: m.id,
          workflowVersion: m.version,
          interactionClass: m.interactionClass as 'manage' | 'maintain',
          triggerKind: input.trigger,
          idempotencyKey: key,
          executorKind,
          executorId,
          hostId: deps.host.hostId,
          sessionId: deps.host.sessionId ?? undefined,
          input: given,
          invocationId: key,
          workIdentity,
          workflowDigest: workflow.digest,
          bindings: { steps: m.steps, digest: workflow.digest, version: m.version, asked },
          at,
        });
        const superseding = `superseded by run ${run.id}`;
        for (const b of blocked) transitionRun(store, { id: b.id, to: 'cancelled', at, reason: superseding });
        // Under single concurrency a run that resolves also retires the workflow's other blocked runs.
        if (resolves && m.concurrency === 'single') {
          for (const other of listActiveRuns(store).filter((r) => r.workflowId === m.id && r.state === 'blocked')) {
            transitionRun(store, { id: other.id, to: 'cancelled', at, reason: superseding });
          }
        }
        const superseded = blocked[blocked.length - 1]?.id ?? null;
        store.db.prepare(
          `INSERT INTO run_bindings (run_id, workflow_id, workflow_version, workflow_digest, skill_bindings_json, frozen_at)
           VALUES (?, ?, ?, ?, ?, ?)`,
        ).run(run.id, m.id, m.version, workflow.digest, JSON.stringify(resolution.plan.map((p) => p.skill)), at);
        if (!resolves) {
          const stopped = transitionRun(store, { id: run.id, to: 'blocked', at, reason: resolution.summary, preflight });
          return { run: stopped, created: true, resolution, preflight, differs: [], superseded };
        }
        const done = new Set<string>();
        const roots = new Set(readySteps(m.steps, done).map((s) => s.id));
        resolution.plan.forEach((bound, i) => {
          addStep(store, {
            id: deps.nextId('step'),
            runId: run.id,
            stepId: bound.step.id,
            ordinal: i,
            permissionTier: bound.step.tier,
            maxAttempts: bound.step.retry.maxAttempts,
            input: { skill: bound.skill, needsApproval: bound.needsApproval },
            ready: roots.has(bound.step.id),
            at,
          });
        });
        const ready = transitionRun(store, { id: run.id, to: 'ready', at, preflight });
        return { run: ready, created: true, resolution, preflight, differs: [], superseded };
      });
    },

    claimNext({ runId, owner, leaseMs: requested }) {
      const at = deps.now();
      const who = owner ?? deps.host.executorId;
      const leaseUntil = new Date(Date.parse(at) + (requested ?? leaseMs)).toISOString();
      expireDeadLeases(store, at, runId);
      const named = runId ? getRun(store, runId) : null;
      // A blocked run hands nothing out; say why it is stuck and what would clear it.
      if (named?.state === 'blocked') {
        const shown = named.preflight as { summary?: unknown; reasons?: unknown } | null;
        const reasons = Array.isArray(shown?.reasons) ? (shown.reasons as Preflight['reasons']) : [];
        const summary = named.stateReason ?? (typeof shown?.summary === 'string' ? shown.summary : `run ${named.id} is blocked`);
        return { packet: null, waitingOn: { kind: 'blocked', runId: named.id, summary, reasons } };
      }
      const candidates = runId ? [named].filter((r): r is WorkflowRun => r !== null) : listActiveRuns(store);
      let held: RunClaim['held'] = null;
      let refused: RunClaim['refused'] = null;
      for (const candidate of candidates) {
        // Gate and lease under one write lock, per run.
        const claim = store.transaction(() => claimInRun(candidate.id, who, at, leaseUntil));
        if (claim.outcome) return claim.outcome;
        held ??= claim.held;
        refused ??= claim.refused;
      }
      const finished = runId ? getRun(store, runId) : null;
      if (finished && ['succeeded', 'failed', 'cancelled'].includes(finished.state)) return { packet: null, waitingOn: { kind: 'finished', state: finished.state } };
      if (held) return { packet: null, waitingOn: held };
      if (refused) return { packet: null, waitingOn: refused };
      return { packet: null, waitingOn: { kind: 'nothing_ready' } };
    },

    submit({ leased, output, evidence = [], noData = false, resolvableRefs = new Set(), resolve }) {
      const at = deps.now();
      const run = getRun(store, leased.runId);
      if (!run) throw new Error(`no run ${leased.runId}`);
      const step = stepsOf(run).find((s) => s.id === leased.stepId);
      if (!step) throw new Error(`run ${run.id} has no frozen step ${leased.stepId}`);
      const currentWorkflow = deps.workflows.get(run.workflowId);
      if (noData) {
        const policy = currentWorkflow?.manifest.onNoData ?? 'fail';
        return store.transaction(() => {
          if (policy === 'fail') {
            const failed = failStep(store, { id: leased.id, owner: leased.leaseOwner, token: leased.token, at, error: { noData: true }, reason: 'no data' });
            return { step: failed, validation: [], run: advance(run.id, at), deliverable: null, ignored: [] };
          }
          if (policy === 'block') {
            const decision = raiseDecision(store, { id: deps.nextId('decision'), kind: 'blocked', question: `Step ${step.id} found no data. Continue without it, or stop?`, runId: run.id, stepRunId: leased.id, options: ['continue', 'stop'], subject: { noData: true }, at });
            transitionStep(store, { id: leased.id, to: 'waiting_for_decision', at, reason: 'no data' });
            transitionRun(store, { id: run.id, to: 'waiting_for_decision', at, reason: `step ${step.id} found no data` });
            void decision;
            return { step: getStep(store, leased.id)!, validation: [], run: getRun(store, run.id)!, deliverable: null, ignored: [] };
          }
          // Only an accepted waiver writes what was waived and by whom.
          const done = completeStep(store, { id: leased.id, owner: leased.leaseOwner, token: leased.token, at, output: { noData: true, ...output, waived: undefined, waivedBy: undefined } });
          return { step: done, validation: [], run: advance(run.id, at), deliverable: null, ignored: [] };
        });
      }
      const sensitivity = sensitivityFor(run, evidence, resolve);
      const asked = askedOf(run);
      const validation = runValidators(step.validators, { output, expectedKeys: step.outputs, evidence, resolvableRefs, resolve, input: run.input, settled: settled(), sensitivity, period: asked.period ?? null, sources: asked.sources?.registered ?? null });
      const failures = validation.filter((v) => !v.ok);
      return store.transaction(() => {
        // An accepted waiver covers the checks its question named; a check that fails anew was never put to anyone.
        const waiver = failures.length > 0 ? waiverOf(leased.id) : null;
        const covered = new Set(waiver ? waivedChecks(waiver) : []);
        const waived = waiver !== null && failures.every((f) => covered.has(f.validator));
        if (failures.length > 0 && !waived) {
          const current = getStep(store, leased.id)!;
          if (current.attempts >= current.maxAttempts && step.loadBearing) {
            // Retries are spent. Failing the run would throw away the work; the person decides instead.
            const problems = failures.flatMap((f) => f.problems.map((p) => `${f.validator}: ${p}`));
            raiseDecision(store, {
              id: deps.nextId('decision'),
              kind: 'decision',
              question: `Step ${step.id} still fails ${String(failures.length)} check(s) after ${String(current.attempts)} attempt(s): ${problems.slice(0, 5).join('; ')}${problems.length > 5 ? ` (+${String(problems.length - 5)} more)` : ''}. Accept it with these problems, give it another attempt, or stop?`,
              runId: run.id,
              stepRunId: leased.id,
              options: [...WAIVER_OPTIONS],
              subject: { waiverFor: leased.id, problems, validators: failures.map((f) => f.validator) },
              at,
            });
            transitionStep(store, { id: leased.id, to: 'waiting_for_decision', at, reason: 'checks still failing; waiting on the person' });
            transitionRun(store, { id: run.id, to: 'waiting_for_decision', at, reason: `step ${step.id} needs the person's call on failing checks` });
            appendActivity(store, { at, kind: 'step.validation_failed', runId: run.id, stepRunId: leased.id, actor: leased.leaseOwner, payload: { stepId: step.id, failures: failures.map((f) => f.validator), escalated: true } });
            return { step: getStep(store, leased.id)!, validation, run: getRun(store, run.id)!, deliverable: null, ignored: [] };
          }
          const reason = failures.map((f) => `${f.validator}: ${f.problems.join('; ')}`).join(' | ');
          const failed = failStep(store, { id: leased.id, owner: leased.leaseOwner, token: leased.token, at, error: { validation }, reason });
          appendActivity(store, { at, kind: 'step.validation_failed', runId: run.id, stepRunId: leased.id, actor: leased.leaseOwner, payload: { stepId: step.id, failures: failures.map((f) => f.validator) } });
          return { step: failed, validation, run: advance(run.id, at), deliverable: null, ignored: [] };
        }
        // What was waived, and by whom on which channel, is the kernel's to record: the step's own keys of those names are not kept.
        const done = completeStep(store, {
          id: leased.id,
          owner: leased.leaseOwner,
          token: leased.token,
          at,
          output: {
            ...output,
            evidence,
            waived: waived ? failures.map((f) => ({ validator: f.validator, problems: f.problems })) : undefined,
            waivedBy: waived ? { by: waiver.resolvedBy, channel: waiver.channel } : undefined,
          },
        });
        if (waived) appendActivity(store, { at, kind: 'step.checks_waived', runId: run.id, stepRunId: leased.id, actor: leased.leaseOwner, payload: { stepId: step.id, failures: failures.map((f) => f.validator), decisionId: waiver.id, acceptedBy: waiver.resolvedBy, channel: waiver.channel } });
        let deliverable: Deliverable | null = null;
        const isLast = isLastStep(run, step);
        // The last step hands the deliverable what earlier steps produced; a restatement that differs stays in the
        // step's own record and is named, never carried.
        const handed = handedTo(run, step);
        const ignored = Object.keys(handed).filter((k) => k in output && canonicalJson(output[k]) !== canonicalJson(handed[k]));
        const judgment = judgmentOf(run);
        const needsChallenge = judgmentRequired(currentWorkflow?.manifest.deliverable.challenge ?? false, judgment);
        if (isLast || step.challenge) {
          deliverable = upsertDraft(store, { id: deps.nextId('deliverable'), runId: run.id, stepRunId: leased.id, kind: currentWorkflow?.manifest.deliverable.kind ?? 'artifact', body: deliverableBody(run, output, handed, evidence, sensitivity, resolve), at });
          if (isLast && validation.every((v) => v.ok) && step.validators.length > 0 && !runHasWaiver(run.id)) {
            deliverable = setTrustState(store, { id: deliverable.id, trustState: 'validated', actor: `validators:${step.validators.join(',')}`, at, verification: { validators: validation, challengeRequired: needsChallenge, ...(resolve ? { evidence: provenanceOf(runEvidence(run.id, evidence), resolve) } : {}) } });
          }
        }
        return { step: done, validation, run: advance(run.id, at), deliverable, ignored };
      });
    },

    fail({ leased, error, reason }) {
      const at = deps.now();
      const failed = failStep(store, { id: leased.id, owner: leased.leaseOwner, token: leased.token, at, error, reason });
      advance(leased.runId, at);
      return failed;
    },

    decide({ decisionId, resolution, by, channel = 'relay' }) {
      const at = deps.now();
      try {
        return store.transaction(() => {
          const decision = getDecision(store, decisionId);
          if (!decision) throw new Error(`no decision ${decisionId}`);
          const subject = (decision.subject ?? {}) as { request?: ActionRequest; noData?: boolean; promote?: PromotionSubject; driftFindingId?: string; driftFindingIds?: string[] };
          if (decision.kind === 'approval' && resolution === 'approve' && decision.state === 'open' && !isPersonChannel(channel)) {
            if (subject.request && PERSON_ONLY_TIERS.has(subject.request.tier)) {
              throw new PersonChannelRequiredError(`Approving ${subject.request.tier} (${subject.request.operation})`, decisionId);
            }
            if (subject.promote) throw new PersonChannelRequiredError(`Moving deliverable ${subject.promote.deliverableId} to ${subject.promote.to}`, decisionId);
          }
          // The person's approval moves the deliverable only when the question they answered describes it as it stands.
          if (decision.kind === 'approval' && resolution === 'approve' && decision.state === 'open' && subject.promote) {
            const current = getDeliverable(store, subject.promote.deliverableId);
            if (current && decision.question !== acceptanceBrief(current, subject.promote.to, decision.id)) throw new StaleAcceptance(decisionId, subject.promote);
          }
          const resolved = resolveDecision(store, { id: decisionId, resolution, by, at, channel });
          let run: WorkflowRun | null = decision.runId ? getRun(store, decision.runId) : null;
          for (const fid of [...(subject.driftFindingIds ?? []), ...(subject.driftFindingId ? [subject.driftFindingId] : [])]) {
            const finding = getDriftFinding(store, fid);
            if (finding && (finding.status === 'open' || finding.status === 'acknowledged')) {
              const to = resolution === 'dismiss' ? 'dismissed' : 'acknowledged';
              if (to !== finding.status) setDriftStatus(store, { id: finding.id, status: to, by, at });
            }
          }
          if (decision.kind === 'approval' && subject.promote) {
            if (resolution === 'approve') applyPromotion({ ...subject.promote, by, at });
          } else if (decision.kind === 'approval' && subject.request) {
            if (resolution === 'approve') {
              approveAction(store, { id: deps.nextId('grant'), request: subject.request, by, at, stepRunId: decision.stepRunId ?? undefined, channel });
              if (decision.stepRunId) transitionStep(store, { id: decision.stepRunId, to: 'ready', at });
            } else if (decision.stepRunId) {
              transitionStep(store, { id: decision.stepRunId, to: 'cancelled', at, reason: `declined by ${by}` });
            }
          } else if (decision.kind === 'blocked' && subject.noData && decision.stepRunId) {
            if (resolution === 'continue') {
              transitionStep(store, { id: decision.stepRunId, to: 'skipped', at, reason: 'continued without data' });
            } else {
              transitionStep(store, { id: decision.stepRunId, to: 'cancelled', at, reason: `stopped by ${by}` });
            }
          } else if (decision.kind === 'decision' && (subject as { waiverFor?: string }).waiverFor && decision.stepRunId) {
            // The checks kept failing. The person either takes the output with its named problems,
            // gives the host another attempt, or stops; any of them is recorded against the step.
            const said = String(resolution).toLowerCase();
            const choice = said.startsWith('accept') ? WAIVER_OPTIONS[0] : said.startsWith('stop') ? WAIVER_OPTIONS[2] : WAIVER_OPTIONS[1];
            if (choice === WAIVER_OPTIONS[2]) transitionStep(store, { id: decision.stepRunId, to: 'cancelled', at, reason: `stopped by ${by} after checks kept failing` });
            else {
              grantExtraAttempt(store, { id: decision.stepRunId, at, by });
              transitionStep(store, { id: decision.stepRunId, to: 'ready', at, reason: choice === WAIVER_OPTIONS[0] ? `${by} accepted the output with its check failures` : `${by} asked for another attempt` });
            }
          } else if (decision.kind === 'clarification' && run) {
            const input = { ...((run.input ?? {}) as Record<string, unknown>) };
            const answers = { ...((input.answers as Record<string, unknown> | undefined) ?? {}), [decisionId]: resolution };
            store.db.prepare('UPDATE workflow_runs SET input_json = ?, updated_at = ? WHERE id = ?').run(JSON.stringify({ ...input, answers }), at, run.id);
            if (decision.stepRunId) {
              const sr = getStep(store, decision.stepRunId);
              if (sr?.state === 'waiting_for_decision') transitionStep(store, { id: sr.id, to: 'ready', at });
            }
          }
          if (run) {
            const fresh = getRun(store, run.id)!;
            if (fresh.state === 'waiting_for_decision' && listOpenDecisions(store, run.id).length === 0) {
              transitionRun(store, { id: run.id, to: 'running', at, reason: `decision ${decisionId} resolved by ${by}` });
            }
            run = advance(run.id, at);
          }
          return { decision: resolved, run };
        });
      } catch (error) {
        if (!(error instanceof StaleAcceptance)) throw error;
        // Asked again outside the refused transaction, so the new question stays asked.
        const asked = askForPromotion({ deliverableId: error.promote.deliverableId, to: error.promote.to, by: error.promote.requestedBy, reason: error.promote.reason }, at);
        throw new Error(
          `${error.decisionId} asked about deliverable ${error.promote.deliverableId} as it stood when the question was put, not as it stands now, so this approval moved nothing. ` +
            `It is asked again as ${asked.id}; read it with \`construct inbox show ${asked.id}\` and answer that one.`,
        );
      }
    },

    cancel({ runId, by, reason }) {
      const at = deps.now();
      return store.transaction(() => {
        const run = getRun(store, runId);
        if (!run) throw new Error(`no run ${runId}`);
        const workflow = deps.workflows.get(run.workflowId);
        const immediate = workflow?.manifest.cancellation !== 'after_step';
        setCancelRequested(store, runId, at);
        for (const s of listSteps(store, runId)) {
          if (s.state === 'pending' || s.state === 'ready' || s.state === 'waiting_for_decision') transitionStep(store, { id: s.id, to: 'cancelled', at, reason });
          else if (s.state === 'leased' && immediate) transitionStep(store, { id: s.id, to: 'cancelled', at, reason });
        }
        for (const d of listOpenDecisions(store, runId)) withdrawDecision(store, { id: d.id, reason: `run cancelled: ${reason}`, at });
        appendActivity(store, { at, kind: 'run.cancel_requested', runId, actor: by, payload: { reason, immediate } });
        const stillLeased = listSteps(store, runId).some((s) => s.state === 'leased');
        if (stillLeased) return getRun(store, runId)!; // finishes after the current step
        return transitionRun(store, { id: runId, to: 'cancelled', at, reason, actor: by });
      });
    },

    resume(runId) {
      const at = deps.now();
      return store.transaction(() => {
        const run = getRun(store, runId);
        if (!run) throw new Error(`no run ${runId}`);
        if (['succeeded', 'failed', 'cancelled'].includes(run.state)) return run;
        if (run.state === 'blocked') return resumeBlocked(run, at, 'resolved on resume').run;
        appendActivity(store, { at, kind: 'run.resumed', runId, payload: { from: run.state } });
        return advance(runId, at);
      });
    },

    status(runId) {
      const run = getRun(store, runId);
      if (!run) return null;
      return { run, steps: listSteps(store, runId), deliverables: listDeliverables(store, runId), openDecisions: listOpenDecisions(store, runId), activity: listActivity(store, { runId, limit: 1000 }).length };
    },

    promote({ deliverableId, to, by, channel = 'relay', verification, reason }) {
      if (to === 'validated') throw new Error(VALIDATED_BY_CHECKS);
      if (PERSON_ONLY_TRUST.has(to) && !isPersonChannel(channel)) {
        throw new PersonChannelRequiredError(`Moving deliverable ${deliverableId} to ${to}`, null);
      }
      return applyPromotion({ deliverableId, to, by, at: deps.now(), verification, reason });
    },

    requestPromotion({ deliverableId, to, by, reason }) {
      if (to === 'validated') throw new Error(VALIDATED_BY_CHECKS);
      if (to === 'challenged') throw new Error('a challenge is recorded with the objections it raised, through promote; it is not a question for the person');
      return askForPromotion({ deliverableId, to, by, reason }, deps.now());
    },
  };
}
