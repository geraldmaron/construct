/**
 * cli/decide.ts — the calls that are the user's to make.
 *
 * A raised decision resolved in their words; an outward change approved,
 * rejected, or carried out. Approving carries nothing anywhere: the change is
 * handed to a host by a separate, named act, because a decision and a write on
 * someone else's system are two different things to be able to take back.
 */

import {
  decideProposal,
  getProposal,
  getSource,
  pendingProposals,
  writeConsentAllowsLowRisk,
} from '../kernel/store/sources.ts';
import { adoptProposedEdge, proposedSourceEdge } from '../kernel/store/source-edges.ts';
import type { SourceEdge } from '../kernel/store/source-edges.ts';
import { getDecision, resolveDecision } from '../kernel/store/decisions.ts';
import { recordLesson } from '../kernel/store/lessons.ts';
import { planFor } from '../kernel/store/plans.ts';
import { decideAdmission, riskTierFor } from '../kernel/lessons/admission.ts';
import { distillDecisionLesson } from '../kernel/lessons/fromDecisions.ts';
import { applyProposal } from '../kernel/run/apply.ts';
import { hasCapability } from '../kernel/hosts/interface.ts';
import type { HostAdapter } from '../kernel/hosts/interface.ts';
import { escapeForTerminal } from '../kernel/render/terminal.ts';
import { createHostApplier } from '../hosts/contextloop.ts';
import { adapterForHost, HOST_NAMES, now, withStore, withStoreAsync } from './runtime.ts';
import { messageOf } from './errors.ts';
import { parseHostFlags, splitFlags, workspaceFlag } from './flags.ts';
import type { HostFlags } from './flags.ts';
import { writeProposalRow } from './present.ts';

const DECIDE_USAGE =
  'usage: construct decide <id> "<your call>"\n' +
  '       construct decide --pending [--workspace=<name>]\n' +
  '       construct decide --approve=<proposal-id> "<why>"\n' +
  '       construct decide --reject=<proposal-id> "<why>"\n' +
  '       construct decide --apply=<proposal-id> --host=<opencode|claude> ' +
  '[--model=…] [--binary=…] [--dir=…] [--timeout=<minutes>]\n' +
  '         (codex and cursor dispatch read-only and cannot carry a change out)\n' +
  '         (a proposed relationship between your own sources needs no host)\n';

/**
 * The outward-write queue, made visible.
 *
 * A proposal announces itself once, in the run that filed it, and then waits.
 * Once that line scrolled away the queue was reachable only by opening the
 * database, so a change nobody could name was a change nobody could decide —
 * the same invisibility the held-lessons queue had. Listing it is what makes
 * the two decisions under it something a person can actually make.
 */
function pendingQueue(workspace: string): number {
  return withStore((store) => {
    const waiting = pendingProposals(store, workspace);
    if (waiting.length === 0) {
      process.stdout.write(`no outward changes are waiting in workspace ${workspace}\n`);
      return 0;
    }
    const standing = writeConsentAllowsLowRisk(store, workspace);
    process.stdout.write(
      `outward changes waiting in workspace ${workspace} (${String(waiting.length)}):\n\n`,
    );
    for (const proposal of waiting) writeProposalRow(store, proposal, standing);
    process.stdout.write(
      '\nApprove one with: construct decide --approve=<id> "<why>"\n' +
        'Reject one with:  construct decide --reject=<id> "<why>"\n',
    );
    return 0;
  });
}

/**
 * Approve or reject one waiting outward change.
 *
 * The only path to approved, and it records a human approval every time: a
 * workspace's standing consent covers the low-risk class and nothing else, so
 * a high-risk change becomes appliable through this command or not at all.
 * Approving carries nothing out — the change is still handed to a host by a
 * separate, named act, because a decision and a write on someone else's
 * system are two different things to be able to take back.
 */
function decideWrite(proposal: string, verdict: 'approved' | 'rejected', reason: string): number {
  return withStore((store) => {
    const record = getProposal(store, proposal);
    if (!record) {
      process.stderr.write(`decide: no outward change ${proposal} is waiting\n`);
      return 1;
    }
    try {
      decideProposal(store, proposal, verdict, reason, now());
    } catch (error) {
      process.stderr.write(`decide: ${(error as Error).message}\n`);
      return 1;
    }
    process.stdout.write(`${verdict} ${proposal}: ${reason}\n`);
    if (verdict === 'approved') {
      process.stdout.write(
        'Nothing has been written outward yet — carry it out with:\n' +
          `  construct decide --apply=${proposal} --host=<opencode|claude>\n`,
      );
    }
    return 0;
  });
}

/**
 * Carry out one approved outward change through a host.
 *
 * An approved proposal used to terminate as a row: the user had said yes, the
 * queue said approved, and the ticket never moved. Construct still builds no
 * connectors — it hands the approved words to the host the run dispatches
 * through and records only what that host reported succeeding. A host with no
 * way to reach the system says so, and the proposal stays approved and
 * unapplied, which is the honest state and the one that leaves the change
 * with the person who approved it.
 */
/**
 * Carry out an approved relationship between two of the user's own sources, or
 * answer null when the proposal is not one and belongs on the host path.
 *
 * The authority is the store's, not this function's: `adoptProposedEdge` runs
 * the same `markApplied` gate every other applied change passes, inside the
 * transaction that declares the relationship, so an undecided or rejected
 * proposal takes the declaration down with it rather than leaving a
 * relationship live with no decision behind it.
 */
function adoptRelation(proposal: string): number | null {
  return withStore((store) => {
    if (proposedSourceEdge(store, proposal) === null) return null;
    let edge: SourceEdge;
    try {
      edge = adoptProposedEdge(store, proposal, 'adopted by decision', now());
    } catch (error) {
      process.stderr.write(
        `decide: ${proposal} was not adopted — ${escapeForTerminal((error as Error).message)}\n`,
      );
      return 1;
    }
    process.stdout.write(
      `adopted ${proposal} as ${edge.id}; it is now read wherever ground is assembled.\n` +
        '  construct source relations\n',
    );
    return 0;
  });
}

async function applyApproved(
  proposal: string,
  host: HostFlags,
  hostOverride?: HostAdapter,
): Promise<number> {
  if (host.host === undefined && hostOverride === undefined) {
    process.stderr.write(
      'decide: carrying out a change needs a host — live Jira/GitHub connectors are ' +
        'not wired yet, so Construct reaches trackers only through a host.\n' +
        '  construct decide --apply=' +
        proposal +
        ' --host=<opencode|claude>\n',
    );
    return 2;
  }
  return withStoreAsync(async (store) => {
    const adapter =
      hostOverride ??
      adapterForHost(host.host, {
        binary: host.binary,
        model: host.model,
        dir: host.dir,
        timeoutMs: host.timeoutMs,
      });
    // Asked before a model call is spent, not after one comes back saying it
    // could not. The cursor and codex dispatch postures are probed read-only,
    // so a model under either cannot carry out any change however it is asked
    // — offering those hosts here and letting them fail would be selling a
    // capability that never existed.
    if (!hasCapability(adapter, 'outward-write')) {
      process.stderr.write(
        `decide: host "${adapter.name}" dispatches read-only, so it cannot carry out a change.\n` +
          `  ${HOST_NAMES.filter((h) => h === 'claude' || h === 'opencode').join(' or ')} can, ` +
          'because neither confines what the dispatched model may touch.\n' +
          '  That is also what it means: an apply there runs with whatever reach your own ' +
          'install of that host grants it.\n',
      );
      return 2;
    }
    try {
      await adapter.init();
    } catch (error) {
      process.stderr.write(`decide: host "${adapter.name}" is not available — ${escapeForTerminal((error as Error).message)}\n`);
      return 1;
    }
    process.stdout.write(
      `applying ${proposal} through ${adapter.name}, which dispatches unconfined — ` +
        'the model acts with whatever reach your install grants it.\n',
    );
    const result = await applyProposal(
      store,
      createHostApplier(adapter, (id) => {
        const declared = getSource(store, id);
        return {
          kind: declared?.kind ?? '',
          locator: declared?.locator ?? 'an undeclared source',
        };
      }),
      proposal,
      now(),
    );
    if (result.outcome === 'applied') {
      if (result.projected) {
        process.stdout.write(`mirrored as ${result.projected} before it crossed\n`);
      }
      process.stdout.write(`applied ${proposal}: ${escapeForTerminal(result.detail)}\n`);
      return 0;
    }
    if (result.outcome === 'unappliable') {
      if (result.projected) {
        process.stdout.write(
          `mirrored as ${result.projected} before the attempt; the mirror records what was proposed, not a landing\n`,
        );
      }
      process.stderr.write(`decide: ${proposal} was not applied — ${escapeForTerminal(result.reason)}\n`);
      return 1;
    }
    process.stderr.write(`decide: ${proposal} cannot be applied — ${escapeForTerminal(result.reason)}\n`);
    return 1;
  });
}

export async function decide(argv: string[], hostOverride?: HostAdapter): Promise<number> {
  const { flags, words } = splitFlags(argv);
  if (flags.pending !== undefined) return pendingQueue(workspaceFlag(flags));

  const verdict =
    flags.approve !== undefined ? 'approved' : flags.reject !== undefined ? 'rejected' : null;
  if (verdict !== null) {
    const proposal = (flags.approve ?? flags.reject ?? '').trim();
    const why = words.join(' ').trim();
    // A bare --approve leaves nothing to decide about, and a decision with no
    // reason is the audit line this queue exists to keep. Both are usage
    // errors rather than defaults, because guessing either one writes a
    // record about someone else's system that nobody wrote.
    if (!proposal || !why) {
      process.stderr.write(
        'decide: deciding an outward change needs the change and your reason.\n' + DECIDE_USAGE,
      );
      return 2;
    }
    return decideWrite(proposal, verdict, why);
  }

  if (flags.apply !== undefined) {
    // A relationship between the user's own sources lands in the user's own
    // store, so no host is asked and none is needed. Checked before the host
    // flags are parsed, because demanding a host for a change that reaches
    // nobody else's system would be an obstacle invented on the way to a local
    // write.
    const local = adoptRelation(flags.apply.trim());
    if (local !== null) return local;

    let host: HostFlags;
    try {
      host = parseHostFlags(flags);
    } catch (error) {
      process.stderr.write(`decide: ${(error as Error).message}\n${DECIDE_USAGE}`);
      return 2;
    }
    return applyApproved(flags.apply, host, hostOverride);
  }

  const [id, ...rest] = words;
  const resolution = rest.join(' ').trim();
  if (!id || !resolution) {
    process.stderr.write(DECIDE_USAGE);
    return 2;
  }
  return withStore((store) => {
    const at = now();
    try {
      resolveDecision(store, id, resolution, at, 'cli:user');
    } catch (error) {
      process.stderr.write(`decide: ${messageOf(error)}\n`);
      return 1;
    }
    process.stdout.write(`decided ${id}: ${resolution}\n`);

    // The first place a run's own operation becomes a candidate lesson rather
    // than only a document someone hands in. Distillation is mechanical (no
    // model reads the decision) and fail-soft on top of an already-succeeded
    // resolution: losing the lesson is not losing the decision, so a failure
    // here is reported, not thrown.
    const resolved = getDecision(store, id);
    const distilled = resolved && distillDecisionLesson(resolved);
    if (resolved && distilled) {
      try {
        recordLesson(store, {
          id: distilled.id,
          workspace: planFor(store, resolved.run)?.workspace ?? resolved.run,
          kind: 'process',
          body: distilled.body,
          citation: distilled.citation,
          external: false,
          supersedes: null,
          createdAt: at,
        });
        const worst =
          distilled.domains.find((d) => riskTierFor(d) === 'high') ?? distilled.domains[0] ?? resolved.run;
        // The gate holds every run-derived lesson unconditionally (see
        // runDerived() in lessons/admission.ts), so this basis is never read
        // into a reason on this path — it exists only because DecideAdmission
        // requires one. Admitting this lesson for real is a later, separate
        // call with basis: {kind: 'human-approval', ...}, made by whoever
        // reviews the held queue, not by this command.
        const admitted = decideAdmission(store, {
          lessonId: distilled.id,
          domain: worst,
          basis: { kind: 'adversarial-pass', detail: 'not applicable: no adversarial pass runs on a run-derived lesson' },
          decidedAt: at,
        });
        process.stdout.write(
          `distilled ${distilled.id} (${admitted.verdict}): ${escapeForTerminal(admitted.reason)}\n`,
        );
      } catch (error) {
        process.stdout.write(
          `the decision was resolved but the lesson could not be recorded (${escapeForTerminal((error as Error).message)})\n`,
        );
      }
    }
    return 0;
  });
}
