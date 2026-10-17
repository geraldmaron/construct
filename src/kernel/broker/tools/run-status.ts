import { closed, str } from '../definition.ts';
import { askedOf } from '../../workflow/asked.ts';
import { define } from './shared.ts';

export const runStatus = define<{ runId: string }, unknown>({
  name: 'run_status',
  title: 'Run status',
  description:
    'Where a run stands: its state, each step, the deliverables and how far they are trusted, any decision it waits on, and what it was asked to cover (the period in dates, the sources it names, who judged the reading).',
  surface: 'both',
  readOnly: true,
  inputSchema: {
    type: 'object',
    properties: { runId: { type: 'string', description: 'The run id.' } },
    required: ['runId'],
    additionalProperties: false,
  },
  validate(raw) {
    closed(raw, this.inputSchema);
    return { runId: str(raw, 'runId')! };
  },
  run(ctx, { runId }) {
    const v = ctx.workflow.status(runId);
    if (!v) throw new Error(`no run ${runId}`);
    const asked = askedOf(v.run);
    const checkpoints = ctx.store.db
      .prepare(
        "SELECT id, step_run_id, at, payload_json FROM activity_events WHERE kind='step.checkpoint' AND run_id=? ORDER BY id DESC LIMIT 20",
      )
      .all(runId);
    return {
      checkpoints,
      delivery: {
        state: v.deliverables.length ? 'available' : checkpoints.length ? 'partial' : 'not_produced',
        deterministic: v.deliverables.some((d) => d.verification !== null) ? 'recorded' : 'not_recorded',
        semantic: v.semanticReview.state,
        acceptance: v.deliverables.some((d) => ['accepted', 'final'].includes(d.trustState)) ? 'accepted' : 'not_accepted',
      },
      semanticReview: v.semanticReview,
      run: {
        id: v.run.id,
        workflow: v.run.workflowId,
        state: v.run.state,
        reason: v.run.stateReason,
        preflight: v.run.preflight,
        asked: { period: asked.period ?? null, sources: asked.sources ?? null, judgedBy: asked.judgedBy ?? null },
      },
      steps: v.steps.map((s) => ({ id: s.id, step: s.stepId, state: s.state, attempts: s.attempts, reason: s.stateReason })),
      deliverables: v.deliverables.map((d) => ({
        id: d.id,
        kind: d.kind,
        trust: d.trustState,
        verification: d.verification,
        body: d.body,
      })),
      openDecisions: v.openDecisions.map((d) => ({ id: d.id, kind: d.kind, question: d.question, options: d.options })),
    };
  },
});
