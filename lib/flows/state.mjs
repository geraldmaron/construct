/**
 * lib/flows/state.mjs — typed state transitions validated against a flow's schema.
 *
 * transition() merges a shallow delta into the current state and validates the
 * result against the flow's state schema before it becomes the new state. A
 * failing transition never mutates the caller's state: it returns a structured
 * `{ ok: false, error }` result carrying every schema violation, so the engine
 * can surface a typed `invalid-state` step result instead of throwing mid-flow.
 */

import { validateSchema } from './schema.mjs';

export function createInitialState(schema, seed = {}) {
  const result = validateSchema(schema, seed);
  if (!result.valid) {
    return { ok: false, error: { code: 'INVALID_INITIAL_STATE', message: 'initial state fails the flow schema', errors: result.errors } };
  }
  return { ok: true, state: seed };
}

export function transition(schema, state, delta = {}) {
  const merged = { ...state, ...delta };
  const result = validateSchema(schema, merged);
  if (!result.valid) {
    return {
      ok: false,
      error: { code: 'INVALID_STATE_TRANSITION', message: 'state transition produced invalid state', errors: result.errors },
    };
  }
  return { ok: true, state: merged };
}
