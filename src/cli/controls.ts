/**
 * cli/controls.ts — the two levers an operator has over work already in
 * flight, both per task and both requiring a reason.
 *
 * A waiver sets one challenge aside on one deliverable; a revocation takes one
 * dispatched role's write surface away before its lease expires. The record of
 * a control being used is the only thing that distinguishes an operator
 * stopping a runaway from work quietly disappearing.
 *
 * On format-v1 projects these raise typed inbox entries (and resolve when the
 * call is complete) rather than writing the legacy home store.
 */

import { getTask } from '../kernel/store/tasks.ts';
import { revocationOf, revokeRoleCapability } from '../kernel/run/rolewrite.ts';
import { promotionOf, waiveChallenge } from '../kernel/run/promotion.ts';
import { now, withStore } from './runtime.ts';
import { splitFlags } from './flags.ts';
import { tryOpenProjectStore } from './project-store.ts';
import { printJudgmentResult, raiseAndMaybeResolve } from './judgment-v1.ts';

const WAIVE_USAGE =
  'usage: construct waive --task=<id> --challenge=<id> --reason="<why>"\n';

/**
 * Set one challenge aside, on one deliverable.
 *
 * There is deliberately no --all, no config key, and no way to waive a
 * challenge for future work: commitment 13 puts waivers with the user alone,
 * per deliverable and per challenge, and a waiver that outlives the deliverable
 * it was granted for is the global off-switch that commitment forbids.
 */
export function waive(argv: string[], cwd: string = process.cwd()): number {
  const flags: Record<string, string> = {};
  for (const arg of argv) {
    const match = /^--([a-z-]+)=(.*)$/.exec(arg);
    if (match) flags[match[1]] = match[2];
  }
  const task = flags.task;
  const challenge = flags.challenge;
  const reason = flags.reason ?? '';
  if (!task || !challenge) {
    process.stderr.write(WAIVE_USAGE);
    return 2;
  }

  const opened = tryOpenProjectStore(cwd);
  if (opened) {
    try {
      const result = raiseAndMaybeResolve(opened.store, {
        kind: 'requires_waiver',
        question: `Waive challenge ${challenge} on task ${task}?`,
        subject: { taskId: task, challengeId: challenge },
        ...(reason.trim() !== ''
          ? { resolution: { reason: reason.trim(), challengeId: challenge, taskId: task } }
          : {}),
      });
      printJudgmentResult(
        'requires_waiver',
        result,
        reason.trim() !== '' ? reason.trim() : `challenge ${challenge} on ${task}`,
      );
      return 0;
    } catch (error) {
      process.stderr.write(
        `waive: ${error instanceof Error ? error.message : String(error)}\n`,
      );
      return 1;
    } finally {
      opened.store.close();
    }
  }

  return withStore((store) => {
    const record = waiveChallenge(store, {
      task,
      challenge,
      // The waiver is the user's, and the record says so rather than letting it
      // read as something the system decided.
      by: 'user',
      reason,
      at: now(),
    });
    if (!record.recorded) {
      process.stderr.write(`waive: ${record.reason ?? 'refused'}\n`);
      return record.refusal === 'unknown-task' ? 1 : 2;
    }
    const promotion = promotionOf(store, task);
    process.stdout.write(`waived ${challenge} on ${task}: ${reason}\n`);
    if (promotion) {
      process.stdout.write(
        `  ${task} is now ${promotion.state}` +
          (promotion.waived.length > 0 ? ` (waived: ${promotion.waived.join(', ')})` : '') +
          '\n',
      );
    }
    return 0;
  });
}

const REVOKE_USAGE =
  'usage: construct revoke --task=<id> --reason="<why>"\n';

/**
 * Take one dispatched role's write surface away before its lease expires.
 *
 * Per task, and reasoned. The lever that existed before this was rotating the
 * install-wide signing secret, which kills every outstanding token for every
 * run at once — so an operator watching one role loop past its caps had to
 * choose between waiting out the lease and taking down everything in flight.
 *
 * A reason is required rather than optional for the same reason a waiver
 * requires one: the record of a control being used is the only thing that
 * distinguishes an operator stopping a runaway from work quietly disappearing,
 * and the role is told what the reason was when its next write is refused.
 */
export function revoke(argv: string[], cwd: string = process.cwd()): number {
  const { flags } = splitFlags(argv);
  const task = flags.task;
  const reason = flags.reason?.trim();
  if (task === undefined || reason === undefined || reason === '') {
    process.stderr.write(REVOKE_USAGE);
    return 2;
  }

  const opened = tryOpenProjectStore(cwd);
  if (opened) {
    try {
      const result = raiseAndMaybeResolve(opened.store, {
        kind: 'requires_revocation',
        question: `Revoke write surface for task ${task}?`,
        subject: { taskId: task },
        resolution: { reason, taskId: task },
      });
      printJudgmentResult('requires_revocation', result, reason);
      return 0;
    } catch (error) {
      process.stderr.write(
        `revoke: ${error instanceof Error ? error.message : String(error)}\n`,
      );
      return 1;
    } finally {
      opened.store.close();
    }
  }

  return withStore((store) => {
    const row = getTask(store, task);
    if (!row) {
      process.stderr.write(`revoke: no task ${task}\n`);
      return 1;
    }
    const already = revocationOf(store, row.run, task);
    if (already !== null) {
      process.stdout.write(`${task} was already revoked: ${already}\n`);
      return 0;
    }
    revokeRoleCapability(store, {
      run: row.run,
      task,
      reason,
      at: new Date().toISOString(),
    });
    process.stdout.write(
      `revoked ${task} (${row.role}): ${reason}\n` +
        'Its next write is refused and says so. Every other role in the run keeps writing, ' +
        'and the deliverable it already submitted stays on the record.\n',
    );
    return 0;
  });
}
