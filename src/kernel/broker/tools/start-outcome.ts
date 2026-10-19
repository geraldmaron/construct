import { type BrokerContext } from '../context.ts';
import { type RegisteredWorkflow } from '../../registry/models.ts';
import { inputProblems } from '../../registry/resolver.ts';
import { ToolInputError, closed, str, obj } from '../definition.ts';
import { type StartResult, differsNext } from '../../workflow/service.ts';
import { type Assumption } from '../../workflow/asked.ts';
import { semanticReviewStatus } from '../../workflow/semantic-review.ts';
import { checkoutResolver } from '../../source/resolver.ts';
import { CORE_EXAMPLE, validateIntake, matchWorkflows, questionsFor, slotQuestion } from '../../workflow/intake.ts';
import { scheduleIntake } from '../../workflow/scheduling.ts';
import { define, PERSON_ASKED_ONLY } from './shared.ts';
import { intakeCatalog, fromIntake, mappedInput, declaredOf, judgedByHost } from './intake-helpers.ts';

const NOTHING_STARTED =
  'Nothing started. Recheck host-marked blockers: evidence gaps in an investigation can use blocking=false and handling=investigate or carry_unknown, without an assumed answer. Do not downgrade required permission, essential scope or destination decisions. Resolve real blockers with the person, then retry start_outcome; do not silently bypass this result.';

/** Input a workflow refuses: an undeclared key, or a value its type does not take. Each comes back naming input.<key>. */
function refuseWrongInput(ctx: BrokerContext, workflow: RegisteredWorkflow, input: Readonly<Record<string, unknown>>): void {
  const m = workflow.manifest;
  const declared = Object.keys(m.inputSchema);
  const slotContext = { at: ctx.now(), sourceIds: ctx.sources.list().map((s) => s.id) };
  for (const [key, value] of Object.entries(input)) {
    const problems = inputProblems({ ...m, requiredInputs: [] }, { [key]: value }, slotContext);
    if (problems.length === 0) continue;
    throw new ToolInputError(`${problems.map((p) => p.message).join('; ')}. ${problems[0]!.remedy}`, {
      field: `input.${key}`,
      ...(declared.includes(key) ? {} : { allowed: declared }),
    });
  }
}

/** Workflows a session can start: manage or maintain, started by hand. */
function startable(w: RegisteredWorkflow): boolean {
  return (w.manifest.interactionClass === 'manage' || w.manifest.interactionClass === 'maintain') && w.manifest.triggers.includes('manual');
}

function startedResult(
  ctx: BrokerContext,
  r: StartResult,
  normalized: readonly unknown[],
  assumptions: readonly Assumption[],
): Record<string, unknown> {
  return {
    started: true,
    semanticReview: semanticReviewStatus(ctx.store, r.run, checkoutResolver(ctx.store, ctx), ctx.now()),
    run: {
      id: r.run.id,
      state: r.run.state,
      workflow: r.run.workflowId,
      ...(typeof (r.run.input as Record<string, unknown> | null)?.domain === 'string'
        ? { domain: (r.run.input as Record<string, unknown>).domain }
        : {}),
    },
    created: r.created,
    preflight: r.preflight,
    differs: r.differs,
    superseded: r.superseded,
    normalized,
    assumptions,
    ...(r.differs.length > 0 ? { next: differsNext(r.differs) } : {}),
  };
}

export const startOutcome = define<{ workflowId: string; input?: Record<string, unknown>; intake?: Record<string, unknown> }, unknown>({
  name: 'start_outcome',
  title: 'Start an outcome',
  description: [
    "Start a one-time workflow run from the intake classify_request returned, with the person's answers applied, or save a standing trigger for kind maintain, which stays unprovisioned until a host installs a clock and an executor, so never promise it will run. Construct checks the intake again: if a required detail or a blocking question is still open, nothing starts and you get the questions back, and if this work is already running you get that run back; otherwise call claim_work to do the next step here.",
    PERSON_ASKED_ONLY,
  ].join(' '),
  surface: 'interactive',
  readOnly: false,
  inputSchema: {
    type: 'object',
    properties: {
      workflowId: { type: 'string', description: 'Which workflow: one classify_request matched.' },
      input: { type: 'object', description: 'Workflow inputs by their keys; with an intake, only what the reading does not carry.' },
      intake: {
        type: 'object',
        description: 'The intake classify_request returned, with the person’s answers applied; Construct checks it again.',
      },
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
      throw new ToolInputError(
        'give "intake", the reading classify_request returned with the person’s answers applied, or "input", the workflow input',
        { field: 'intake', example: { intake: CORE_EXAMPLE } },
      );
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
      const requestedDomain = explicit.domain ?? validated.intake.inputs.domain ?? validated.intake.skill ?? undefined;
      const requested = ctx.workflows.get(workflowId, requestedDomain);
      const declared = ctx.workflows.get(workflowId)?.manifest.domains;
      if (declared && typeof requestedDomain === 'string' && !Object.hasOwn(declared, requestedDomain))
        throw new ToolInputError(`${workflowId} declares no domain "${requestedDomain}"`, {
          field: 'domain',
          allowed: Object.keys(declared),
        });
      const match = matches.find(
        (m) => m.workflowId === (requested?.canonicalId ?? workflowId) && (!requested?.domain || m.domain === requested.domain),
      );
      if (!match)
        throw new ToolInputError(`${workflowId} does not carry this reading; start one of the workflows it matched`, {
          field: 'workflowId',
          allowed: [...new Set(matches.map((m) => m.workflowId))],
        });
      const workflow = ctx.workflows.get(workflowId, explicit.domain ?? match.domain);
      if (!workflow) throw new ToolInputError(`${workflowId} has no binding for this reading`, { field: 'workflowId' });
      const { input: mapped } = mappedInput(validated.intake, workflow, explicit, true);
      refuseWrongInput(ctx, workflow, mapped);
      const { questions, hostQuestions } = fromIntake(() => questionsFor(validated, match, catalog, explicit));
      if (questions.length > 0 || hostQuestions.length > 0) {
        return { started: false, recorded: false, questions, hostQuestions, normalized: validated.normalized, next: NOTHING_STARTED };
      }
      const { intake: reading, resolved } = validated;
      if (reading.kind === 'maintain') return scheduleIntake(ctx.store, ctx.triggers, workflow, reading, mapped);
      const r = ctx.workflow.start({
        workflowId,
        input: mapped,
        trigger: 'manual',
        asked: {
          intake: reading,
          periodSpec: reading.period,
          sources: {
            registered: [...new Set(reading.sources.filter((s) => s.role === 'read' && s.id !== null).map((s) => s.id!))],
            named: resolved.sources.map((s) => ({ name: s.name, id: s.id, registered: s.registered })),
          },
          declared: declaredOf(reading),
          judgedBy: judgedByHost(ctx),
          assumptions: validated.assumptions,
        },
      });
      return startedResult(ctx, r, validated.normalized, validated.assumptions);
    }
    const workflow = ctx.workflows.get(workflowId, explicit.domain);
    if (!workflow || !startable(workflow))
      throw new ToolInputError(`no workflow "${workflowId}" can be started here`, {
        field: 'workflowId',
        allowed: ctx.workflows
          .list()
          .filter(startable)
          .map((w) => w.manifest.id),
      });
    refuseWrongInput(ctx, workflow, explicit);
    const missing = workflow.manifest.requiredInputs.filter((k) => explicit[k] === undefined);
    if (missing.length > 0)
      return {
        started: false,
        recorded: false,
        questions: missing.map((slot) => slotQuestion(slot, workflow)),
        hostQuestions: [],
        normalized: [],
        next: NOTHING_STARTED,
      };
    const r = ctx.workflow.start({ workflowId, input: explicit, trigger: 'manual' });
    return startedResult(
      ctx,
      r,
      [],
      r.preflight.assumptions.map((text) => ({ about: 'period', text, by: 'kernel' as const })),
    );
  },
});
