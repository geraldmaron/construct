/**
 * lib/flows/joins.mjs — and/or join combinators for step declarations.
 *
 * andJoin(steps) declares that a step only becomes ready once every listed
 * predecessor has completed and routed into it (a fan-in barrier). anyJoin
 * (steps) declares reconvergence — the step is ready the first time any one
 * of the listed predecessors routes into it, which is also the engine's
 * default when a step declares no waitFor at all. Both return a plain,
 * serializable `waitFor` descriptor consumed by defineFlow() and engine.mjs.
 */

export function andJoin(steps) {
  return { mode: 'all', steps: [...steps] };
}

export function anyJoin(steps) {
  return { mode: 'any', steps: [...steps] };
}
