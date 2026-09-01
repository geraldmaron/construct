/**
 * cli/staff.ts — StaffMember product surface + legacy staffing-gate helpers.
 *
 * StaffMember is identity and mission, never an executor. On an initialized
 * project, create/list/show/pause/retire speak format-v1. The unmet-concern
 * gate (`list` without members / `propose`) remains for legacy store runs.
 */

import { readFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { openDecisions } from '../kernel/store/decisions.ts';
import { readWorkLog } from '../kernel/store/worklog.ts';
import { evaluateProfile, NOT_STAFFED, proposeStaffing } from '../kernel/staffing/profile.ts';
import type { StaffingProposal } from '../kernel/staffing/profile.ts';
import { createStaffService } from '../kernel/services/staff.ts';
import { escapeForTerminal } from '../kernel/render/terminal.ts';
import { now, withStore } from './runtime.ts';
import { parseFlags } from './flags.ts';
import { tryOpenProjectStore } from './project-store.ts';

const USAGE =
  'usage: construct staff list\n' +
  '       construct staff create --name=<name> --title=<title> --mission="<mission>" [--id=<id>]\n' +
  '       construct staff show --id=<id>\n' +
  '       construct staff pause --id=<id>\n' +
  '       construct staff retire --id=<id>\n' +
  '       construct staff unmet [--run=<id>]   (legacy staffing gate)\n' +
  '       construct staff propose --run=<id> --file=<profile.json>\n';

function membersPath(argv: string[], cwd: string): number | null {
  const sub = argv[0];
  const opened = tryOpenProjectStore(cwd);
  if (!opened) return null;
  const { flags } = parseFlags(argv.slice(1));
  const { store } = opened;
  try {
    const staff = createStaffService(store);
    const at = now();

    if (sub === 'list' || sub === undefined) {
      const rows = staff.list();
      if (rows.length === 0) {
        process.stdout.write('no staff members.\n');
        return 0;
      }
      for (const row of rows) {
        process.stdout.write(
          `${row.status.padEnd(8)}  ${row.id}  ${escapeForTerminal(row.name)}  ` +
            `${escapeForTerminal(row.title)}\n`,
        );
      }
      return 0;
    }

    if (sub === 'create') {
      const name = (flags.name ?? '').trim();
      const title = (flags.title ?? '').trim();
      const mission = (flags.mission ?? '').trim();
      if (!name || !title || !mission) {
        process.stderr.write(USAGE);
        return 2;
      }
      const id = (flags.id ?? `staff-${randomUUID().slice(0, 8)}`).trim();
      const member = staff.create({ id, name, title, mission, at });
      process.stdout.write(
        `staff ${member.id} created — identity is not an executor; pin executors on routines/runs.\n`,
      );
      return 0;
    }

    const id = (flags.id ?? '').trim();
    if (!id && (sub === 'show' || sub === 'pause' || sub === 'retire')) {
      process.stderr.write(USAGE);
      return 2;
    }

    if (sub === 'show') {
      const member = staff.get(id);
      if (!member) {
        process.stderr.write(`staff ${id} not found\n`);
        return 1;
      }
      process.stdout.write(
        `${member.id}\n  name: ${escapeForTerminal(member.name)}\n` +
          `  title: ${escapeForTerminal(member.title)}\n` +
          `  mission: ${escapeForTerminal(member.mission)}\n` +
          `  status: ${member.status}\n` +
          `  concerns: ${member.concerns.join(', ') || '(none)'}\n`,
      );
      return 0;
    }
    if (sub === 'pause') {
      staff.pause(id, at);
      process.stdout.write(`staff ${id} paused\n`);
      return 0;
    }
    if (sub === 'retire') {
      staff.retire(id, at);
      process.stdout.write(`staff ${id} retired\n`);
      return 0;
    }

    return null;
  } catch (error) {
    process.stderr.write(
      `construct staff: ${error instanceof Error ? error.message : String(error)}\n`,
    );
    return 1;
  } finally {
    store.close();
  }
}

/**
 * StaffMember CRUD on v1 projects; unmet/propose remain the staffing gate.
 */
export function staff(argv: string[], cwd: string = process.cwd()): number {
  const sub = argv[0];
  if (!sub || sub === '--help' || sub === '-h') {
    process.stdout.write(USAGE);
    return sub ? 0 : 2;
  }

  // Prefer product StaffMember surface when the project is initialized.
  if (['list', 'create', 'show', 'pause', 'retire'].includes(sub)) {
    const handled = membersPath(argv, cwd);
    if (handled !== null) return handled;
    if (sub !== 'list') {
      process.stderr.write(
        'construct staff create/show/pause/retire require construct init first.\n',
      );
      return 1;
    }
    // Bare list without v1 falls through to legacy unmet listing historically
    // named `staff list`.
  }

  const gateSub = sub === 'unmet' ? 'list' : sub;
  const { flags } = parseFlags(argv.slice(1));
  const run = (flags.run ?? '').trim();

  if (gateSub === 'list') {
    return withStore((store) => {
      const unmet = readWorkLog(store, run || undefined).filter((e) => e.action === 'concern-unmet');
      if (unmet.length === 0) {
        process.stdout.write(
          run
            ? `no unmet concerns recorded for ${run} — every concern the run named is in the catalog.\n`
            : 'no unmet concerns recorded — every concern named so far is in the catalog.\n',
        );
        return 0;
      }
      for (const entry of unmet) {
        const d = (entry.detail ?? {}) as Record<string, unknown>;
        process.stdout.write(
          `${String(entry.seq).padStart(4)}  ${entry.run}  proposed "${escapeForTerminal(String(d.proposed ?? ''))}"` +
            `  [${escapeForTerminal(String(d.reason ?? 'reason not recorded'))}]\n` +
            `      because: ${escapeForTerminal(String(d.why || '(the namer gave no reason, which is what refused it)'))}\n`,
        );
      }
      process.stdout.write(
        `\n${String(unmet.length)} unmet concern(s). Draft a profile:\n` +
          '  construct staff propose --run=<id> --file=<profile.json>\n',
      );
      return 0;
    });
  }

  if (gateSub === 'propose') {
    const file = (flags.file ?? '').trim();
    if (run === '' || file === '') {
      process.stderr.write(USAGE);
      return 2;
    }
    let proposal: StaffingProposal;
    try {
      proposal = JSON.parse(readFileSync(file, 'utf8')) as StaffingProposal;
    } catch (error) {
      process.stderr.write(`staff: cannot read a profile from ${file}: ${(error as Error).message}\n`);
      return 1;
    }
    const outcome = evaluateProfile({
      ...proposal,
      rebuttals: proposal.rebuttals ?? [],
      standards: proposal.standards ?? [],
      slots: proposal.slots ?? [],
    });

    if (outcome.refused) {
      process.stderr.write(`refused (${outcome.refused.kind}): ${outcome.refused.reason}\n`);
      if (outcome.refused.domain) {
        process.stderr.write(`  the domain that already carries it: ${outcome.refused.domain}\n`);
      }
      return 1;
    }

    return withStore((store) => {
      const at = now();
      const id = `staffing:${run}:${outcome.admitted.proposed}`;
      if (openDecisions(store).some((d) => d.id === id)) {
        process.stderr.write(
          `staff: "${outcome.admitted.proposed}" is already waiting on a decision for ${run}.\n` +
            '  Read it:  construct inbox\n',
        );
        return 1;
      }
      proposeStaffing(store, { id, run, profile: outcome.admitted, at });
      process.stdout.write(
        `admitted to the gate as "${outcome.admitted.proposed}" (${outcome.admitted.evidenceTier}).\n` +
          `  ${outcome.admitted.tierReason}\n\n` +
          'This staffs nothing yet. Resolve via the inbox:\n' +
          `  construct inbox\n  construct inbox decide ${id} "<your call>"\n`,
      );
      return 0;
    });
  }

  process.stderr.write(USAGE);
  return 2;
}
