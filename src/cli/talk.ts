/**
 * cli/talk.ts — first-run: ordinary language in, no verb lesson.
 *
 * Bare `construct` and a sentence that is not a verb start here. The host
 * names and records. Two surfaces: this conversation continues, or one
 * inbox card. talk() plants the host instruction and creates no run — a
 * hollow record would steal the next work. A packet without a seat is a
 * miss.
 */

import { detectAmbientHost } from '../hosts/ambient.ts';
import { plantFirstRunInstruction, type InstructionPlant } from '../hosts/first-run-instruction.ts';
import { sessionNamingPacket, type AmbientDetection } from '../hosts/session.ts';
import { resolveHostSkillsDir, SKILLS_HOST_NAMES, type SkillsHostName } from '../kernel/paths.ts';
import { plantShippedSkills, type PlantReport } from './skills.ts';
import { packageVersion } from './runtime.ts';

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

function instructionLine(plant: InstructionPlant | undefined): string {
  if (plant === undefined) return '';
  if (plant.error !== undefined) {
    return `First-run instruction did not plant: ${plant.error}\n`;
  }
  return plant.written
    ? `First-run instruction planted in ${plant.dir}.\n`
    : `First-run instruction already in ${plant.dir}.\n`;
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

/** In-session first-run: the host names and records; this process does not staff. */
export function sessionTalkPacket(
  session: AmbientDetection,
  words: string | undefined,
  plant: PlantReport,
  instruction?: InstructionPlant,
): string {
  return sessionNamingPacket(session, words) + plantLine(plant) + instructionLine(instruction);
}

function plantInstructionForSession(
  session: AmbientDetection,
  env: NodeJS.ProcessEnv,
): InstructionPlant | undefined {
  if (!(SKILLS_HOST_NAMES as readonly string[]).includes(session.host)) return undefined;
  const dir = resolveHostSkillsDir(session.host as SkillsHostName, env);
  return plantFirstRunInstruction(dir, packageVersion());
}

/**
 * First-run talk. In a host session this prints the naming packet and plants
 * the host instruction (or says they did not). With no host it bounces: no run.
 */
export function talk(argv: string[] = [], env: NodeJS.ProcessEnv = process.env): number {
  const words = argv.join(' ').trim();
  const session = detectAmbientHost(env);
  if (session === null) {
    process.stdout.write(hostlessTalkBounce(words.length > 0 ? words : undefined));
    return 0;
  }
  const plant = plantForSession(session, env);
  const instruction = plantInstructionForSession(session, env);
  process.stdout.write(
    sessionTalkPacket(session, words.length > 0 ? words : undefined, plant, instruction),
  );
  return 0;
}
