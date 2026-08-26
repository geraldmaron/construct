/**
 * cli/init.ts — the bridge from `npm install -g` to a first outcome.
 *
 * `construct doctor` answers whether the install is sound; nothing before
 * this answered what to do with a sound install. `construct init` assembles
 * detection (`hosts/ambient.ts`), wiring (`cli/wire.ts`), and the portable
 * method skills (`cli/skills.ts`) into the one screen a person reads right
 * after the install finishes: which host this process is already running
 * inside, the spine, and the skills that host should hold.
 *
 * It writes nothing by itself unless `--yes`. Wiring the MCP entry is
 * `construct wire`'s job; planting method skills is `construct skills
 * install`'s. Init only ever forwards to those commands, so each write lives
 * in one place. Job-title lens packs are not planted: those roles were
 * measured and withdrawn. The method skills are the ones that travel.
 */

import { detectAmbientHost } from '../hosts/ambient.ts';
import { resolveHostSkillsDir, SKILLS_HOST_NAMES, type SkillsHostName } from '../kernel/paths.ts';
import { skills } from './skills.ts';
import { wire } from './wire.ts';

const SPINE =
  'Talk in this host. Ordinary language is enough — this session names the concerns.\n' +
  'The spine: outcome -> work -> show -> inbox -> verdict\n' +
  '  outcome  this session records via MCP record_outcome with namings\n' +
  '  work     this session claims via construct serve (claim_task)\n' +
  '  show     reads a run\'s deliverables back\n' +
  '  inbox    holds the decisions only you can make\n' +
  '  verdict  says whether a run was right about what it surfaced\n';

function plantMethodSkills(host: SkillsHostName, env: NodeJS.ProcessEnv): number {
  const dir = resolveHostSkillsDir(host, env);
  return skills(['install', '--all', `--dir=${dir}`]);
}

/**
 * `construct init [--yes]`.
 *
 * Confirms the ambient host, prints the spine, offers to plant the portable
 * method skills into that host's skills directory, and offers to wire the
 * MCP entry — with consent required either way.
 */
export function init(
  argv: string[] = [],
  cwd: string = process.cwd(),
  env: NodeJS.ProcessEnv = process.env,
): number {
  const confirmed = argv.includes('--yes') || argv.includes('-y');
  const ambient = detectAmbientHost(env);
  const skillsHost =
    ambient !== null && (SKILLS_HOST_NAMES as readonly string[]).includes(ambient.host)
      ? (ambient.host as SkillsHostName)
      : null;

  process.stdout.write(
    ambient === null
      ? 'No ambient host detected — this process is not running inside a host Construct recognizes.\n'
      : `Detected host: ${ambient.host} (via ${ambient.marker})\n`,
  );

  process.stdout.write(`\n${SPINE}\n`);

  if (skillsHost !== null) {
    process.stdout.write(
      `Method skills plant into this host with:  construct skills install --all --host=${skillsHost}\n` +
        '(investigative-research, decision-framing, intake, and the rest — not job-title personas)\n',
    );
  }

  if (confirmed) {
    if (skillsHost !== null) {
      const planted = plantMethodSkills(skillsHost, env);
      if (planted !== 0) return planted;
    }
    return wire(['--yes'], cwd, env);
  }

  process.stdout.write(
    'MCP entry not wired. Review it first, then run:  construct wire --yes\n' +
      '(or re-run this command as  construct init --yes  to plant skills and wire it now)\n',
  );
  return 0;
}
