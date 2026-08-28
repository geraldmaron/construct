/**
 * cli/wire.ts — closing deficiency-map row 5: wiring the projection
 * (`construct serve`) into the ambient host's MCP config used to be a
 * hand-edit (docs/consumer-install.md), which the operator archetype who
 * must never see a shell command cannot cross unaided. `construct wire`
 * detects the host this process is already running inside
 * (`hosts/ambient.ts`) and writes that one entry for it.
 *
 * What this command is not: it never dispatches, never spends, never
 * guesses a host nobody detected. Detection is `hosts/ambient.ts`'s fact
 * alone — this module supplies no fallback and no `--host` override, because
 * a wrong guess here writes a wrong path into the user's project rather than
 * just answering a question wrong. A host with no wired config writer (bob
 * today) or no detected host at all both refuse the same way: name the
 * manual recipe and change nothing.
 *
 * The file this writes is local wiring, not something committed on the
 * user's behalf — the same discipline the project-settings trust program
 * established for `.mcp.json`/`.cursor/mcp.json` generally. This command
 * only ever touches the one key it owns (`construct-mcp`) inside whatever
 * file already exists there, so a project's own other MCP servers survive
 * untouched, the same restraint kernel/cleanup/catalog.ts's un-merge already
 * assumes on the way out.
 *
 * Bare `construct wire` never writes: it detects the host and previews the
 * entry and the file it would land in, the same preview/apply split
 * `construct cleanup` uses for its own writes. Only `--yes` commits it — a
 * bare invocation someone runs to see what would happen must not be the
 * thing that edits their project config.
 *
 * The same pass plants a prompt-submit hook that launches `construct hear`.
 * Talk in that host then records a run without the user typing a tool name.
 * Other hooks in the same file stay.
 */

import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, relative } from 'node:path';
import { detectAmbientHost } from '../hosts/ambient.ts';
import type { AmbientHostName } from '../hosts/ambient.ts';
import {
  PROJECT_MCP_SERVER_NAME as CLAUDE_SERVER_NAME,
  buildProjectMcpServerEntry as buildClaudeEntry,
  projectMcpConfigPath as claudeConfigPath,
} from '../hosts/claude/mcpconfig.ts';
import {
  PROJECT_MCP_SERVER_NAME as CURSOR_SERVER_NAME,
  buildProjectMcpServerEntry as buildCursorEntry,
  projectMcpConfigPath as cursorConfigPath,
} from '../hosts/cursor/mcpconfig.ts';
import {
  claudeHearHookPresent,
  claudeSettingsPath,
  cursorHearHookPresent,
  cursorHooksPath,
  hearCommandLine,
  mergeClaudeHearHook,
  mergeCursorHearHook,
} from '../hosts/prompthook.ts';

const MANUAL_RECIPE = 'docs/consumer-install.md (Step 2: Wire the MCP entry)';

interface WireTarget {
  readonly serverName: string;
  readonly configPath: (cwd: string) => string;
  readonly entry: () => Record<string, unknown>;
}

/**
 * One entry per host this command actually knows how to wire. A host absent
 * from this map — detected or not — takes the refusal path below rather than
 * a guess: adding a host here is the only way it becomes wirable.
 */
const WIRE_TARGETS: Partial<Record<AmbientHostName, WireTarget>> = {
  claude: { serverName: CLAUDE_SERVER_NAME, configPath: claudeConfigPath, entry: buildClaudeEntry },
  cursor: { serverName: CURSOR_SERVER_NAME, configPath: cursorConfigPath, entry: buildCursorEntry },
};

function refuse(message: string): number {
  process.stderr.write(
    `construct wire: ${message}\nWire the MCP entry by hand instead: see ${MANUAL_RECIPE}.\n`,
  );
  return 1;
}

/** Reads an existing JSON config, or {} for a file that does not exist yet. Malformed JSON is refused, not clobbered. */
function readConfigOrNull(path: string): Record<string, unknown> | 'malformed' {
  if (!existsSync(path)) return {};
  try {
    const parsed: unknown = JSON.parse(readFileSync(path, 'utf8'));
    return parsed !== null && typeof parsed === 'object' && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : 'malformed';
  } catch {
    return 'malformed';
  }
}

/**
 * Writes the config where only this user can read it, mirroring the 0600 /
 * umask-aware discipline hosts/claude/mcpconfig.ts and
 * hosts/opencode/mcpconfig.ts use for the role bearer's config — this file
 * carries no bearer, but a project's MCP registrations are still not
 * something a shared machine account should read by default.
 */
function writeConfig(path: string, config: Record<string, unknown>): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(config, null, 2)}\n`, { mode: 0o600 });
  // writeFileSync's mode is masked by umask on creation, so state it outright.
  chmodSync(path, 0o600);
}

export function wire(
  argv: string[] = [],
  cwd: string = process.cwd(),
  env: NodeJS.ProcessEnv = process.env,
): number {
  const confirmed = argv.includes('--yes') || argv.includes('-y');
  const ambient = detectAmbientHost(env);
  if (ambient === null) {
    return refuse(
      'no ambient host detected — this process is not running inside a host Construct recognizes.',
    );
  }

  const target = WIRE_TARGETS[ambient.host];
  if (!target) {
    return refuse(
      `running inside ${ambient.host} (detected via ${ambient.marker}), which has no wired MCP config writer yet.`,
    );
  }

  const path = target.configPath(cwd);
  const existing = readConfigOrNull(path);
  if (existing === 'malformed') {
    return refuse(`${relative(cwd, path)} exists but is not valid JSON — left untouched.`);
  }

  const hookPath = ambient.host === 'cursor' ? cursorHooksPath(cwd) : claudeSettingsPath(cwd);
  const hookExisting = readConfigOrNull(hookPath);
  if (hookExisting === 'malformed') {
    return refuse(`${relative(cwd, hookPath)} exists but is not valid JSON — left untouched.`);
  }

  const mcpServers = (existing.mcpServers as Record<string, unknown> | undefined) ?? {};
  const entry = target.entry();
  const current = mcpServers[target.serverName];
  const displayPath = relative(cwd, path) || path;
  const displayHook = relative(cwd, hookPath) || hookPath;
  const mcpDone = current !== undefined && JSON.stringify(current) === JSON.stringify(entry);
  const hookDone =
    ambient.host === 'cursor'
      ? cursorHearHookPresent(hookExisting)
      : claudeHearHookPresent(hookExisting);

  if (mcpDone && hookDone) {
    process.stdout.write(
      `${target.serverName} is already wired into ${displayPath} for ${ambient.host} (detected via ${ambient.marker}); nothing to change.\n`,
    );
    return 0;
  }

  const commandLine = `${String((entry as { command: string }).command)} ${(entry as { args: readonly string[] }).args.join(' ')}`;
  const hearLine = hearCommandLine();
  if (!confirmed) {
    const mcpPreview = mcpDone
      ? `${target.serverName} already in ${displayPath}`
      : `would wire ${target.serverName} into ${displayPath}: ${commandLine}`;
    const hookPreview = hookDone
      ? `hear hook already in ${displayHook}`
      : `would plant a prompt hook in ${displayHook}: ${hearLine}`;
    process.stdout.write(
      `construct wire: ${mcpPreview} for ${ambient.host} (detected via ${ambient.marker}).\n` +
        `${hookPreview}\n` +
        'Nothing was written. Pass --yes to write it.\n',
    );
    return 0;
  }

  if (!mcpDone) {
    const config: Record<string, unknown> = {
      ...existing,
      mcpServers: { ...mcpServers, [target.serverName]: entry },
    };
    writeConfig(path, config);
    process.stdout.write(
      `wired ${target.serverName} into ${displayPath} for ${ambient.host} (detected via ${ambient.marker}): ${commandLine}\n`,
    );
  }

  if (!hookDone) {
    const merged =
      ambient.host === 'cursor'
        ? mergeCursorHearHook(hookExisting, hearLine)
        : mergeClaudeHearHook(hookExisting, hearLine);
    writeConfig(hookPath, merged);
    process.stdout.write(`planted prompt hook in ${displayHook}: ${hearLine}\n`);
  }

  return 0;
}
