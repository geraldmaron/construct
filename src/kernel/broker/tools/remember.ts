import { type Statement, type StatementKind, STATEMENT_KINDS } from '../../state/profile.ts';
import { closed, list, str, ToolInputError } from '../definition.ts';
import { inRuleForm, RULE_FORM_REFUSAL } from '../../project/governance.ts';
import { getStatement } from '../../state/profile.ts';
import { personStepFor } from '../../policy/channels.ts';
import { define, PERSON_ASKED_ONLY, askThePerson } from './shared.ts';

/** A statement as remember shows it: whose voice it is in included. */
function shownStatement(s: Statement): Record<string, unknown> {
  return { id: s.id, kind: s.kind, text: s.text, at: s.createdAt, channel: s.channel, voice: s.voice };
}

export const remember = define<
  { kind: StatementKind; text: string; assumptions: string[]; replaces?: string; contradicts: string[]; outdates: string[] },
  unknown
>({
  name: 'remember',
  title: 'Remember one thing',
  description: `Record one decision, constraint, principle, note, or outcome in the person’s own words, when they ask to remember or record it. Creates exactly one record and nothing else: no run, no tasks, no staff. Replacing an earlier record, ruling terms out, or marking a document outdated needs the person’s own confirmation; Construct asks them when the host can. ${PERSON_ASKED_ONLY}`,
  surface: 'interactive',
  readOnly: false,
  inputSchema: {
    type: 'object',
    properties: {
      kind: {
        type: 'string',
        description: 'What kind of thing this is.',
        enum: ['decision', 'constraint', 'principle', 'note', 'outcome', 'non_goal', 'success_measure', 'unknown'],
      },
      text: { type: 'string', description: 'The person’s wording, as they said it.' },
      assumptions: { type: 'array', description: 'Load-bearing assumptions this governing record rests on.', items: { type: 'string' } },
      replaces: { type: 'string', description: 'The id of a statement this one supersedes.' },
      contradicts: {
        type: 'array',
        items: { type: 'string' },
        description:
          'For a decision: short terms it rules out ("exactly-once"), so later work stating them as current is caught. Only terms the person named.',
      },
      outdates: {
        type: 'array',
        items: { type: 'string' },
        description: 'Documents or items the person said are no longer current; only names they said.',
      },
    },
    required: ['kind', 'text'],
    additionalProperties: false,
  },
  validate(raw) {
    closed(raw, this.inputSchema);
    const assumptions = list(raw, 'assumptions').filter((a): a is string => typeof a === 'string' && a.trim().length > 0);
    const terms = (field: string) =>
      list(raw, field)
        .filter((x): x is string => typeof x === 'string' && x.trim().length >= 3)
        .map((x) => x.trim());
    const text = str(raw, 'text')!;
    // The forms that restrict later work are written by Construct when the person confirms them, never relayed as text.
    if (inRuleForm(text)) throw new ToolInputError(RULE_FORM_REFUSAL, { field: 'text' });
    return {
      kind: str(raw, 'kind', { oneOf: STATEMENT_KINDS })! as StatementKind,
      text,
      assumptions,
      replaces: str(raw, 'replaces', { optional: true }),
      contradicts: terms('contradicts'),
      outdates: terms('outdates'),
    };
  },
  async run(ctx, input) {
    const rulesOut = input.kind === 'decision' ? input.contradicts : [];
    // The person asked the model to keep this; the record says the model relayed it.
    const relayed = () =>
      ctx.workflow.remember({ kind: input.kind, text: input.text, assumptions: input.assumptions, by: ctx.actor, channel: 'relay' });
    if (!input.replaces && rulesOut.length === 0 && input.outdates.length === 0)
      return { remembered: shownStatement(relayed()), nothingElseCreated: true };
    // What only adds is recorded now; replacing a record waits for the person, and the rules always do. Both land, or neither.
    const { s, pending } = ctx.store.transaction(() => {
      const kept = input.replaces ? null : relayed();
      const asking = ctx.workflow.proposeSettlement({
        ...(kept
          ? { forStatementId: kept.id }
          : { record: { kind: input.kind, text: input.text, assumptions: input.assumptions }, replaces: input.replaces }),
        rulesOut,
        outdates: input.outdates,
        by: ctx.actor,
      });
      return { s: kept, pending: asking };
    });
    const asked = await askThePerson(ctx, pending.id, null);
    const state = (asked?.decision as { state?: string } | undefined)?.state;
    if (asked && state !== 'open') {
      // The person answered the prompt: approved, it is all recorded in their voice; declined, only what was already kept stays.
      const made = s ?? (input.replaces ? getStatement(ctx.store, getStatement(ctx.store, input.replaces)?.supersededBy ?? '') : null);
      return {
        remembered: made ? shownStatement(made) : null,
        settlement: asked.decision,
        channel: asked.channel,
        nothingElseCreated: true,
      };
    }
    return {
      remembered: s ? shownStatement(s) : null,
      pending: { decisionId: pending.id, waitsFor: 'the person’s own confirmation' },
      personRequired: true,
      ...(asked ? { asked: asked.asked } : {}),
      next: personStepFor(pending.id),
      nothingElseCreated: true,
    };
  },
});
