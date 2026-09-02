/**
 * cli/work-v1.ts — headless operator control plane for format-v1 projects.
 *
 * Interactive dispatch lives on MCP (InteractiveRunService). This path is the
 * explicit headless operator: claim / submit / status with a required pin and
 * no ambient host census or resource selection.
 */

import { createHeadlessRunService } from '../kernel/services/headless-run.ts';
import { listTasks, countTasksByState, getTask } from '../kernel/state-v1/tasks.ts';
import { getDeliverableByTask } from '../kernel/state-v1/deliverables.ts';
import { escapeForTerminal } from '../kernel/render/terminal.ts';
import type { StateStore } from '../kernel/state-v1/open.ts';
import { now } from './runtime.ts';
import { parseFlags } from './flags.ts';

const USAGE =
  'usage: construct work claim --pin=<executor> [--run=<id>] [--lease-minutes=N]\n' +
  '       construct work submit --pin=<executor> --task=<id> --token=<n> (--deliverable=<json>|--note=<text>)\n' +
  '       construct work status [--run=<id>]\n' +
  '\n' +
  'Initialized projects use this headless operator path. Interactive work is\n' +
  'MCP next_work / submit_work in the host session — never ambient census.\n';

function leaseUntilIso(minutes: number, at: string): string {
  const ms = Date.parse(at) + Math.max(1, minutes) * 60_000;
  return new Date(ms).toISOString();
}

function parseDeliverable(raw: string | undefined): unknown {
  if (raw === undefined) return undefined;
  const trimmed = raw.trim();
  if (trimmed === '') return undefined;
  try {
    return JSON.parse(trimmed) as unknown;
  } catch {
    return trimmed;
  }
}

export function workV1(store: StateStore, argv: string[]): number {
  const sub = (argv[0] ?? '').trim();
  if (!sub || sub === '--help' || sub === '-h') {
    process.stdout.write(USAGE);
    return sub ? 0 : 2;
  }

  const { flags } = parseFlags(argv.slice(1));
  const at = now();

  if (sub === 'status') {
    const runId = (flags.run ?? '').trim() || undefined;
    const counts = countTasksByState(store, runId);
    const tasks = listTasks(store, runId);
    process.stdout.write(
      `work status` +
        (runId ? ` (run ${runId})` : '') +
        `: pending=${String(counts.pending)} leased=${String(counts.leased)} ` +
        `done=${String(counts.done)} failed=${String(counts.failed)}\n`,
    );
    for (const task of tasks) {
      const deliv = getDeliverableByTask(store, task.id);
      const trust = deliv ? ` trust=${deliv.trustState}` : '';
      process.stdout.write(
        `  ${task.id}  ${task.state}  ${task.role}${trust}\n`,
      );
    }
    if (tasks.length === 0) {
      process.stdout.write('  (no tasks)\n');
    }
    return 0;
  }

  const pin = (flags.pin ?? '').trim();
  if (!pin) {
    process.stderr.write('construct work: --pin=<executor> is required on initialized projects\n');
    process.stderr.write(USAGE);
    return 2;
  }

  const headless = createHeadlessRunService(store, {
    executorPin: pin,
    owner: `headless:${pin}`,
    allowResourceSelection: false,
  });

  if (sub === 'claim') {
    const runId = (flags.run ?? '').trim() || undefined;
    const leaseMinutes = Number(flags['lease-minutes'] ?? '30');
    if (!Number.isFinite(leaseMinutes) || leaseMinutes <= 0) {
      process.stderr.write('construct work claim: --lease-minutes must be a positive number\n');
      return 2;
    }
    const leased = headless.nextWork({
      now: at,
      leaseUntil: leaseUntilIso(leaseMinutes, at),
      runId,
    });
    if (!leased) {
      process.stdout.write('no claimable work.\n');
      return 0;
    }
    process.stdout.write(
      `claimed ${leased.id} (run ${leased.runId}, role ${leased.role}, token ${String(leased.token)})\n` +
        `  pin=${pin}  lease until ${leased.leaseUntil}\n` +
        `  submit: construct work submit --pin=${pin} --task=${leased.id} --token=${String(leased.token)} --deliverable='{"…"}'\n`,
    );
    return 0;
  }

  if (sub === 'submit') {
    const taskId = (flags.task ?? '').trim();
    const tokenRaw = (flags.token ?? '').trim();
    const token = Number(tokenRaw);
    if (!taskId || !Number.isFinite(token) || tokenRaw === '') {
      process.stderr.write(
        'usage: construct work submit --pin=<executor> --task=<id> --token=<n> (--deliverable=<json>|--note=<text>)\n',
      );
      return 2;
    }
    const row = getTask(store, taskId);
    if (!row || row.state !== 'leased' || row.leaseOwner === null || row.leaseUntil === null) {
      process.stderr.write(`construct work submit: task ${taskId} is not leased\n`);
      return 1;
    }
    if (row.attempts !== token) {
      process.stderr.write(
        `construct work submit: token ${tokenRaw} does not match lease (expected ${String(row.attempts)})\n`,
      );
      return 1;
    }
    const deliverable = parseDeliverable(flags.deliverable);
    const note = flags.note?.trim();
    if (deliverable === undefined && (!note || note === '')) {
      process.stderr.write('construct work submit: pass --deliverable=<json> or --note=<text>\n');
      return 2;
    }
    try {
      const result = headless.submitWork({
        leased: {
          ...row,
          leaseOwner: row.leaseOwner,
          leaseUntil: row.leaseUntil,
          token,
        },
        at,
        ...(deliverable !== undefined ? { deliverable } : {}),
        ...(note ? { note } : {}),
        settleNoteAsDone: deliverable === undefined,
      });
      process.stdout.write(
        `submitted ${result.task.id} → ${result.task.state}` +
          (result.deliverable
            ? ` (deliverable ${result.deliverable.id} trust=${result.deliverable.trustState})`
            : result.noteOnly
              ? ' (note only)'
              : '') +
          '\n',
      );
      return 0;
    } catch (error) {
      process.stderr.write(
        `construct work submit: ${error instanceof Error ? error.message : String(error)}\n`,
      );
      return 1;
    }
  }

  process.stderr.write(
    `construct work: unknown subcommand ${escapeForTerminal(sub)}\n` + USAGE,
  );
  return 2;
}
