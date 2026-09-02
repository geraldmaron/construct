/**
 * cli/judgment-v1.ts — map legacy judgment verbs onto typed Inbox on format v1.
 *
 * On an initialized project, waive/revoke/verdict/consent/trust raise a typed
 * decision and, when the operator already supplied the call, resolve it so the
 * side effect runs through DecisionService — one inbox model, working paths.
 */

import { randomUUID } from 'node:crypto';
import { createDecisionService } from '../kernel/services/decision.ts';
import type { DecisionKind, DecisionSubject } from '../kernel/state-v1/decisions.ts';
import type { StateStore } from '../kernel/state-v1/open.ts';
import { escapeForTerminal } from '../kernel/render/terminal.ts';
import { now } from './runtime.ts';

function newDecisionId(kind: DecisionKind, at: string): string {
  return `dec-${kind.replace(/^requires_/, '')}-${at.replace(/[-:.TZ]/g, '')}-${randomUUID().slice(0, 8)}`;
}

export function raiseAndMaybeResolve(
  store: StateStore,
  input: {
    readonly kind: DecisionKind;
    readonly question: string;
    readonly subject?: DecisionSubject;
    readonly runId?: string;
    /** When set, resolve immediately with this payload (legacy verb carried the call). */
    readonly resolution?: unknown;
  },
): { readonly id: string; readonly resolved: boolean } {
  const decisions = createDecisionService(store);
  const at = now();
  const id = newDecisionId(input.kind, at);
  decisions.raise({
    id,
    kind: input.kind,
    question: input.question,
    at,
    ...(input.runId ? { runId: input.runId } : {}),
    ...(input.subject ? { subject: input.subject } : {}),
  });
  if (input.resolution !== undefined) {
    decisions.resolve({
      id,
      resolution: input.resolution,
      resolvedBy: 'operator',
      at,
    });
    return { id, resolved: true };
  }
  return { id, resolved: false };
}

export function printJudgmentResult(
  kind: DecisionKind,
  result: { readonly id: string; readonly resolved: boolean },
  detail: string,
): void {
  if (result.resolved) {
    process.stdout.write(
      `${kind} ${result.id} resolved: ${escapeForTerminal(detail)}\n` +
        '(typed inbox — prefer: construct inbox / construct inbox decide)\n',
    );
  } else {
    process.stdout.write(
      `raised ${result.id} [${kind}]: ${escapeForTerminal(detail)}\n` +
        `Resolve with: construct inbox decide ${result.id} "<your call>"\n`,
    );
  }
}
