/**
 * cli/plan.ts — a run's recorded plan, read back. Read-only: the plan is
 * write-once at outcome time, so this command shows and never edits.
 */

import { planFor } from '../kernel/store/plans.ts';
import { escapeForTerminal } from '../kernel/render/terminal.ts';
import { withStore } from './runtime.ts';

const PLAN_USAGE = 'usage: construct plan <run-id>\n';

/**
 * Render a run's recorded plan: the understanding it worked from, its risk
 * tier, the steps with their playbook routing and deliverable slots, and anything
 * the planner discarded for fabricated provenance. Read-only: the plan is
 * write-once at outcome time, so this command shows, never edits.
 */
export function plan(argv: string[]): number {
  const runId = argv[0];
  if (!runId || runId.startsWith('--')) {
    process.stderr.write(PLAN_USAGE);
    return 2;
  }
  return withStore((store) => {
    const found = planFor(store, runId);
    if (!found) {
      process.stderr.write(`plan: no plan recorded for ${runId}\n`);
      return 1;
    }
    process.stdout.write(`plan ${found.id} (run ${found.run}, ${found.plannedAt})\n`);
    process.stdout.write(`  outcome: ${found.outcome}\n`);
    process.stdout.write(`  understood as: ${escapeForTerminal(found.understanding.restated)}\n`);
    for (const c of found.understanding.constraints) process.stdout.write(`  constraint: ${escapeForTerminal(c)}\n`);
    for (const d of found.understanding.decisions) process.stdout.write(`  decided: ${escapeForTerminal(d)}\n`);
    for (const p of found.understanding.parked) process.stdout.write(`  parked: ${escapeForTerminal(p)}\n`);
    process.stdout.write(`  risk: ${found.riskTier}  mode: ${found.mode}\n`);
    process.stdout.write(
      found.sourcesDeclared.length > 0
        ? `  sources declared: ${found.sourcesDeclared.join(', ')}\n`
        : '  sources declared: none\n',
    );
    if (found.steps.length === 0) {
      process.stdout.write('  steps: none — nothing was implicated\n');
    }
    for (const step of found.steps) {
      const route = found.routing.find((r) => r.step === step.id);
      process.stdout.write(`\n  ${step.id}  ${escapeForTerminal(step.description)}\n`);
      process.stdout.write(
        `    routed to ${step.domain} by ${route?.routedBy ?? 'unknown'}` +
          (route && route.evidence.length > 0 ? ` (${escapeForTerminal(route.evidence.slice(0, 4).join(', '))})` : '') +
          '\n',
      );
      process.stdout.write(`    stage: ${step.stage}  deliverable: ${step.deliverable.deliverable}\n`);
      const required = step.deliverable.slots.filter((s) => s.required).map((s) => s.name);
      process.stdout.write(`    required slots: ${required.join(', ')}\n`);
      if (step.after.length > 0) process.stdout.write(`    after: ${step.after.join(', ')}\n`);
    }
    for (const d of found.discarded) {
      process.stdout.write(`\n  discarded: ${escapeForTerminal(d.description)} — ${escapeForTerminal(d.reason)}\n`);
    }
    return 0;
  });
}
