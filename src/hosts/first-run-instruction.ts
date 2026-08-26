/**
 * hosts/first-run-instruction.ts — standing instruction this session plants
 * so first-run does not die on a talk packet.
 *
 * Not a portable method skill. It is Construct-bound: the stranger already
 * spoke; this session names the concerns and records them so seats appear.
 * talk() plants the file. talk() does not create a run.
 */

import { mkdirSync, writeFileSync, existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { DOMAINS } from '../kernel/implication/domains.ts';

export const FIRST_RUN_INSTRUCTION_DIR = 'first-run';
export const FIRST_RUN_INSTRUCTION_FILE = 'SKILL.md';

/** Catalog lines a host can name from, without a stranger typing a verb. */
export function catalogListing(): string {
  return DOMAINS.map((d) => `- ${d.domain}: ${d.concern}`).join('\n');
}

/** The instruction bytes planted into a host skills directory. */
export function firstRunInstructionText(version: string): string {
  return [
    '---',
    'name: first-run',
    'description: >-',
    '  When the user states what they want in ordinary language, name the',
    '  implicated catalog concerns and record them in this session so staff',
    '  appears. Stopping after a talk packet is a miss. Do not ask the user',
    '  to type a command. Empty or engineering-only staff is a miss.',
    'license: Apache-2.0',
    'metadata:',
    `  version: ${version}`,
    '  source: geraldmaron/construct',
    '---',
    '',
    '# First run',
    '',
    'The stranger stays in this conversation. Beat two is still talk.',
    '',
    'You are the host. They already spoke. You name the concerns. You record',
    'them in this session. Seats appear. A packet is not a seat.',
    '',
    'Do not treat the talk line as the recorder. The talk line plants this',
    'file and creates no run. You finish the turn.',
    '',
    'Do not ask them to type a command. If they have to type a verb, first',
    'ten seconds are undone.',
    '',
    '## Mechanism',
    '',
    '1. Read the words they said.',
    '2. Name every catalog concern those words implicate, each with a reason',
    '   in their words. The catalog is below. Name only those ids.',
    '3. Record the outcome and those namings through the recording tool',
    '   already on this session. An empty namings list means this implicates',
    '   nothing — say that; do not invent engineering.',
    '4. Staff is the lenses those domains equip. Empty staff or',
    '   engineering-only staff after you named real concerns is a miss.',
    '5. Reply in this conversation with what was seated. Inbox only if a',
    '   call is actually theirs.',
    '',
    'One surface for every stranger. A role is not a capability.',
    '',
    '## Catalog',
    '',
    catalogListing(),
    '',
  ].join('\n');
}

export interface InstructionPlant {
  readonly dir: string;
  readonly written: boolean;
  readonly error?: string;
}

/** Write the first-run instruction into a host skills directory. */
export function plantFirstRunInstruction(dir: string, version: string): InstructionPlant {
  const target = join(dir, FIRST_RUN_INSTRUCTION_DIR, FIRST_RUN_INSTRUCTION_FILE);
  const text = firstRunInstructionText(version);
  try {
    const existing = existsSync(target) ? readFileSync(target, 'utf8') : null;
    if (existing === text) return { dir, written: false };
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, text);
    return { dir, written: true };
  } catch (error) {
    return {
      dir,
      written: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}
