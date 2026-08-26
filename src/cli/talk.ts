/**
 * cli/talk.ts — first-run: ordinary language in, no verb lesson.
 *
 * Bare `construct` and a sentence that is not a verb start here. The host
 * infers. Two surfaces: this conversation continues, or one inbox card.
 * First-run must not look like Construct. No run is created from this
 * path — a hollow record would steal the next work.
 */

import { detectAmbientHost } from '../hosts/ambient.ts';
import { sessionNamingPacket, type AmbientDetection } from '../hosts/session.ts';
import { resolveHostSkillsDir, SKILLS_HOST_NAMES, type SkillsHostName } from '../kernel/paths.ts';
import { plantShippedSkills, type PlantReport } from './skills.ts';

const HOSTS_THEY_HAVE =
  'Talk in the host you already use — Cursor, Claude Code, Codex, OpenCode, or IBM Bob.\n';

/**
 * What a host-less first-run line prints. Fail-closed: no run, no empty
 * staffed-looking record, no `--host` lesson, no verb catalog.
 */
export function hostlessTalkBounce(words?: string): string {
  return (
    (words !== undefined && words.length > 0 ? `Words just heard: ${JSON.stringify(words)}\n` : '') +
    HOSTS_THEY_HAVE +
    'This session names the concerns. Nothing was recorded here: a line with no host does not staff a run.\n' +
    'Method skills were not planted — this line is not inside a host.\n'
  );
}

function plantLine(report: PlantReport): string {
  if (!report.attempted) {
    return `Method skills were not planted — ${report.reason ?? 'this line is not inside a host'}.\n`;
  }
  if (report.error !== undefined) {
    return `Method skills did not plant: ${report.error}\n`;
  }
  if (report.written > 0) {
    return `Method skills planted in ${report.dir} (${String(report.written)} written).\n`;
  }
  return `Method skills already in ${report.dir}.\n`;
}

function plantForSession(session: AmbientDetection, env: NodeJS.ProcessEnv): PlantReport {
  if (!(SKILLS_HOST_NAMES as readonly string[]).includes(session.host)) {
    return {
      attempted: true,
      planted: false,
      written: 0,
      already: 0,
      error: `${session.host} has no skills directory Construct knows`,
    };
  }
  const dir = resolveHostSkillsDir(session.host as SkillsHostName, env);
  return plantShippedSkills(dir);
}

/** In-session first-run: the host infers; this process does not staff. */
export function sessionTalkPacket(
  session: AmbientDetection,
  words: string | undefined,
  plant: PlantReport,
): string {
  return sessionNamingPacket(session, words) + plantLine(plant);
}

/**
 * First-run talk. In a host session this prints the naming packet and plants
 * method skills (or says they did not). With no host it bounces: no run.
 */
export function talk(argv: string[] = [], env: NodeJS.ProcessEnv = process.env): number {
  const words = argv.join(' ').trim();
  const session = detectAmbientHost(env);
  if (session === null) {
    process.stdout.write(hostlessTalkBounce(words.length > 0 ? words : undefined));
    return 0;
  }
  const plant = plantForSession(session, env);
  process.stdout.write(sessionTalkPacket(session, words.length > 0 ? words : undefined, plant));
  return 0;
}
