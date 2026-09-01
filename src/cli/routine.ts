/**
 * cli/routine.ts — product Routine surface (replaces standing/watch/schedule/daemon nouns).
 *
 * Requires an initialized format-v1 project (`construct init`).
 */

import { randomUUID } from 'node:crypto';
import { createRoutineService } from '../kernel/services/routine.ts';
import { escapeForTerminal } from '../kernel/render/terminal.ts';
import { now } from './runtime.ts';
import { parseFlags } from './flags.ts';
import { tryOpenProjectStore } from './project-store.ts';

const USAGE =
  'usage: construct routine list\n' +
  '       construct routine create --id=<id> --output="<expected>" [--pin=<host>] [--skill=<name>]\n' +
  '       construct routine run --id=<id>\n' +
  '       construct routine enable --id=<id>\n' +
  '       construct routine disable --id=<id>\n';

export function routine(argv: string[] = [], cwd: string = process.cwd()): number {
  const sub = argv[0];
  if (!sub || sub === '--help' || sub === '-h') {
    process.stdout.write(USAGE);
    return sub ? 0 : 2;
  }
  const { flags } = parseFlags(argv.slice(1));
  const opened = tryOpenProjectStore(cwd);
  if (!opened) {
    process.stderr.write(
      'construct routine requires an initialized project — run construct init first.\n',
    );
    return 1;
  }
  const { store } = opened;
  try {
    const service = createRoutineService(store);
    const at = now();

    if (sub === 'list') {
      const rows = service.list();
      if (rows.length === 0) {
        process.stdout.write('no routines.\n');
        return 0;
      }
      for (const row of rows) {
        const pin =
          row.executionPolicy !== null &&
          typeof row.executionPolicy === 'object' &&
          typeof (row.executionPolicy as { pin?: unknown }).pin === 'string'
            ? String((row.executionPolicy as { pin: string }).pin)
            : '(unpinned)';
        process.stdout.write(
          `${row.enabled ? 'on ' : 'off'}  ${row.id}  ${row.triggerKind}  pin=${pin}  ` +
            `${escapeForTerminal(row.expectedOutput)}\n`,
        );
      }
      return 0;
    }

    if (sub === 'create') {
      const id = (flags.id ?? `routine-${randomUUID().slice(0, 8)}`).trim();
      const output = (flags.output ?? '').trim();
      if (!output) {
        process.stderr.write(USAGE);
        return 2;
      }
      const pin = (flags.pin ?? '').trim() || null;
      const skill = (flags.skill ?? '').trim();
      const created = service.create({
        id,
        triggerKind: 'manual',
        trigger: {},
        workflow: skill ? { skill } : {},
        expectedOutput: output,
        executionPolicy: { mode: 'headless', pin },
        at,
      });
      process.stdout.write(
        `routine ${created.id} created` +
          `${pin ? ` (pin=${pin})` : ' (no pin — set --pin before run)'}\n`,
      );
      return 0;
    }

    const id = (flags.id ?? '').trim();
    if (!id) {
      process.stderr.write(USAGE);
      return 2;
    }

    if (sub === 'enable') {
      service.enable(id, at);
      process.stdout.write(`routine ${id} enabled\n`);
      return 0;
    }
    if (sub === 'disable') {
      service.disable(id, at);
      process.stdout.write(`routine ${id} disabled\n`);
      return 0;
    }
    if (sub === 'run') {
      const result = service.runOnce(id, at);
      process.stdout.write(
        `routine ${id} started run ${result.run.id} via pin=${result.executorPin}\n` +
          `  outcome: ${escapeForTerminal(result.routine.expectedOutput)}\n` +
          '  headless: tasks are queued; claim/submit from the operator control plane\n',
      );
      return 0;
    }

    process.stderr.write(USAGE);
    return 2;
  } catch (error) {
    process.stderr.write(
      `construct routine: ${error instanceof Error ? error.message : String(error)}\n`,
    );
    return 1;
  } finally {
    store.close();
  }
}
