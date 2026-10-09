/**
 * cli/doctor.ts — is this project actually healthy? Each check names what it
 * looked at and what it found. A missing or broken project is never healthy.
 */

import { existsSync, accessSync, constants, realpathSync } from 'node:fs';
import { isAbsolute, join } from 'node:path';
import { detectAmbientHost } from '../hosts/ambient.ts';
import { detectLegacyHomeState, detectLegacyProjectFiles } from '../kernel/project/legacy.ts';
import { readProjectFiles } from '../kernel/project/initialize.ts';
import { constitutionCompleteness } from '../kernel/project/constitution.ts';
import { NoProjectError } from '../kernel/project/discover.ts';
import { projectDbPath, projectLayout, projectStateDir } from '../kernel/project/layout.ts';
import { openStateStore } from '../kernel/state/open.ts';
import { STATE_FORMAT_VERSION } from '../kernel/state/format.ts';
import { getProfile } from '../kernel/state/profile.ts';
import { storeProjectId } from '../kernel/state/identity.ts';
import { listSources } from '../kernel/state/sources.ts';
import { listShippedSkills, readShippedSkill, skillState, OPERATIONAL_SKILL } from '../kernel/skills/bundle.ts';
import { createSkillRegistry } from '../kernel/registry/skill-registry.ts';
import { createWorkflowRegistry } from '../kernel/registry/workflow-registry.ts';
import { lockStatus } from '../kernel/registry/lockfile.ts';
import { resolveHostConfigDirs, resolveHostSkillsDir, SKILLS_HOST_NAMES, type SkillsHostName } from '../kernel/paths.ts';
import { inspectWiring, launchOf } from '../hosts/wiring/wire.ts';
import { HOOK_SETTINGS_PATH, inspectHooks } from '../hosts/wiring/hooks.ts';
import { LAUNCHER, normalizeClient, projectSkillsDirFor, WIRABLE_CLIENTS, type WirableClient } from '../hosts/wiring/clients.ts';
import { findOnPath, presentHosts } from '../hosts/presence.ts';
import type { CommandSpec, ParsedArgs } from './commands.ts';
import { bindProject, createContext, gitRootOf, resolveRepository, WorktreeBindingError, type CliContext, type Lane } from './context.ts';
import { esc, say, shellWord, writeJson } from './output.ts';

export const DOCTOR_SPEC: CommandSpec = {
  path: ['doctor'],
  gloss: 'check the project’s files, state, host binding, skills, and package completeness',
  group: 'Inspect',
  positionals: [],
  flags: [],
  readOnly: true,
};

interface Check {
  readonly name: string;
  readonly ok: boolean;
  readonly detail: string;
}

const NODE_FLOOR = [22, 18] as const;

function sameFile(a: string, b: string): boolean {
  try {
    return realpathSync(a) === realpathSync(b);
  } catch {
    return false;
  }
}

/** Hosts usually started from the desktop rather than from this shell, so their PATH may differ from the one checked here. */
const DESKTOP_HOSTS: ReadonlySet<WirableClient> = new Set(['cursor', 'vscode', 'bob']);

/** Can the command this host's file starts be found and run from here? */
function hostLaunchCheck(client: WirableClient, root: string, env: NodeJS.ProcessEnv): Check {
  const name = `host-launch:${client}`;
  const shellNote = DESKTOP_HOSTS.has(client) ? ' (this checks this shell\'s PATH; a host started from the Dock may see another)' : '';
  const repair = `\`construct init --client=${client}\` rewrites it`;
  const launch = launchOf(client, root);
  if (!launch) return { name, ok: false, detail: `the ${client} entry names no command; ${repair}` };
  const install = (path: string) => (sameFile(path, LAUNCHER) ? ', the same install as this doctor' : `, a different install than this doctor (${LAUNCHER}); versions may differ`);
  if (launch.command === 'construct') {
    const found = findOnPath('construct', env);
    return found
      ? { name, ok: true, detail: `starts ${found}${install(found)}${shellNote}` }
      : { name, ok: false, detail: `\`construct\` is not on PATH here, so ${client} cannot start the server; install it with npm install -g @geraldmaron/construct@alpha or as a project dependency${shellNote}` };
  }
  if (launch.command === 'npx') {
    const npx = findOnPath('npx', env);
    const local = join(root, 'node_modules', '.bin', 'construct');
    if (!npx) return { name, ok: false, detail: `\`npx\` is not on PATH here, so ${client} cannot start the project's construct${shellNote}` };
    if (!existsSync(local)) return { name, ok: false, detail: `${local} does not exist, so npx --no-install construct has nothing to start; install @geraldmaron/construct as a project dependency, or ${repair} to start construct from PATH${shellNote}` };
    return { name, ok: true, detail: `starts ${local} through ${npx}${install(local)}${shellNote}` };
  }
  const command = isAbsolute(launch.command) ? (existsSync(launch.command) ? launch.command : null) : findOnPath(launch.command, env);
  if (!command) return { name, ok: false, detail: `${launch.command} cannot be found here, so ${client} cannot start the server; ${repair}${shellNote}` };
  const script = launch.args.find((a) => a.endsWith('construct.mjs'));
  if (script && isAbsolute(script) && !existsSync(script)) return { name, ok: false, detail: `${script} does not exist, so ${client} cannot start the server; ${repair}${shellNote}` };
  return { name, ok: true, detail: `starts ${command}${script ? ` ${script}${install(script)}` : ''}${shellNote}` };
}

/**
 * The operational skill in each project skills directory a wired host reads,
 * one check per directory. Init plants it there, so re-running init is the
 * fix, except for a changed copy, which only an explicit replace overwrites.
 */
function projectSkillChecks(root: string, wired: readonly WirableClient[]): Check[] {
  const skill = readShippedSkill(OPERATIONAL_SKILL);
  if (!skill) return [];
  const byDir = new Map<string, WirableClient[]>();
  for (const client of wired) {
    const dir = join(root, projectSkillsDirFor(client, wired));
    byDir.set(dir, [...(byDir.get(dir) ?? []), client]);
  }
  return [...byDir].map(([dir, clients]) => {
    const state = skillState(skill, dir);
    const version = skill.version ?? 'the shipped copy';
    const next = state.state === 'current'
      ? ''
      : state.state === 'diverged'
        ? `; \`construct skill install ${OPERATIONAL_SKILL} --force --dir=${shellWord(dir)}\` replaces it with ${version}, and any edits in it are lost`
        : `; \`construct init --client=${clients[0]!}\` plants ${version}`;
    return { name: 'operational-skill', ok: state.state === 'current', detail: `${state.state} in ${dir} (read by ${clients.join(', ')}): ${state.why}${next}` };
  });
}

function nodeCheck(): Check {
  const [major, minor] = process.versions.node.split('.').map(Number);
  const ok = major! > NODE_FLOOR[0] || (major === NODE_FLOOR[0] && minor! >= NODE_FLOOR[1]);
  return { name: 'node', ok, detail: `v${process.versions.node}${ok ? '' : ` is below the ${NODE_FLOOR.join('.')} floor`}` };
}

export async function doctor(args: ParsedArgs, ctx: CliContext = createContext()): Promise<number> {
  const checks: Check[] = [nodeCheck()];
  const floor = gitRootOf(ctx.cwd) ?? ctx.cwd;
  let root: string | null = null;
  let lane: Lane | null = null;
  let bindProblem: string | null = null;
  try {
    const bound = bindProject(ctx);
    root = bound.root;
    lane = bound.lane;
  } catch (error) {
    if (error instanceof WorktreeBindingError) bindProblem = `${error.message}; ${error.next ?? ''}`.trim();
    else if (!(error instanceof NoProjectError)) throw error;
  }

  if (root === null) {
    checks.push({ name: 'project', ok: false, detail: bindProblem ?? `no Construct project from ${ctx.cwd} up to ${floor}; run \`construct init\`` });
  } else {
    checks.push({ name: 'project', ok: true, detail: lane ? `${root} (this session works in the worktree ${lane.checkout}${lane.branch ? ` on ${lane.branch}` : ''}; it shares that project's store)` : root });
    const layout = projectLayout(root);
    if (lane) {
      const laneStore = projectDbPath(lane.root);
      if (existsSync(laneStore) && !sameFile(laneStore, layout.dbPath)) {
        checks.push({ name: 'worktree-store', ok: false, detail: `${laneStore} is a store inside this worktree that Construct never opens; every worktree uses ${layout.dbPath}. Remove it once its contents are not needed.` });
      }
    }
    const legacy = detectLegacyProjectFiles(root);
    if (legacy.length > 0) {
      checks.push({ name: 'legacy-files', ok: false, detail: `${legacy.map((t) => t.path).join(', ')}: earlier alpha files; run \`construct reset\`` });
    }
    try {
      const files = readProjectFiles(root);
      const missing = (['config', 'constitution', 'sources', 'lock'] as const).filter((k) => files[k] === null);
      const orphaned = lane !== null && files.config === null;
      checks.push({
        name: 'files',
        ok: missing.length === 0,
        detail: missing.length === 0
          ? 'project, constitution, sources, and lock files validate'
          : orphaned
            ? `missing ${missing.join(', ')}: the main checkout has no .construct/project.json (its current commit may not carry the project files), so this worktree uses the store at ${layout.dbPath} without the project's configuration. Restore the files in ${root}, for example by checking out the branch that has them; \`construct init\` there first would give the project a new id`
            : `missing ${missing.join(', ')}`,
      });
      if (files.constitution) {
        const c = constitutionCompleteness(files.constitution);
        checks.push({ name: 'constitution', ok: true, detail: c.complete ? 'complete' : `incomplete: ${c.missing.join(', ')} not yet answered` });
      }
      if (files.lock) {
        const skills = createSkillRegistry({ projectDir: layout.skillsDir });
        const workflows = createWorkflowRegistry({ projectDir: layout.workflowsDir });
        const problems = [...skills.problems(), ...workflows.problems()];
        const rows = lockStatus(files.lock, skills.list(), workflows.list());
        const broken = rows.filter((r) => r.state === 'diverged' || r.state === 'blocked' || r.state === 'missing');
        const behind = rows.filter((r) => r.state === 'outdated' || r.state === 'unlocked');
        const detail = [
          `${String(rows.filter((r) => r.state === 'current').length)}/${String(rows.length)} current`,
          broken.length ? `${broken.map((r) => `${r.id} ${r.state}`).join(', ')}` : '',
          behind.length ? `${String(behind.length)} outdated or unlocked (\`construct skill update\` locks them)` : '',
          problems.length ? `${String(problems.length)} bundle(s) failed to load: ${problems.map((p) => p.message).join('; ')}` : '',
        ].filter(Boolean).join('; ');
        checks.push({ name: 'registry', ok: broken.length === 0 && problems.length === 0, detail });
      }
    } catch (error) {
      checks.push({ name: 'files', ok: false, detail: (error as Error).message });
    }
    if (!existsSync(layout.dbPath)) {
      checks.push({ name: 'state', ok: false, detail: `${layout.dbPath} does not exist; run \`construct init\`${lane ? ` in ${root}` : ''}` });
    } else {
      try {
        accessSync(layout.dbPath, constants.R_OK | constants.W_OK);
        const store = openStateStore(layout.dbPath, { readOnly: true });
        try {
          const profile = getProfile(store);
          checks.push({ name: 'state', ok: true, detail: `format ${STATE_FORMAT_VERSION} at ${layout.dbPath}; onboarding ${profile?.onboardingState ?? 'incomplete'}` });
          const stamped = storeProjectId(store);
          let configId: string | null = null;
          try {
            configId = readProjectFiles(root).config?.id ?? null;
          } catch {
            // The files check above already reports an unreadable project file.
          }
          if (stamped !== null && configId !== null) {
            checks.push({
              name: 'state-project',
              ok: stamped === configId,
              detail: stamped === configId
                ? `the store belongs to project ${stamped}`
                : `the store belongs to project ${stamped}, but .construct/project.json names ${configId}; one store is one project`,
            });
          }
          checks.push({
            name: 'state-concurrency',
            ok: store.journalMode === 'wal',
            detail: store.journalMode === 'wal'
              ? 'WAL journal: concurrent sessions read while one writes'
              : `${store.journalMode} journal: concurrent sessions queue for the file. The next command that writes switches it to WAL; if this persists, the filesystem refused WAL (a network or synced folder is the usual cause)`,
          });
          // Unreachable is a state Construct reports, not a broken install, so this never fails health; it does say it.
          const active = listSources(store, { status: 'active' });
          const unreachable = active.filter((x) => x.reachability === 'unreachable').map((x) => x.id);
          const neverRead = active.filter((x) => !x.lastSnapshotId && x.reachability !== 'unreachable').map((x) => x.id);
          const parts = [`${String(active.length)} declared`];
          if (unreachable.length) parts.push(`unreachable: ${unreachable.join(', ')}`);
          if (neverRead.length) parts.push(`never read: ${neverRead.join(', ')}`);
          const fixtures = ctx.env.CONSTRUCT_JIRA_FIXTURES;
          if (fixtures) parts.push(`jira sources read test fixtures from ${fixtures} (CONSTRUCT_JIRA_FIXTURES), not a live tracker`);
          checks.push({ name: 'sources', ok: true, detail: parts.join('; ') + (unreachable.length || neverRead.length ? '; work that needs them will be blocked or flagged' : '') });
        } finally {
          store.close();
        }
      } catch (error) {
        checks.push({ name: 'state', ok: false, detail: (error as Error).message });
      }
    }
  }

  const ambient = detectAmbientHost(ctx.env);
  let wiredClients: WirableClient[] = [];
  if (root !== null) {
    const wired = WIRABLE_CLIENTS.map((c) => inspectWiring(c, root)).filter((w) => w.status !== 'absent');
    wiredClients = wired.map((w) => w.client);
    if (wired.some((w) => w.client === 'claude-code')) {
      // A session reads the machine-local settings of the checkout it works in; a worktree has its own, which init never writes.
      const checkout = lane?.checkout ?? resolveRepository(root)?.checkout ?? root;
      const h = inspectHooks(lane?.root ?? root, { checkout, stateDir: projectStateDir(root) });
      const fix = '`construct init --client=claude-code`';
      const inLane = lane ? `; \`construct init\` writes the hooks only in the main checkout, ${root}, not in this worktree's own ${HOOK_SETTINGS_PATH}` : '';
      // Hooks are what make reporting reads and checking answers automatic; their absence is worth saying, not failing. Stale or broken hooks fail.
      const detail = h.status === 'installed' ? h.detail
        : h.status === 'stale' ? `${h.detail}${inLane}`
          : h.status === 'broken' ? `${h.detail}; fix the file${lane ? inLane : `, then ${fix} puts them back`}`
            : lane ? `${h.detail}${inLane}` : `${h.detail}; ${fix} adds them`;
      checks.push({ name: 'host-hooks', ok: h.status !== 'broken' && h.status !== 'stale', detail });
    }
    if (wired.length === 0) {
      // A project no host is wired to is one no agent session can reach, so it is not healthy.
      const found = presentHosts(ctx.env, resolveHostConfigDirs(ctx.env));
      const where = found.length > 0 ? `found ${found.map((f) => f.client).join(', ')}` : 'no agent host found on this machine';
      checks.push({ name: 'host-wiring', ok: false, detail: `no host wired, so no agent session can reach Construct; ${where}; \`construct init --client=<host>\` wires one` });
    } else {
      checks.push({ name: 'host-wiring', ok: wired.every((w) => w.status === 'installed'), detail: wired.map((w) => `${w.client} ${w.status}${w.status === 'installed' ? '' : ` (${w.detail})`}`).join(', ') });
    }
    for (const w of wired) checks.push(hostLaunchCheck(w.client, root, ctx.env));
    checks.push(...projectSkillChecks(root, wiredClients));
  }
  if (ambient) {
    const inside = normalizeClient(ambient.host);
    const unwired = root !== null && inside !== 'unknown' && !wiredClients.includes(inside)
      ? `; ${inside} is not wired in this project, so a session here cannot reach Construct; \`construct init --client=${inside}\` wires it`
      : '';
    checks.push({ name: 'host', ok: true, detail: `inside ${ambient.host} (${ambient.marker})${unwired}` });
    if ((SKILLS_HOST_NAMES as readonly string[]).includes(ambient.host)) {
      // A personal copy loads in every repository the host opens, whichever Construct each one runs.
      const dir = resolveHostSkillsDir(ambient.host as SkillsHostName, ctx.env);
      const skill = readShippedSkill(OPERATIONAL_SKILL);
      const state = skill ? skillState(skill, dir).state : 'absent';
      if (state === 'outdated' || state === 'diverged') {
        const copy = state === 'outdated' ? `an older personal copy at ${dir}` : `a personal copy at ${dir} that differs from this release`;
        checks.push({ name: 'personal-skill', ok: true, detail: `${copy} loads in every repository; \`construct skill remove ${OPERATIONAL_SKILL} --client=${ambient.host} --confirm\` removes it` });
      }
    }
  } else {
    checks.push({ name: 'host', ok: true, detail: 'no agent host detected in this shell; that is fine for setup and inspection' });
  }

  const shipped = listShippedSkills();
  checks.push({ name: 'package', ok: shipped.some((s) => s.name === OPERATIONAL_SKILL), detail: `${String(shipped.length)} skill(s) shipped${shipped.some((s) => s.name === OPERATIONAL_SKILL) ? '' : `; the ${OPERATIONAL_SKILL} skill is missing from this install`}` });

  const oldHome = detectLegacyHomeState(ctx.paths);
  if (oldHome.length > 0) {
    checks.push({ name: 'legacy-home-state', ok: true, detail: `${oldHome.map((t) => t.path).join(', ')}: earlier alpha data this version never reads; \`construct reset\` can name it for removal` });
  }

  const failed = checks.filter((c) => !c.ok).length;
  if (args.json) {
    writeJson({ healthy: failed === 0, checks });
    return failed === 0 ? 0 : 1;
  }
  for (const c of checks) say(`${c.ok ? 'ok  ' : 'FAIL'} ${c.name}: ${esc(c.detail)}`);
  say(failed === 0 ? 'doctor: healthy' : `doctor: ${String(failed)} check(s) failed`);
  return failed === 0 ? 0 : 1;
}
