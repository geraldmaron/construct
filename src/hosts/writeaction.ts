/**
 * hosts/writeaction.ts — the host-layer implementation of kernel's
 * `WriteActionProposer` seam (kernel/run/proposals.ts).
 *
 * Mirrors hosts/namer.ts's shape: the kernel defines the seam and constructs
 * nothing, this module is the adapter side, and any conforming `HostAdapter`
 * gets the seam for free. A reply this module cannot use — an error status,
 * no text, unparseable JSON, or a string outside `WRITE_ACTIONS` — resolves to
 * null rather than throwing, because proposeActionsWithModel reads null as
 * "nobody decided this one" and falls the row through to the keyword read;
 * one row a model could not classify must not cost the whole deliverable its
 * extraction.
 */

import type { HostAdapter } from '../kernel/hosts/interface.ts';
import type { Finding, WriteAction, WriteActionProposer } from '../kernel/run/proposals.ts';
import { WRITE_ACTIONS } from '../kernel/run/proposals.ts';
import { extractJson } from './contextloop.ts';

export const WRITE_ACTION_ROLE = 'write-action';

export function actionChoicePrompt(finding: Finding): string {
  return [
    'A finding from a finished deliverable is about to become a write proposal',
    "against some system outside this one. Which kind of change is the finding's",
    'own wording actually asking for?',
    '',
    '- comment: record the finding where the work lives; nothing about the',
    '  target changes. The right answer when the finding reports something',
    '  rather than asking for a change.',
    '- label: tag, flag, or classify something that already exists.',
    '- create: open something new — a ticket, a document, an entry.',
    '- update: change words or state that already exist — edit, rename, close,',
    '  move, or reprioritize something.',
    '',
    `The finding, exactly as written:\n${finding.text}`,
    '',
    'Reply with JSON only, no prose outside it:',
    `{"action":"<one of: ${WRITE_ACTIONS.join(', ')}>"}`,
  ].join('\n');
}

/**
 * Build a `WriteActionProposer` backed by a host adapter. Caller owns the
 * adapter's lifecycle: `init()` must have succeeded before the returned
 * proposer is used.
 */
export function createHostActionProposer(host: HostAdapter): WriteActionProposer {
  return async (finding) => {
    try {
      const result = await host.invoke({ role: WRITE_ACTION_ROLE, task: actionChoicePrompt(finding) });
      if (result.status !== 'ok') return null;
      const text = (result.output as { text?: unknown } | null)?.text;
      if (typeof text !== 'string' || !text.trim()) return null;
      const parsed = extractJson(text) as { action?: unknown } | null;
      const action = typeof parsed?.action === 'string' ? parsed.action.trim().toLowerCase() : '';
      return (WRITE_ACTIONS as readonly string[]).includes(action) ? (action as WriteAction) : null;
    } catch {
      return null;
    }
  };
}
