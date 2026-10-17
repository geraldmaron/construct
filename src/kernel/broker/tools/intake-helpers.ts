import { type JsonSchema, ToolInputError } from '../definition.ts';
import {
  INTAKE_KINDS,
  EXECUTION_PATHS,
  SOURCE_ROLES,
  DESTINATION_KINDS,
  COORDINATION_ACTIONS,
  OPEN_ABOUT,
  type IntakeCatalog,
  IntakeError,
  type Intake,
  workflowInputFor,
  destinationConflict,
  type WorkflowMatch,
  GENERAL_CARRIER,
  type ValidatedIntake,
  COORDINATION_NEXT,
} from '../../workflow/intake.ts';
import { PERIOD_SEMANTICS, PERIOD_RELATIVES } from '../../registry/slots.ts';
import { STAKE_AREAS } from '../../workflow/consequence.ts';
import { type BrokerContext } from '../context.ts';
import { type Declared, type JudgedBy } from '../../workflow/asked.ts';
import { getSession } from '../../state/sessions.ts';
import { type RegisteredWorkflow } from '../../registry/models.ts';
import { PERSON_ASKED_ONLY } from './shared.ts';

/** When to call classify_request and what to send, with the built-in deliverable kinds by family. */
export const CLASSIFY_DESCRIPTION = [
  'Report your reading of a request the person wants produced, reviewed, kept up on a schedule, or handed to another agent, however they phrase it, questions included ("can you put together…"); Construct checks it, works out periods and source ids, matches workflows and returns only the questions that block, recording nothing.',
  'A plain question needs no call, and remember and work are called directly; Construct does not read intent from the words, so report your own reading.',
  'kind: answer, remember, manage (produce or review something), maintain (keep it up on a schedule or an event), or coordinate (work alongside other agents).',
  'intent carries outcome, path and acceptance; use a declared deliverable kind, or other plus intent.path for a portable path; only implementation needs project test commands; prefer period.relative or quarter over computing dates.',
  'Listed kinds: review/ challenge, architecture, delivery-plan, design-conformance, experience, implementation, operational-readiness, product, security-privacy, strategy-execution, drift, standing; document/ prd, rfc, proposal, revision; research/brief; decision/brief; outcome/ portable, managed; memo/issue-spotting; constitution/review; publication; anything else: other with describe.',
  'Example: {"kind":"manage","words":"<their words>","deliverable":{"kind":"research/brief"},"sources":[{"name":"<their connected source>","role":"read"}]}.',
  'Evidence gaps do not block: open items use blocking=false with handling=investigate or carry_unknown, never an invented assumption; only required scope, permission or destination decisions block.',
  PERSON_ASKED_ONLY,
].join(' ');

/** The typed reading a host reports, closed at every level; its vocabularies are the ones that never change with the registry. */
export const INTAKE_SCHEMA: JsonSchema = {
  type: 'object',
  properties: {
    words: { type: 'string', description: 'Verbatim request.' },
    kind: { type: 'string', description: 'Interaction.', enum: INTAKE_KINDS },
    deliverable: {
      type: 'object',
      description: 'Requested result.',
      properties: {
        kind: { type: 'string', description: 'Result kind.' },
        describe: { type: 'string', description: 'Required for other.' },
      },
      required: ['kind'],
      additionalProperties: false,
    },
    intent: {
      type: 'object',
      description: 'Host interpretation.',
      properties: {
        outcome: { type: 'string', description: 'Desired result.' },
        audience: { type: 'string', description: 'Audience.' },
        path: { type: 'string', description: 'Work path.', enum: EXECUTION_PATHS },
        acceptance: { type: 'array', description: 'Success checks.', items: { type: 'string' } },
        constraints: { type: 'array', description: 'Labeled constraints.', items: { type: 'string' } },
        assumptions: { type: 'array', description: 'Assumptions.', items: { type: 'string' } },
        priorWork: { type: 'array', description: 'Prior records.', items: { type: 'string' } },
      },
      required: ['outcome', 'path'],
      additionalProperties: false,
    },
    skill: { type: 'string', description: 'Method id.' },
    workflowId: { type: 'string', description: 'Workflow id.' },
    target: { type: 'string', description: 'Target.' },
    scope: { type: 'string', description: 'Scope.' },
    period: {
      type: 'object',
      description: 'Requested period.',
      properties: {
        semantics: { type: 'string', description: 'Period semantics.', enum: PERIOD_SEMANTICS },
        relative: { type: 'string', description: 'Relative period.', enum: PERIOD_RELATIVES },
        n: { type: 'number', description: 'Day count.' },
        quarter: { type: 'number', description: '1 to 4.' },
        year: { type: 'number', description: 'Four digits.' },
        from: { type: 'string', description: 'YYYY-MM-DD.' },
        to: { type: 'string', description: 'YYYY-MM-DD.' },
        timezone: { type: 'string', description: 'IANA zone.' },
        phrase: { type: 'string', description: 'Their phrase.' },
      },
      required: ['semantics'],
      additionalProperties: false,
    },
    sources: {
      type: 'array',
      description: 'Named sources.',
      items: {
        type: 'object',
        properties: {
          name: { type: 'string', description: 'Source name.' },
          id: { type: 'string', description: 'Source id.' },
          role: { type: 'string', description: 'Source role.', enum: SOURCE_ROLES },
        },
        required: ['name'],
        additionalProperties: false,
      },
    },
    destination: {
      type: 'object',
      description: 'Destination.',
      properties: {
        kind: { type: 'string', description: 'Place kind.', enum: DESTINATION_KINDS },
        ref: { type: 'string', description: 'Destination reference.' },
        name: { type: 'string', description: 'Source id.' },
      },
      required: ['kind'],
      additionalProperties: false,
    },
    schedule: {
      type: 'object',
      description: 'Standing timing.',
      properties: {
        cron: { type: 'string', description: 'Five fields.' },
        timezone: { type: 'string', description: 'IANA; required with cron.' },
        event: { type: 'string', description: 'An event name.' },
        phrase: { type: 'string', description: 'Their phrase.' },
      },
      additionalProperties: false,
    },
    coordination: { type: 'string', description: 'Coordination.', enum: COORDINATION_ACTIONS },
    stakes: {
      type: 'object',
      description: 'Required for manage.',
      properties: {
        reversible: { type: 'boolean', description: 'Reversible.' },
        affects: { type: 'array', description: 'What it touches.', items: { type: 'string', enum: STAKE_AREAS } },
      },
      additionalProperties: false,
    },
    open: {
      type: 'array',
      description: 'Unresolved items.',
      items: {
        type: 'object',
        properties: {
          about: { type: 'string', description: 'What it is about.', enum: OPEN_ABOUT },
          question: { type: 'string', description: 'Question.' },
          blocking: { type: 'boolean', description: 'Required decision.' },
          handling: { type: 'string', enum: ['investigate', 'carry_unknown'], description: 'Evidence-gap handling.' },
          assumption: { type: 'string', description: 'Labeled assumption.' },
        },
        required: ['question', 'blocking'],
        additionalProperties: false,
      },
    },
    inputs: { type: 'object', description: 'Workflow inputs.' },
  },
  required: ['words', 'kind'],
  additionalProperties: false,
};

/** What a reading is checked against in this project, now. */
export function intakeCatalog(ctx: BrokerContext): IntakeCatalog {
  return {
    workflows: ctx.workflows.list(),
    skills: ctx.skills.list(),
    sources: ctx.sources.list().map((s) => ({ id: s.id, kind: s.kind, locator: s.locator })),
    at: ctx.now(),
    projectRoot: ctx.root,
  };
}

/** A reading the host model can fix comes back as wrong input naming the field. */
export function fromIntake<T>(fn: () => T): T {
  try {
    return fn();
  } catch (error) {
    if (error instanceof IntakeError)
      throw new ToolInputError(error.message, {
        field: error.field,
        ...(error.allowed ? { allowed: error.allowed } : {}),
        example: error.example,
      });
    throw error;
  }
}

/** What the host declared beside the workflow input: the inputs to every later judgment. */
export function declaredOf(intake: Intake): Declared {
  return { stakes: intake.stakes, chosenSkill: intake.skill, words: intake.words };
}

/** The host that reported the reading, and the client it named at the handshake. */
export function judgedByHost(ctx: BrokerContext): JudgedBy {
  return { by: 'host', host: ctx.host.hostId, client: ctx.sessionId ? (getSession(ctx.store, ctx.sessionId)?.clientName ?? null) : null };
}

/**
 * A workflow's input from the reading. Inputs given by a workflow's own keys
 * belong to the first match; another match takes only the ones it declares.
 * When the reading's destination and a given one disagree, the person's
 * question settles it and neither is mapped.
 */
export function mappedInput(
  intake: Intake,
  workflow: RegisteredWorkflow,
  explicit: Readonly<Record<string, unknown>>,
  own: boolean,
): { readonly input: Record<string, unknown>; readonly missing: readonly string[] } {
  const declared = Object.keys(workflow.manifest.inputSchema);
  const reading = own
    ? intake
    : { ...intake, inputs: Object.fromEntries(Object.entries(intake.inputs).filter(([k]) => declared.includes(k))) };
  return fromIntake(() =>
    workflowInputFor(destinationConflict(reading, explicit) ? { ...reading, destination: null } : reading, workflow, explicit),
  );
}

/** A skill's use-when text: its first sentence, at most 200 characters. */
function firstSentence(text: string, cap = 200): string {
  const flat = text.replace(/\s+/g, ' ').trim();
  const end = flat.search(/[.!?](?:\s|$)/);
  const sentence = end >= 0 ? flat.slice(0, end + 1) : flat;
  return sentence.length <= cap ? sentence : `${sentence.slice(0, cap - 1).trimEnd()}…`;
}

/** The skills the matches bind, and the chosen one; for the general carrier with no method chosen, every method and professional skill. */
export function skillCatalog(
  ctx: BrokerContext,
  intake: Intake,
  found: readonly WorkflowMatch[],
): Record<string, { title: string; category: string; useWhen: string }> {
  const ids = new Set<string>([...(intake.skill ? [intake.skill] : []), ...found.flatMap((m) => m.skills)]);
  if (found[0]?.workflowId === GENERAL_CARRIER && intake.skill === null) {
    for (const s of ctx.skills.list())
      if (s.manifest.category === 'method' || s.manifest.category === 'professional') ids.add(s.manifest.id);
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
export function classifyNext(validated: ValidatedIntake, first: string | null, open: number, challenge: boolean): string {
  const { intake } = validated;
  if (intake.kind === 'answer') return 'Answer in chat. Nothing was recorded.';
  if (intake.kind === 'remember')
    return 'Call remember with the person’s wording and the kind of statement it is. Nothing else is created.';
  if (intake.kind === 'coordinate') return COORDINATION_NEXT[intake.coordination!];
  const unregistered = validated.resolved.sources.filter((s) => !s.registered && !s.candidates?.length).length;
  const prefix =
    unregistered > 0
      ? `${String(unregistered)} of the systems in your reading ${unregistered === 1 ? 'is' : 'are'} not registered with Construct; declare each one the person named with sources action declare, then report what you read before citing it. `
      : '';
  if (first === null) {
    return `${prefix}No workflow here produces ${intake.deliverable?.kind ?? 'this'} ${intake.kind === 'maintain' ? 'on a schedule or an event; tell the person, and offer to run it once now instead (kind manage)' : 'for this reading; tell the person what the listed workflows can do instead'}.`;
  }
  if (first === GENERAL_CARRIER && open === 0)
    return `${prefix}First inspect carrierAlternatives and the reported execution path; the portable carrier needs no project command. never request broader shell permission to deliver research or advice. Call start_outcome with workflowId "${first}" and this intake when its obligations fit.${intake.kind === 'maintain' ? ' A standing intent still needs a separately provisioned clock and executor; recording it does not execute it.' : ''}${challenge ? ' This work must be challenged before it is accepted.' : ''}`;
  if (first === 'managed-outcome' && open === 0)
    return `${prefix}The implementation path requires an actual project verification command. First inspect carrierAlternatives and choose a declared deliverable kind whose method and verification fit this request; then reclassify with that kind. Research, advice and document review must not acquire command requirements merely because you chose other. Start this path only when its command-based verification is appropriate; never request broader shell permission or substitute an arbitrary command to make it pass.${intake.kind === 'maintain' ? ' A standing intent still needs a separately provisioned clock and executor; recording it does not execute it.' : ''}${challenge ? ' This work must be challenged before it is accepted.' : ''}`;
  if (open > 0)
    return `${prefix}Put these ${String(open)} question(s) to the person in one message, then call start_outcome with workflowId "${first}" and this intake with their answers applied.`;
  return `${prefix}Call start_outcome with workflowId "${first}" and this intake, or another match whose skills fit better.${challenge ? ' This work must be challenged before it is accepted.' : ''}${intake.kind === 'maintain' ? ` start_outcome saves the standing intent without starting work now. The clock and executor still require provisioning; ${scheduleCommand(first, intake.schedule)} is only an alternate definition command, not an executing schedule.` : ''}`;
}

export function workflowVerification(w: RegisteredWorkflow) {
  const execution = w.manifest.steps.some((step) => step.capabilities.includes('run_tests'));
  const challenge = w.manifest.steps.some((step) => step.challenge);
  return {
    kind: execution ? 'observed_project_command' : challenge ? 'evidence_and_model_challenge' : 'declared_structural_checks',
    executionRequired: execution,
    assurance: execution
      ? 'observed command; intended criteria need a frozen verifier contract'
      : 'deterministic checks and host-reported judgment; no independent semantic proof',
  };
}
