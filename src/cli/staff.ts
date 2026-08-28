/**
 * cli/staff.ts — the surface on the staffing gate.
 *
 * A run that meets a concern the catalog cannot carry records it and moves on,
 * which is right — routing must not widen itself as a side effect of one
 * outcome. What was missing is the other half: the record sat in the work log
 * with no way to act on it. No judgement lives here; `evaluateProfile`
 * decides, and an admitted profile becomes an inbox decision whose default
 * position is NOT STAFFED.
 */

import { readFileSync } from 'node:fs';
import { openDecisions } from '../kernel/store/decisions.ts';
import { readWorkLog } from '../kernel/store/worklog.ts';
import { evaluateProfile, NOT_STAFFED, proposeStaffing } from '../kernel/staffing/profile.ts';
import type { StaffingProposal } from '../kernel/staffing/profile.ts';
import { escapeForTerminal } from '../kernel/render/terminal.ts';
import { now, withStore } from './runtime.ts';
import { parseFlags } from './flags.ts';

const STAFF_USAGE =
  'usage: construct staff list [--run=<id>]\n' +
  '       construct staff propose --run=<id> --file=<profile.json>\n';

/**
 * The surface on the staffing gate.
 *
 * A run that meets a concern the catalog cannot carry records it and moves on,
 * which is the right behavior — routing must not widen itself as a side effect
 * of one outcome. What was missing is the other half: the record sat in the work
 * log with no way to act on it, so staffing the concern meant writing code. This
 * lists what a run could not carry, and puts a drafted profile through the gate
 * that already exists.
 *
 * No judgement lives here. `evaluateProfile` decides, its refusal is printed in
 * its own words rather than summarized, and an admitted profile becomes an inbox
 * decision whose default position is NOT STAFFED. Nothing on this path admits a
 * domain; a person does, by resolving that decision.
 */
export function staff(argv: string[]): number {
  const sub = argv[0];
  const { flags } = parseFlags(argv.slice(1));
  const run = (flags.run ?? '').trim();

  if (sub === 'list') {
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
        `\n${String(unmet.length)} unmet concern(s). A concern is staffed by drafting a profile and\n` +
          'putting it through the gate:  construct staff propose --run=<id> --file=<profile.json>\n' +
          'The profile must name its slots, rebut every domain that claims its words, and cite the\n' +
          'practice its method descends from (or say why none could be named).\n',
      );
      return 0;
    });
  }

  if (sub === 'propose') {
    const file = (flags.file ?? '').trim();
    if (run === '' || file === '') {
      process.stderr.write(STAFF_USAGE);
      return 2;
    }
    let proposal: StaffingProposal;
    try {
      proposal = JSON.parse(readFileSync(file, 'utf8')) as StaffingProposal;
    } catch (error) {
      process.stderr.write(`staff: cannot read a profile from ${file}: ${(error as Error).message}\n`);
      return 1;
    }
    // A hand-written profile that omits a list would crash the gate on a
    // property access, and a stack trace is a worse answer than the refusal the
    // gate was going to give anyway.
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
          'This staffs nothing yet. The catalog changes only when you resolve the decision, and\n' +
          `its default position is: ${NOT_STAFFED}.\n` +
          `  construct inbox\n  construct decide ${id} "<your call>"\n`,
      );
      return 0;
    });
  }

  process.stderr.write(STAFF_USAGE);
  return 2;
}
