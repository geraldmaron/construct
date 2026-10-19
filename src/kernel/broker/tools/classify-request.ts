import { closed, ToolInputError } from '../definition.ts';
import { CORE_EXAMPLE, validateIntake, matchWorkflows, questionsFor, GENERAL_CARRIER, workflowCarries } from '../../workflow/intake.ts';
import { workflowCandidates } from '../../registry/workflow-domains.ts';
import { define } from './shared.ts';
import {
  CLASSIFY_DESCRIPTION,
  INTAKE_SCHEMA,
  intakeCatalog,
  fromIntake,
  declaredOf,
  mappedInput,
  workflowVerification,
  judgedByHost,
  skillCatalog,
  classifyNext,
} from './intake-helpers.ts';

export const classify = define<Record<string, unknown>, unknown>({
  name: 'classify_request',
  title: 'Report your reading of a request',
  description: CLASSIFY_DESCRIPTION,
  surface: 'interactive',
  readOnly: true,
  entry: true,
  inputSchema: INTAKE_SCHEMA,
  validate(raw) {
    try {
      closed(raw, this.inputSchema);
    } catch (error) {
      // The person's words go in words, with the reading beside them.
      if (error instanceof ToolInputError && error.field === 'text') {
        throw new ToolInputError(
          '"text" is not an input of this tool: put the person’s words, verbatim, in "words", with your reading of them beside it',
          { field: 'text', allowed: Object.keys(this.inputSchema.properties), example: CORE_EXAMPLE },
        );
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
      const { input, missing } = mappedInput(intake, ctx.workflows.get(m.workflowId, m.domain)!, {}, i === 0);
      const { preflight } = ctx.workflow.preflight(m.workflowId, input, { declared });
      return {
        match: {
          workflowId: m.workflowId,
          ...(m.domain ? { domain: m.domain } : {}),
          title: m.title,
          deliverableKind: m.deliverableKind,
          because: m.because,
          verification: workflowVerification(ctx.workflows.get(m.workflowId, m.domain)!),
          status: preflight.status,
          summary: preflight.summary,
          reasons: preflight.reasons,
          approvalsAhead: preflight.approvalsAhead,
          input,
          missing,
        },
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
      ...((intake.kind === 'manage' || intake.kind === 'maintain') &&
      (intake.deliverable?.kind === 'other' || found[0]?.workflowId === GENERAL_CARRIER)
        ? {
            carrierAlternatives: workflowCandidates(catalog.workflows)
              .filter((w) => w.manifest.id !== GENERAL_CARRIER && workflowCarries(w, intake.kind, intake.schedule))
              .map((w) => ({
                workflowId: w.canonicalId ?? w.manifest.id,
                ...(w.domain ? { domain: w.domain } : {}),
                deliverableKind: w.manifest.deliverable.kind,
                title: w.manifest.title,
                verification: workflowVerification(w),
              })),
          }
        : {}),
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
