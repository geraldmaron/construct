/**
 * cli/status.ts — where this project stands: completeness, work in flight,
 * decisions waiting, source health, registry lock, drift. One state universe.
 */

import { listActiveRuns } from '../kernel/state/runs.ts';
import { listOpenDecisions } from '../kernel/state/decisions.ts';
import { listDriftFindings } from '../kernel/state/drift.ts';
import { onboardingStatus } from '../kernel/project/onboarding.ts';
import { createSourceService } from '../kernel/source/service.ts';
import { createSkillRegistry } from '../kernel/registry/skill-registry.ts';
import { createWorkflowRegistry } from '../kernel/registry/workflow-registry.ts';
import { lockStatus } from '../kernel/registry/lockfile.ts';
import { emptyLock } from '../kernel/project/lock.ts';
import type { CommandSpec, ParsedArgs } from './commands.ts';
import { createContext, withProject, type CliContext } from './context.ts';
import { esc, say, writeJson } from './output.ts';

export const STATUS_SPEC: CommandSpec = {
  path: ['status'],
  gloss: 'where this project stands: setup, work, decisions, sources, registry, drift',
  group: 'Inspect',
  positionals: [],
  flags: [],
  readOnly: true,
};

export function status(args: ParsedArgs, ctx: CliContext = createContext()): number {
  return withProject(ctx, ({ root, files, store, layout }) => {
    const at = ctx.now();
    const onboarding = onboardingStatus(store);
    const sources = createSourceService(store, { readers: new Map() }).summary(at);
    const runs = listActiveRuns(store);
    const decisions = listOpenDecisions(store);
    const drift = listDriftFindings(store, { status: 'open' });
    const lock = files.lock;
    const rows = lockStatus(lock ?? emptyLock(), createSkillRegistry({ projectDir: layout.skillsDir }).list(), createWorkflowRegistry({ projectDir: layout.workflowsDir }).list());
    const skew = rows.filter((r) => r.state !== 'current');
    const record = {
      root,
      project: files.config ? { id: files.config.id, name: files.config.name } : null,
      onboarding: { state: onboarding.state, missing: onboarding.missing, openQuestions: onboarding.openQuestions.length, proposalsAwaitingReview: onboarding.proposalsAwaitingReview },
      runs: { active: runs.length, byState: Object.fromEntries(runs.map((r) => [r.id, r.state])) },
      decisions: { open: decisions.length },
      sources,
      registry: { skills: lock ? Object.keys(lock.skills).length : 0, workflows: lock ? Object.keys(lock.workflows).length : 0, skew: skew.map((r) => ({ kind: r.kind, id: r.id, state: r.state })) },
      drift: { open: drift.length },
    };
    if (args.json) {
      writeJson(record);
      return 0;
    }
    say(`${esc(files.config?.name ?? 'project')} at ${esc(root)}`);
    say(`  setup: ${onboarding.state}${onboarding.missing.length ? ` (missing ${onboarding.missing.join(', ')})` : ''}; ${String(onboarding.openQuestions.length)} question(s) open; ${String(onboarding.proposalsAwaitingReview)} proposal(s) to review`);
    say(`  work: ${runs.length === 0 ? 'nothing in flight' : runs.map((r) => `${r.workflowId} ${r.state}`).join(', ')}`);
    say(`  decisions: ${decisions.length === 0 ? 'none waiting on you' : `${String(decisions.length)} waiting on you`}`);
    say(`  sources: ${String(sources.total)} declared; ${String(sources.reachable)} reachable, ${String(sources.unreachable)} unreachable, ${String(sources.unknown)} never checked; ${String(sources.stale)} stale`);
    say(`  registry: ${lock ? `${String(Object.keys(lock.skills).length)} skill(s), ${String(Object.keys(lock.workflows).length)} workflow(s) locked` : 'no lockfile'}${skew.length ? `; ${String(skew.length)} not current (${skew.map((r) => `${r.id} ${r.state}`).join(', ')})` : '; all current'}`);
    say(`  drift: ${drift.length === 0 ? 'nothing open' : `${String(drift.length)} finding(s) open`}`);
    return 0;
  });
}
