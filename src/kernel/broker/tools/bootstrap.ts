import { closed } from '../definition.ts';
import { getProfile, missingProfileFields } from '../../state/profile.ts';
import { listOpenDecisions } from '../../state/decisions.ts';
import { onboardingStatus } from '../../project/onboarding.ts';
import { listActiveRuns } from '../../state/runs.ts';
import { lockStatus } from '../../registry/lockfile.ts';
import { emptyLock } from '../../project/lock.ts';
import { listDriftFindings } from '../../state/drift.ts';
import { contextIndexStatus } from '../../context/retrieval.ts';
import { TIER_POLICIES } from '../../policy/lattice.ts';
import { coordinationFor } from '../../coord/awareness.ts';
import { INTERACTIVE_ENTRY_GUIDANCE } from '../context.ts';
import { define, waitingOn, setupQuestion } from './shared.ts';

export const bootstrap = define<Record<string, never>, unknown>({
  name: 'bootstrap',
  title: 'Where things stand',
  description:
    'Call once at the start of a session. Returns the project binding, how complete its setup is, the questions still open, source and registry health, what this session may do, open decisions and active runs, and the recommended next action. Small on purpose; ask for details with project_context.',
  surface: 'both',
  readOnly: true,
  inputSchema: { type: 'object', properties: {}, additionalProperties: false },
  validate(raw) {
    closed(raw, this.inputSchema);
    return {} as Record<string, never>;
  },
  async run(ctx) {
    const at = ctx.now();
    const moved: string[] = [];
    const hostRead: string[] = [];
    for (const s of ctx.sources.list()) {
      if (!ctx.sources.canRead(s.id)) {
        const f = ctx.sources.status(s.id, at).freshness;
        if (f === 'never_read' || f === 'stale') hostRead.push(s.id);
      } else if ((await ctx.sources.peek(s.id)) === true) moved.push(s.id);
    }
    const profile = getProfile(ctx.store);
    const open = listOpenDecisions(ctx.store);
    const waits = waitingOn(open);
    const proposals = onboardingStatus(ctx.store).proposalsAwaitingReview;
    const runs = listActiveRuns(ctx.store);
    const workable = runs.filter((r) => r.state === 'ready' || r.state === 'running');
    const blocked = runs.filter((r) => r.state === 'blocked' || r.state === 'preflight');
    const sources = ctx.sources.summary(at);
    const lock = lockStatus(ctx.files.lock ?? emptyLock(), ctx.skills.list(), ctx.workflows.list());
    const skew = lock.filter((r) => r.state !== 'current');
    const drift = listDriftFindings(ctx.store, { status: 'open' });
    const missing = missingProfileFields(profile);
    // What waits until after the person's request: setup questions, proposed statements, and earlier questions only they can answer.
    const afterRequest = [
      ...(waits.setup.length > 0
        ? [
            `handle what the person asked first; ask a setup question only when its answer changes that work (the project's scale changes how much challenge managed work gets), in the same single message, and relay answers with decide; if they asked nothing yet, put the ${String(waits.setup.length)} setup question(s) to them in one message`,
          ]
        : []),
      ...(proposals > 0
        ? [
            `when the person is free, offer the ${String(proposals)} proposed statement(s) from inbox for confirmation; never before their request`,
          ]
        : []),
      ...(waits.earlier.length > 0
        ? [`${String(waits.earlier.length)} earlier question(s) wait in inbox for the person's own answer; offer them after their request`]
        : []),
    ];
    const next =
      waits.inRuns.length > 0
        ? `${String(waits.inRuns.length)} decision(s) about runs wait on the person; show them with inbox`
        : workable.length > 0
          ? `${String(workable.length)} run(s) active; continue with claim_work`
          : blocked.length > 0
            ? `${String(blocked.length)} run(s) blocked (${blocked
                .slice(0, 3)
                .map((r) => r.id)
                .join(', ')}${blocked.length > 3 ? ', …' : ''}); claim_work with a runId says what would unblock it`
            : moved.length > 0
              ? `${moved.join(', ')} changed since last read; refresh with sources before relying on them`
              : drift.length > 0 || waits.aboutDrift.length > 0
                ? `${String(drift.length)} drift finding(s) open${waits.aboutDrift.length > 0 ? ` and ${String(waits.aboutDrift.length)} decision(s) on them wait on the person` : ''}; read them with project_context drift and tell the person`
                : afterRequest.length > 0
                  ? afterRequest.join('; ')
                  : 'listen: answer questions plainly, remember what the person asks to keep, start an outcome when asked for work';
    return {
      construct: {
        version: ctx.version,
        project: { root: ctx.root, id: ctx.files.config?.id ?? null, name: ctx.files.config?.name ?? null, lane: ctx.lane },
      },
      session: { host: ctx.host.hostId, session: ctx.sessionId ?? ctx.host.sessionId, executor: ctx.host.executorId, actor: ctx.actor },
      profile: { onboarding: profile?.onboardingState ?? 'incomplete', missing, openQuestions: waits.setup.map(setupQuestion), proposals },
      // Sources only the host can read: when it reads them, it reports what it read so changes are tracked.
      sources: { ...sources, changedSinceRead: moved, reportWhenRead: hostRead },
      registry: {
        skills: ctx.skills.list().length,
        workflows: ctx.workflows.list().length,
        locked: lock.filter((r) => r.state === 'current').length,
        skew: skew.map((r) => `${r.kind} ${r.id} ${r.state}`),
      },
      contextIndex: contextIndexStatus(ctx.store),
      capabilities: {
        available: [...ctx.host.available].sort(),
        declared: [...(ctx.host.declared ?? [])].sort(),
        reported: ctx.host.reported ?? [],
        probed: ctx.host.probed ?? [],
        exercised: [...(ctx.host.exercised ?? [])].sort(),
        readiness:
          'host-mediated capabilities remain unverified until observed for this session and scope; available is not a successful execution receipt',
        maxTier: ctx.host.maxTier,
        restrictions: ctx.host.restrictions,
        budgetCents: ctx.host.budgetCents,
      },
      tiers: Object.values(TIER_POLICIES).map((p) => ({ tier: p.tier, requirement: p.requirement })),
      decisions: { open: open.length },
      runs: runs.map((r) => ({ id: r.id, workflow: r.workflowId, state: r.state })),
      drift: { open: drift.length },
      coordination: coordinationFor(ctx.store, { sessionId: ctx.sessionId, laneRoot: ctx.lane?.root, now: at }),
      next:
        ctx.surface === 'headless'
          ? 'Continue only the assigned run with claim_step, heartbeat, submit_work and run_status. Do not create outcomes or record project decisions.'
          : `${INTERACTIVE_ENTRY_GUIDANCE} Project state: ${next}`,
    };
  },
});
