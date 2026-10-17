import { closed, str } from '../definition.ts';
import { listInbox } from '../../project/onboarding.ts';
import { getDecision } from '../../state/decisions.ts';
import { define, ownerFor } from './shared.ts';

export const inbox = define<{ runId?: string; owner?: string }, unknown>({
  name: 'inbox',
  title: 'Decisions waiting on the person',
  description:
    "The approvals, questions and proposed statements that belong to the person, in plain words, with the options each accepts and who decides it; pass owner to see one person's. Surface them conversationally and never decide them yourself.",
  surface: 'interactive',
  readOnly: true,
  inputSchema: {
    type: 'object',
    properties: {
      runId: { type: 'string', description: 'Only this run’s.' },
      owner: { type: 'string', description: 'Only this owner’s, plus unowned ones.' },
    },
    additionalProperties: false,
  },
  validate(raw) {
    closed(raw, this.inputSchema);
    return { runId: str(raw, 'runId', { optional: true }), owner: str(raw, 'owner', { optional: true }) };
  },
  run(ctx, { runId, owner }) {
    const owners = ctx.files.constitution?.owners ?? [];
    return listInbox(ctx.store, runId)
      .map((row) => {
        const subject = row.kind === 'inbox_item' ? (getDecision(ctx.store, row.id)?.subject ?? {}) : {};
        return { ...row, owner: ownerFor(owners, `${row.question} ${JSON.stringify(subject)}`) };
      })
      .filter((d) => !owner || d.owner === null || d.owner.toLowerCase() === owner.toLowerCase());
  },
});
