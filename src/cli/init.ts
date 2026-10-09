/**
 * cli/init.ts — set a project up: files, one database, a drafted profile with
 * provenance, the three onboarding questions (answered from flags when given),
 * and the agent hosts the person uses here, each wired by its project file
 * with the operational skill planted in the project where that host reads it.
 *
 * Init never says a session can reach Construct when none can: with no host
 * named, detected, or found, it says nothing is connected and gives the
 * command that connects one.
 */

import { existsSync } from 'node:fs';
import { createInterface } from 'node:readline';
import { gatherProjectMaterial } from '../hosts/repo/material.ts';
import { detectAmbientHost } from '../hosts/ambient.ts';
import { initializeProject } from '../kernel/project/initialize.ts';
import { draftFromMaterial, SCALE_CHOICES } from '../kernel/project/discovery.ts';
import { applyDiscoveryDraft, applyOnboardingAnswers, composeConstitution, onboardingStatus, scaleFromAnswer, SIDE_PROJECT_NEEDS_PERSON } from '../kernel/project/onboarding.ts';
import { saveConstitution } from '../kernel/project/constitution.ts';
import { listStatements, type ProjectScale } from '../kernel/state/profile.ts';
import { isPersonChannel } from '../kernel/policy/channels.ts';
import { createSourceService } from '../kernel/source/service.ts';
import { ensureSourceEntities } from '../kernel/source/entities.ts';
import { listShippedSkills, readShippedSkill, plantSkill, skillState, OPERATIONAL_SKILL, type PlantResult, type ShippedSkill } from '../kernel/skills/bundle.ts';
import { createSkillRegistry } from '../kernel/registry/skill-registry.ts';
import { createWorkflowRegistry } from '../kernel/registry/workflow-registry.ts';
import { updateLock } from '../kernel/registry/lockfile.ts';
import { writeJsonFile } from '../kernel/project/files.ts';
import { inspectWiring, installWiring, type WiringState } from '../hosts/wiring/wire.ts';
import { HOOK_SETTINGS_PATH, inspectHooks, installHooks, type HookWiringState } from '../hosts/wiring/hooks.ts';
import { projectStateDir } from '../kernel/project/layout.ts';
import { clientWiring, launchFor, normalizeClient, parseClients, projectSkillsDirFor, WIRABLE_CLIENTS, type WirableClient } from '../hosts/wiring/clients.ts';
import { presentHosts, type PresentHost } from '../hosts/presence.ts';
import { resolveHostConfigDirs } from '../kernel/paths.ts';
import { boolFlag, listFlag, stringFlag, type CommandSpec, type ParsedArgs } from './commands.ts';
import { channelFor, terminalFacts } from './person-channel.ts';
import { hasProject } from '../kernel/project/discover.ts';
import { createContext, initRootFor, mainCheckoutOf, resolveRepository, WorktreeBindingError, type CliContext } from './context.ts';
import { esc, say, shellWord, writeJson, OperationError, UsageError } from './output.ts';
import { basename, join } from 'node:path';

export const INIT_SPEC: CommandSpec = {
  path: ['init'],
  gloss: 'set this project up: files, one database, a drafted profile, and the agent host you use here, wired with the operational skill',
  group: 'Setup',
  positionals: [],
  flags: [
    { name: 'name', gloss: 'the project’s name (default: the directory or package name)', takesValue: true },
    { name: 'purpose', gloss: 'what the project is for, in a sentence', takesValue: true },
    { name: 'scale', gloss: `what this project is to you: ${SCALE_CHOICES.map((c) => c.id).join(' | ')}, or the setup question's words for one`, takesValue: true },
    { name: 'outcome', gloss: 'the result that matters most right now', takesValue: true },
    { name: 'constraint', gloss: 'something Construct must be careful not to change or violate', takesValue: true, repeatable: true },
    { name: 'client', gloss: `the agent host you use here: ${WIRABLE_CLIENTS.join(' | ')} (comma-separate for more than one). Without it, init uses the host it runs inside, the hosts already wired here, or the only host found on this machine`, takesValue: true, repeatable: true },
    { name: 'no-wire', gloss: 'do not write the hosts’ MCP configuration or hooks', takesValue: false },
    { name: 'skills-dir', gloss: 'also plant a personal copy of the operational skill in this directory', takesValue: true },
    { name: 'dry-run', gloss: 'say what would happen and write nothing', takesValue: false },
  ],
  readOnly: false,
};

/** --scale as a scale: its id, or the setup question's own words for it. */
function scaleFlag(args: ParsedArgs): ProjectScale | undefined {
  const scale = stringFlag(args, 'scale');
  if (scale === undefined) return undefined;
  try {
    return scaleFromAnswer(scale);
  } catch {
    throw new UsageError(`--scale must be one of ${SCALE_CHOICES.map((c) => c.id).join(' | ')}, or the setup question's words for one: ${SCALE_CHOICES.map((c) => c.label).join(' | ')}`);
  }
}

function flagAnswers(args: ParsedArgs): {
  readonly name?: string;
  readonly purpose?: string;
  readonly scale?: ProjectScale;
  readonly primaryOutcome?: string;
  readonly protectedConstraints?: readonly string[];
} {
  return {
    name: stringFlag(args, 'name'),
    purpose: stringFlag(args, 'purpose'),
    scale: scaleFlag(args),
    primaryOutcome: stringFlag(args, 'outcome'),
    protectedConstraints: listFlag(args, 'constraint'),
  };
}

function unansweredUnknowns(unknowns: readonly string[], answers: { readonly purpose?: string; readonly primaryOutcome?: string }): readonly string[] {
  return unknowns.filter((u) => {
    if (u === 'purpose' && answers.purpose) return false;
    if (u === 'primary outcome' && answers.primaryOutcome) return false;
    return true;
  });
}

/** What init read from the project. `already` counts statements an earlier run proposed that still await review. */
function describeAdmission(extracted: number, unanswered: readonly string[], already = 0): string[] {
  const lines: string[] = [];
  if (extracted > 0) {
    lines.push(`  read from the project: ${String(extracted)} statement(s) extracted with source locators`);
  } else if (already > 0) {
    lines.push(`  read from the project: nothing new; ${String(already)} statement(s) already proposed`);
  } else {
    lines.push('  read from the project: no statements extracted from project files');
  }
  if (unanswered.length > 0) {
    lines.push(`  unanswered fields recorded as unknowns: ${unanswered.join('; ')}`);
  }
  return lines;
}

/** A host init will set up, and why it was chosen. */
interface ChosenHost {
  readonly client: WirableClient;
  readonly how: string;
}

interface HostPick {
  readonly hosts: readonly ChosenHost[];
  /** The hosts found on this machine, when init looked. */
  readonly found: readonly PresentHost[];
  /** Why no host was chosen, when none was. */
  readonly none: string;
  /** True when several were found and init would ask which, at a terminal of the person's own. */
  readonly wouldAsk: boolean;
}

/** One line typed at the terminal, or null when input ended first. */
function askLine(question: string, input: NodeJS.ReadableStream): Promise<string | null> {
  process.stdout.write(question);
  return new Promise((resolve) => {
    const rl = createInterface({ input, terminal: false });
    let answered = false;
    rl.once('line', (line) => {
      answered = true;
      rl.close();
      resolve(line);
    });
    rl.once('close', () => {
      if (answered) return;
      process.stdout.write('\n');
      resolve(null);
    });
  });
}

/** The hosts an answer to the numbered list names: numbers or host names; empty means all. Null when it names something not listed. */
function pickedFrom(answer: string, found: readonly PresentHost[]): WirableClient[] | null {
  const tokens = answer.trim().split(/[\s,]+/).filter(Boolean);
  if (tokens.length === 0) return found.map((f) => f.client);
  const picked: WirableClient[] = [];
  for (const token of tokens) {
    const client = /^\d+$/.test(token) ? found[Number(token) - 1]?.client : parseClients([token]).clients[0];
    if (!client) return null;
    if (!picked.includes(client)) picked.push(client);
  }
  return picked;
}

/**
 * The hosts to set up, in this order: the ones --client names; the host init
 * runs inside; the hosts already wired in this project, so re-running init
 * repairs them; the only host found on this machine. When several are found
 * and the person is at a terminal of their own, init asks once which they
 * use; otherwise it chooses none and names what it found. With --no-wire
 * nothing is wired, so only a host named or detected is set up, never one
 * guessed from what is installed.
 */
async function hostsFor(args: ParsedArgs, ctx: CliContext, root: string, mayAsk: boolean): Promise<HostPick> {
  const explicit = listFlag(args, 'client');
  if (explicit.length > 0) {
    const { clients, unknown } = parseClients(explicit);
    if (unknown.length > 0 || clients.length === 0) throw new UsageError(`--client must be one of ${WIRABLE_CLIENTS.join(' | ')}`);
    return { hosts: clients.map((client) => ({ client, how: `--client=${client}` })), found: [], none: '', wouldAsk: false };
  }
  const ambient = detectAmbientHost(ctx.env);
  const inside = normalizeClient(ambient?.host);
  if (ambient && inside !== 'unknown') return { hosts: [{ client: inside, how: `detected ${ambient.host} (${ambient.marker})` }], found: [], none: '', wouldAsk: false };
  if (boolFlag(args, 'no-wire')) return { hosts: [], found: [], none: '', wouldAsk: false };
  const already = WIRABLE_CLIENTS.filter((c) => inspectWiring(c, root).status !== 'absent');
  if (already.length > 0) return { hosts: already.map((client) => ({ client, how: 'already wired in this project' })), found: [], none: '', wouldAsk: false };
  const found = presentHosts(ctx.env, resolveHostConfigDirs(ctx.env));
  if (found.length === 1) return { hosts: [{ client: found[0]!.client, how: `the only agent host found on this machine: ${found[0]!.evidence}` }], found, none: '', wouldAsk: false };
  const unnamed = 'No agent host was named or detected here.';
  if (found.length === 0) return { hosts: [], found, none: unnamed, wouldAsk: false };
  const facts = ctx.terminal ?? terminalFacts();
  const atTerminal = facts.interactive && channelFor(ctx.env, facts) === 'tty_cli';
  if (!atTerminal || !mayAsk) return { hosts: [], found, none: unnamed, wouldAsk: atTerminal };
  const list = found.map((f, i) => `  ${String(i + 1)}) ${f.client} (${esc(f.evidence)})`).join('\n');
  const answer = await askLine(`Which agent hosts do you use in this project?\n${list}\nEnter numbers, or press Enter for all: `, ctx.input ?? process.stdin);
  if (answer === null) return { hosts: [], found, none: 'No host was picked.', wouldAsk: false };
  const picked = pickedFrom(answer, found);
  if (picked === null) return { hosts: [], found, none: `"${esc(answer.trim())}" names none of the hosts listed.`, wouldAsk: false };
  return { hosts: picked.map((client) => ({ client, how: 'picked at the terminal' })), found, none: '', wouldAsk: false };
}

/** The command a host file starts, as a person would type it. */
function launchText(root: string): string {
  const launch = launchFor(root);
  return [launch.command, ...launch.args].join(' ');
}

interface HostRecord {
  readonly client: WirableClient;
  readonly how: string;
  readonly mcp: { readonly path: string; readonly status: WiringState['status']; readonly detail: string; readonly launch: string } | null;
  /** What planting did, or `planned` in a dry run. */
  readonly skill: { readonly dir: string; readonly outcome: PlantResult['outcome'] | 'planned'; readonly why: string } | null;
  readonly hooks: { readonly path: string; readonly status: HookWiringState['status']; readonly detail: string } | null;
  readonly next: readonly string[];
}

/** What a dry run says init would do to the hooks, given how they are now. */
function plannedHooks(now: HookWiringState): HookWiringState {
  return now.status === 'installed'
    ? { ...now, detail: `${now.detail}; nothing to change` }
    : { ...now, detail: `would put construct hooks in ${HOOK_SETTINGS_PATH}, on this machine only; now ${now.status}: ${now.detail}` };
}

/** The steps that leave a wired host able to reach Construct: its one-time steps, then the person's request. */
function nextSteps(client: WirableClient, setupQuestions: number): string[] {
  const ask = setupQuestions > 0
    ? `Ask for what you want in your own words. It will ask the ${String(setupQuestions)} setup question(s) when they change the work.`
    : 'Ask for what you want in your own words.';
  return [...clientWiring(client)!.firstRun, ask];
}

/** The hosts wired in this project's files now, other than these. */
function wiredBesides(root: string, chosen: readonly WirableClient[]): WirableClient[] {
  return WIRABLE_CLIENTS.filter((c) => !chosen.includes(c) && inspectWiring(c, root).status !== 'absent');
}

const NO_WIRE_NEXT = 'Next: run `construct init --client=<host>` without --no-wire for the host you use here; until then no agent session can reach Construct.';

/** The "nothing is connected" lines, ending with the command that connects a host. */
function notConnected(pick: HostPick): string[] {
  return [
    `  host: not connected. ${pick.none}`,
    pick.found.length > 0
      ? `    found on this machine: ${pick.found.map((f) => `${f.client} (${esc(f.evidence)})`).join(', ')}`
      : '    no agent host found on this machine',
    'Next: run `construct init --client=<host>` for the host you use here; until then no agent session can reach Construct.',
  ];
}

export async function init(args: ParsedArgs, ctx: CliContext = createContext()): Promise<number> {
  // A side project makes work lighter, so only the person, at a terminal of their own, may say so; refused before anything is written.
  if (scaleFlag(args) === 'side_project' && !isPersonChannel(channelFor(ctx.env, ctx.terminal ?? terminalFacts()))) {
    throw new OperationError(
      `${SIDE_PROJECT_NEEDS_PERSON} needs your own answer, and this command is not running in a terminal of yours`,
      'Run init yourself in a terminal outside your agent host (not the host’s built-in terminal), or leave --scale out and answer the scale question with `construct inbox resolve` in your own terminal.',
    );
  }
  const repo = resolveRepository(ctx.cwd);
  const mainRoot = repo === null ? null : mainCheckoutOf(repo);
  if (repo?.linked && mainRoot !== null) {
    const shared = hasProject(mainRoot);
    throw new WorktreeBindingError(
      `this is a git worktree of ${mainRoot}; a project keeps one store, in its main checkout, for every worktree`,
      shared
        ? `Nothing to set up here: ${mainRoot} is already a Construct project, and this worktree uses its store.`
        : `Run \`construct init\` in ${mainRoot}.`,
    );
  }
  const root = initRootFor(ctx.cwd);
  // Claude Code's machine-local settings, which hold the hooks, belong to the checkout.
  const checkout = repo?.checkout ?? root;
  const dryRun = boolFlag(args, 'dry-run');
  const noWire = boolFlag(args, 'no-wire');
  const personalDir = stringFlag(args, 'skills-dir') ?? null;
  const pick = await hostsFor(args, ctx, root, !dryRun && !args.json);
  const chosen = pick.hosts.map((h) => h.client);
  // One copy of the skill serves every host that can read it, counting hosts already wired here.
  const cover = [...chosen, ...wiredBesides(root, chosen)];
  const skillDirOf = (client: WirableClient): string => join(root, projectSkillsDirFor(client, cover));
  const material = gatherProjectMaterial(root);
  const draft = draftFromMaterial(material);
  const name = stringFlag(args, 'name') ?? draft.profile.find((p) => p.field === 'name')?.value ?? basename(root);

  const answers = flagAnswers(args);
  const extracted = draft.statements.length + draft.canonicalArtifacts.length;
  const unanswered = unansweredUnknowns(draft.unknowns, answers);
  const shipped: ShippedSkill | null = readShippedSkill(OPERATIONAL_SKILL);

  if (dryRun) {
    const hosts: HostRecord[] = pick.hosts.map(({ client, how }) => {
      const w = clientWiring(client)!;
      const dir = skillDirOf(client);
      const current = inspectWiring(client, root);
      return {
        client,
        how,
        mcp: noWire ? null : { path: current.path, status: current.status, detail: `would write ${w.relativePath} to start \`${launchText(root)} serve\``, launch: launchText(root) },
        skill: shipped ? { dir, outcome: 'planned', why: `would plant; now ${skillState(shipped, dir).state}` } : null,
        hooks: client === 'claude-code' && !noWire ? plannedHooks(inspectHooks(root, { checkout, stateDir: projectStateDir(root) })) : null,
        next: noWire ? [] : nextSteps(client, draft.questions.length),
      };
    });
    const record = {
      root,
      wouldWrite: ['.construct/project.json', '.construct/constitution.json', '.construct/sources.json', '.construct/registry.lock.json', '.construct/state/construct.sqlite'],
      extractedStatements: extracted,
      unansweredFields: unanswered,
      questions: draft.questions.map((q) => q.id),
      hosts,
      hostChoices: pick.found.map((f) => ({ client: f.client, evidence: f.evidence })),
      personalSkill: personalDir,
    };
    if (args.json) {
      writeJson(record);
      return 0;
    }
    say(`construct init (dry run) in ${esc(root)}`);
    say(`  would write: ${record.wouldWrite.join(', ')}`);
    for (const line of describeAdmission(extracted, unanswered).map((l) => l.replace('read from the project:', 'would record:'))) say(line);
    say(`  would ask: ${record.questions.join(', ')}`);
    for (const h of hosts) {
      say(`  host: would ${noWire ? 'set up' : 'wire'} ${h.client} (${h.mcp ? `${esc(h.mcp.detail)}; ` : 'no MCP configuration (--no-wire); '}${esc(h.how)})`);
      if (h.skill) say(`    skill: would plant in ${esc(h.skill.dir)}`);
      if (h.hooks) say(`    hooks: ${esc(h.hooks.detail)}`);
    }
    if (hosts.length === 0) {
      say(`  host: would wire none. ${pick.wouldAsk ? 'Several agent hosts are installed; init would ask which you use.' : pick.none}`);
      say(pick.found.length > 0 ? `    found on this machine: ${pick.found.map((f) => `${f.client} (${esc(f.evidence)})`).join(', ')}` : '    no agent host found on this machine');
    }
    if (personalDir) say(`  operational skill: would plant a personal copy in ${esc(personalDir)} (--skills-dir)`);
    say('Nothing was written.');
    return 0;
  }

  const at = ctx.now();
  const result = initializeProject({ root, projectId: ctx.nextId('proj'), name, at });
  try {
    const applied = applyDiscoveryDraft(result.store, { draft, at, nextId: ctx.nextId });
    // A constraint given as a flag is the person's own rule only when they typed it at a terminal of theirs.
    const answers = applyOnboardingAnswers(result.store, {
      answers: flagAnswers(args),
      by: 'init',
      at,
      nextId: ctx.nextId,
      channel: channelFor(ctx.env, ctx.terminal ?? terminalFacts()),
    });
    saveConstitution(result.layout.constitutionFile, composeConstitution(result.store, result.constitution));
    const sources = createSourceService(result.store, { readers: new Map() });
    const synced = sources.syncDeclarations(result.sources, at);
    ensureSourceEntities(result.store, at, ctx.nextId);
    const skillRegistry = createSkillRegistry({ projectDir: result.layout.skillsDir });
    const workflowRegistry = createWorkflowRegistry({ projectDir: result.layout.workflowsDir });
    const locked = updateLock(result.lock, skillRegistry.list(), workflowRegistry.list());
    if (locked.changed.length > 0 || locked.removed.length > 0) writeJsonFile(result.layout.lockFile, locked.lock);
    const status = onboardingStatus(result.store);

    // Plant once per directory: hosts that read the same one share a copy.
    const planted = new Map<string, { readonly result: PlantResult; readonly by: string }>();
    const plantIn = (dir: string, by: string): PlantResult | null => {
      if (!shipped) return null;
      const earlier = planted.get(dir);
      if (earlier) return { ...earlier.result, why: `${earlier.result.why}; the same copy as ${earlier.by}` };
      const result = plantSkill(shipped, dir);
      planted.set(dir, { result, by });
      return result;
    };
    const replaceHint = (p: PlantResult, dir: string): string => (p.outcome === 'refused' && p.found === 'diverged'
      ? `; \`construct skill install ${OPERATIONAL_SKILL} --force --dir=${shellWord(dir)}\` replaces it, and any edits in it are lost`
      : '');
    const hosts: HostRecord[] = pick.hosts.map(({ client, how }) => {
      const mcp = noWire ? null : installWiring(client, root);
      // Hooks make reporting reads and checking answers automatic where the host supports them.
      const hooks = client === 'claude-code' && !noWire ? installHooks(root, { checkout, stateDir: result.layout.stateDir, env: ctx.env, at }) : null;
      const dir = skillDirOf(client);
      const skill = plantIn(dir, client);
      return {
        client,
        how,
        mcp: mcp ? { path: mcp.path, status: mcp.status, detail: mcp.detail, launch: launchText(root) } : null,
        skill: skill ? { dir, outcome: skill.outcome, why: `${skill.why}${replaceHint(skill, dir)}` } : null,
        hooks: hooks ? { path: hooks.path, status: hooks.status, detail: hooks.detail } : null,
        next: mcp?.status === 'installed' ? nextSteps(client, status.openQuestions.length) : [],
      };
    });
    const personal = personalDir ? plantIn(personalDir, '--skills-dir') : null;
    const personalLine = personalDir
      ? personal
        ? `${personal.outcome} at ${personal.path} (${personal.why}${replaceHint(personal, personalDir)}; --skills-dir)`
        : `skipped: this install ships no ${OPERATIONAL_SKILL} skill (${String(listShippedSkills().length)} skills found)`
      : null;

    const remainingUnknowns = unansweredUnknowns(
      applied.proposedStatements.filter((s) => s.kind === 'unknown').map((s) => s.text),
      flagAnswers(args),
    );
    const extractedApplied = applied.proposedStatements.filter((s) => s.kind !== 'unknown').length;
    const record = {
      root,
      created: result.created,
      gitignoreUpdated: result.gitignoreUpdated,
      profile: { name: answers.profile.name, onboardingState: answers.profile.onboardingState, missing: answers.missing },
      extractedStatements: extractedApplied,
      unansweredFields: remainingUnknowns,
      proposed: extractedApplied,
      openQuestions: status.openQuestions.map((q) => q.question),
      sources: synced,
      hosts,
      hostChoices: pick.found.map((f) => ({ client: f.client, evidence: f.evidence })),
      registry: { locked: Object.keys(locked.lock.skills).length + Object.keys(locked.lock.workflows).length, updated: locked.changed.length, awaitingConfirmation: locked.needsConfirmation },
      personalSkill: personalLine,
    };
    if (args.json) {
      writeJson(record);
      return 0;
    }
    const fresh = Object.values(result.created).some(Boolean);
    say(`${fresh ? 'Initialized' : 'Reconciled'} Construct project "${esc(String(answers.profile.name))}" at ${esc(root)}`);
    say(`  files: .construct/{project,constitution,sources,registry.lock}.json${result.gitignoreUpdated ? '; .gitignore now ignores .construct/state/' : ''}`);
    say(`  state: ${result.created.state ? 'created' : 'opened'} .construct/state/construct.sqlite`);
    // On a re-run nothing is new; the earlier proposals still waiting are counted the way the first run counted them, unknowns aside.
    const already = extractedApplied === 0 ? listStatements(result.store, { status: 'proposed' }).filter((st) => st.kind !== 'unknown').length : 0;
    for (const line of describeAdmission(extractedApplied, remainingUnknowns, already)) say(line);
    if (status.openQuestions.length > 0) {
      say(`  still to answer (${String(status.openQuestions.length)}):`);
      for (const q of status.openQuestions) say(`    - ${esc(q.question)}`);
    } else {
      say('  onboarding: confirmed');
    }
    say(`  registry: ${String(Object.keys(locked.lock.skills).length)} skill(s), ${String(Object.keys(locked.lock.workflows).length)} workflow(s) locked${locked.needsConfirmation.length ? `; ${String(locked.needsConfirmation.length)} project bundle(s) changed and await confirmation` : ''}`);
    if (personalLine) {
      say(`  operational skill: ${esc(personalLine)}`);
      if (personal?.outcome === 'refused') say('  (the skill was not planted; see above)');
    }
    for (const h of hosts) {
      const w = clientWiring(h.client)!;
      if (!h.mcp) {
        const now = inspectWiring(h.client, root);
        say(now.status === 'installed'
          ? `  host: ${h.client} wired earlier (${esc(now.detail)}); no MCP configuration written (--no-wire)`
          : `  host: ${h.client} not connected: no MCP configuration written (--no-wire)`);
      } else if (h.mcp.status === 'installed') {
        const replaced = /; (replaced duplicate .*)$/.exec(h.mcp.detail)?.[1];
        say(`  host: ${h.client} wired (${w.relativePath} starts \`${h.mcp.launch} serve\`; ${esc(h.how)}${replaced ? `; ${esc(replaced)}` : ''})`);
      } else {
        say(`  host: ${h.client} not connected: ${esc(h.mcp.detail)}`);
      }
      say(h.skill ? `    skill: ${esc(`${h.skill.outcome} at ${join(h.skill.dir, OPERATIONAL_SKILL)} (${h.skill.why})`)}` : `    skill: skipped: this install ships no ${OPERATIONAL_SKILL} skill`);
      if (h.hooks) say(`    hooks: ${h.hooks.status} (${esc(h.hooks.detail)})`);
      if (h.next.length > 0) {
        say(`Next, in ${w.label}:`);
        h.next.forEach((step, i) => say(`  ${String(i + 1)}. ${step}`));
      } else if (h.mcp && h.mcp.status !== 'installed') {
        say(`Next: fix ${w.relativePath} as above, then run \`construct init --client=${h.client}\` again; until then ${w.label} cannot reach Construct.`);
      }
    }
    if (noWire) {
      // An earlier init may have wired hosts this run did not set up; a session there still reaches Construct.
      const earlier = WIRABLE_CLIENTS.filter((c) => !chosen.includes(c) && inspectWiring(c, root).status === 'installed');
      if (earlier.length > 0) say(`  host: ${earlier.join(', ')} wired earlier; no MCP configuration written (--no-wire)`);
      else if (!hosts.some((h) => inspectWiring(h.client, root).status === 'installed')) {
        if (hosts.length === 0) say('  host: not connected: no MCP configuration written (--no-wire)');
        say(NO_WIRE_NEXT);
      }
    } else if (hosts.length === 0) {
      for (const line of notConnected(pick)) say(line);
    }
    if (!existsSync(result.layout.lockFile)) say('  note: no registry lock was written');
    return 0;
  } finally {
    result.store.close();
  }
}
