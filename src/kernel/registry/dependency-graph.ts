/**
 * kernel/registry/dependency-graph.ts — the DAG of a workflow's steps, and
 * the graph of skill dependencies, with cycle detection and a stable order.
 */

import type { WorkflowStep } from './models.ts';

export class DependencyCycleError extends Error {
  readonly cycle: readonly string[];

  constructor(kind: string, cycle: readonly string[]) {
    super(`${kind} dependency cycle: ${cycle.join(' -> ')}`);
    this.name = 'DependencyCycleError';
    this.cycle = cycle;
  }
}

/** Topological order over nodes by their `needs`. Throws on a cycle, naming it. */
export function topologicalOrder(kind: string, nodes: ReadonlyMap<string, readonly string[]>): string[] {
  const state = new Map<string, 'visiting' | 'done'>();
  const order: string[] = [];
  const stack: string[] = [];
  const visit = (id: string): void => {
    const s = state.get(id);
    if (s === 'done') return;
    if (s === 'visiting') {
      const start = stack.indexOf(id);
      throw new DependencyCycleError(kind, [...stack.slice(start), id]);
    }
    state.set(id, 'visiting');
    stack.push(id);
    for (const dep of nodes.get(id) ?? []) {
      if (!nodes.has(dep)) throw new Error(`${kind} "${id}" depends on "${dep}", which is not known`);
      visit(dep);
    }
    stack.pop();
    state.set(id, 'done');
    order.push(id);
  };
  for (const id of [...nodes.keys()].sort()) visit(id);
  return order;
}

export function stepOrder(steps: readonly WorkflowStep[]): string[] {
  return topologicalOrder('step', new Map(steps.map((s) => [s.id, s.needs])));
}

/** Steps whose needs are all in `done`, in stable order. */
export function readySteps(steps: readonly WorkflowStep[], done: ReadonlySet<string>): WorkflowStep[] {
  return stepOrder(steps)
    .map((id) => steps.find((s) => s.id === id)!)
    .filter((s) => !done.has(s.id) && s.needs.every((n) => done.has(n)));
}
