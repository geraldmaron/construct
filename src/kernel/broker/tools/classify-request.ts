import { requestedMethodBinding } from '../../workflow/methods.ts';
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
    const checked = found.map((m) => {
      const { input, missing } = mappedInput(intake, ctx.workflows.get(m.workflowId, m.domain)!, {}, false);
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
        inputCompatible: Object.keys(intake.inputs).every((key) =>
          Object.keys(ctx.workflows.get(m.workflowId, m.domain)!.manifest.inputSchema).includes(key),
        ),
        judgment: preflight.judgment,
      };
    });
    const explicit = intake.workflowId === null ? undefined : checked.find((c) => c.match.workflowId === intake.workflowId);
    const exact = checked.filter((c) => c.match.deliverableKind === intake.deliverable?.kind);
    const runnable = (c: (typeof checked)[number]) => c.match.status === 'runnable' && c.match.missing.length === 0 && c.inputCompatible;
    const chosen = explicit ?? exact.find(runnable) ?? exact[0] ?? checked.find(runnable) ?? checked[0];
    const selected = chosen ? found.find((m) => m.workflowId === chosen.match.workflowId && m.domain === chosen.match.domain)! : null;
    if (chosen) {
      // Only the selected workflow owns the whole explicit input. Alternatives get declared keys only.
      const mapped = mappedInput(intake, ctx.workflows.get(chosen.match.workflowId, chosen.match.domain)!, {}, true);
      Object.assign(chosen.match, mapped);
    }
    const { questions, hostQuestions } = fromIntake(() => questionsFor(validated, selected, catalog));
    const judgment = chosen?.judgment ?? ctx.workflow.judge({ workflowId: null, input: {}, declared });
    return {
      recorded: false,
      judgedBy: judgedByHost(ctx),
      kind: intake.kind,
      intake,
      resolved: validated.resolved,
      normalized: validated.normalized,
      matches: checked.map((c) => c.match),
      selectedWorkflow: chosen?.match ?? null,
      requestedMethod: requestedMethodBinding(
        intake.skill,
        ctx.skills,
        selected
          ? ctx.workflows.get(selected.workflowId, selected.domain)!.manifest.steps.flatMap((s) => (s.skill ? [s.skill.id] : []))
          : [],
      ),
      ...((intake.kind === 'manage' || intake.kind === 'maintain') &&
      (intake.deliverable?.kind === 'other' || selected?.workflowId === GENERAL_CARRIER)
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
      skills: skillCatalog(ctx, intake, selected ? [selected] : []),
      questions,
      hostQuestions,
      assumptions: validated.assumptions,
      flags: validated.flags,
      judgment,
      next: classifyNext(validated, selected?.workflowId ?? null, questions.length + hostQuestions.length, judgment.challenge),
    };
  },
});
