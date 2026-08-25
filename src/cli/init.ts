/**
 * cli/init.ts — the bridge from `npm install -g` to a first outcome.
 *
 * `construct doctor` answers whether the install is sound; nothing before
 * this answered what to do with a sound install. `construct init` adds no
 * capability of its own — it assembles two things that already exist,
 * detection (`hosts/ambient.ts`) and wiring (`cli/wire.ts`), into the one
 * screen a person reads right after the install finishes: which host this
 * process is already running inside, and the four verbs that make up the
 * spine.
 *
 * It writes nothing by itself. Wiring the MCP entry is `construct wire`'s
 * job and stays that command's alone; init only ever prints the command to
 * run it, unless the caller passes `--yes`, in which case init forwards to
 * wire's own `--yes` path rather than writing the file a second way. Either
 * path, the write itself lives in one place.
 */

import { detectAmbientHost } from '../hosts/ambient.ts';
import { wire } from './wire.ts';

const SPINE =
  'The spine: outcome -> work -> show -> inbox -> verdict\n' +
  '  outcome  records what you want, and queues the work\n' +
  '  work     runs the queued work\n' +
  '  show     reads a run\'s deliverables back\n' +
  '  inbox    holds the decisions only you can make\n' +
  '  verdict  says whether a run was right about what it surfaced\n';

/**
 * `construct init [--yes]`.
 *
 * Confirms the ambient host, prints the spine, and offers to wire the MCP
 * entry — with consent required either way. Without `--yes` it names the
 * command to run (`construct wire --yes`) and writes nothing; with `--yes`
 * it calls `wire` with that same flag, so the write still goes through
 * wire's own confirmed path rather than a second one init keeps for itself.
 */
export function init(
  argv: string[] = [],
  cwd: string = process.cwd(),
  env: NodeJS.ProcessEnv = process.env,
): number {
  const confirmed = argv.includes('--yes') || argv.includes('-y');
  const ambient = detectAmbientHost(env);

  process.stdout.write(
    ambient === null
      ? 'No ambient host detected — this process is not running inside a host Construct recognizes.\n'
      : `Detected host: ${ambient.host} (via ${ambient.marker})\n`,
  );

  process.stdout.write(`\n${SPINE}\n`);

  if (confirmed) {
    return wire(['--yes'], cwd, env);
  }

  process.stdout.write(
    'MCP entry not wired. Review it first, then run:  construct wire --yes\n' +
      '(or re-run this command as  construct init --yes  to wire it now)\n',
  );
  return 0;
}
