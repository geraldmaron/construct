/**
 * cli/staff.ts — staff members: who holds which capabilities and skills.
 */

import { createStaffMember, getStaffMember, listStaffMembers, setAssignments, setStaffStatus } from '../kernel/state/staff.ts';
import { listFlag, stringFlag, type CommandSpec, type ParsedArgs } from './commands.ts';
import { createContext, withProject, type CliContext } from './context.ts';
import { esc, say, writeJson, UsageError, OperationError } from './output.ts';

const group = 'Staff';
const assignmentFlags = [
  { name: 'capability', gloss: 'a capability this member holds (repeatable)', takesValue: true, repeatable: true },
  { name: 'skill', gloss: 'a skill this member uses (repeatable)', takesValue: true, repeatable: true },
] as const;

export const STAFF_SPECS: readonly CommandSpec[] = [
  { path: ['staff', 'list'], gloss: 'every staff member and what they hold', group, positionals: [], flags: [], readOnly: true },
  { path: ['staff', 'show'], gloss: 'one staff member', group, positionals: ['<id>'], flags: [], readOnly: true },
  { path: ['staff', 'add'], gloss: 'add a staff member with a title, a mission, and assignments', group, positionals: ['<id>'], flags: [{ name: 'name', gloss: 'their name', takesValue: true }, { name: 'title', gloss: 'their title', takesValue: true }, { name: 'mission', gloss: 'what they are for, in a sentence', takesValue: true }, ...assignmentFlags], readOnly: false },
  { path: ['staff', 'update'], gloss: 'replace a member’s capability and skill assignments', group, positionals: ['<id>'], flags: [...assignmentFlags], readOnly: false },
  { path: ['staff', 'pause'], gloss: 'pause a member; nothing is assigned to them until resumed', group, positionals: ['<id>'], flags: [{ name: 'resume', gloss: 'make them active again', takesValue: false }], readOnly: false },
  { path: ['staff', 'retire'], gloss: 'retire a member; their history stays', group, positionals: ['<id>'], flags: [], readOnly: false },
];

export function staffCommand(sub: string, args: ParsedArgs, ctx: CliContext = createContext()): number {
  return withProject(ctx, ({ store }) => {
    const at = ctx.now();
    const show = (m: ReturnType<typeof getStaffMember>): void => {
      if (!m) return;
      say(`${esc(m.id)}  ${m.status}  ${esc(m.name)}, ${esc(m.title)}: ${esc(m.mission)}`);
      say(`  capabilities: ${m.capabilities.map(esc).join(', ') || 'none'}; skills: ${m.skillIds.map(esc).join(', ') || 'none'}`);
    };
    switch (sub) {
      case 'list': {
        const rows = listStaffMembers(store);
        if (args.json) writeJson(rows);
        else if (rows.length === 0) say('no staff members; `construct staff add <id> --name ... --title ... --mission ...` adds one');
        else for (const m of rows) show(m);
        return 0;
      }
      case 'show': {
        const m = getStaffMember(store, args.positionals[0]!);
        if (!m) throw new OperationError(`no staff member ${args.positionals[0]!}`);
        if (args.json) writeJson(m);
        else show(m);
        return 0;
      }
      case 'add': {
        const id = args.positionals[0]!;
        const name = stringFlag(args, 'name');
        const title = stringFlag(args, 'title');
        const mission = stringFlag(args, 'mission');
        if (!name || !title || !mission) throw new UsageError('--name, --title, and --mission are all needed');
        if (getStaffMember(store, id)) throw new OperationError(`staff member ${id} already exists`, '`construct staff update` changes assignments.');
        const m = createStaffMember(store, { id, name, title, mission, capabilities: listFlag(args, 'capability'), skillIds: listFlag(args, 'skill'), at });
        if (args.json) writeJson(m);
        else show(m);
        return 0;
      }
      case 'update': {
        const m = setAssignments(store, args.positionals[0]!, listFlag(args, 'capability'), listFlag(args, 'skill'), at);
        if (args.json) writeJson(m);
        else show(m);
        return 0;
      }
      case 'pause': {
        const m = setStaffStatus(store, args.positionals[0]!, args.flags.resume === true ? 'active' : 'paused', at);
        if (args.json) writeJson(m);
        else say(`${esc(m.id)} is ${m.status}`);
        return 0;
      }
      case 'retire': {
        const m = setStaffStatus(store, args.positionals[0]!, 'retired', at);
        if (args.json) writeJson(m);
        else say(`${esc(m.id)} retired`);
        return 0;
      }
      default:
        throw new UsageError(`staff has no subcommand "${sub}"`);
    }
  });
}
