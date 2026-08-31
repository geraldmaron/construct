/**
 * kernel/services/decision.ts — inbox / approvals façade.
 */

import type { StateStore } from '../state/open.ts';
import {
  raiseDecision,
  resolveDecision,
  listOpenDecisions,
  getDecision,
  type Decision,
} from '../state/decisions.ts';

export interface DecisionService {
  raise(input: Parameters<typeof raiseDecision>[1]): Decision;
  resolve(input: Parameters<typeof resolveDecision>[1]): Decision;
  inbox(): Decision[];
  get(id: string): Decision | null;
}

export function createDecisionService(store: StateStore): DecisionService {
  return {
    raise: (input) => raiseDecision(store, input),
    resolve: (input) => resolveDecision(store, input),
    inbox: () => listOpenDecisions(store),
    get: (id) => getDecision(store, id),
  };
}
