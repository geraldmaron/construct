/**
 * hosts/wiring/clients.ts — where each supported host reads its MCP
 * configuration and what an entry there looks like. Facts each host
 * documents, cited rather than derived.
 *
 * An entry carries no machine path: it starts `construct serve` from the
 * PATH, or through npx when this install is the project's own dependency,
 * and the host's working directory (or its workspace variable) names the
 * project. The same file works on every teammate's machine and after a Node
 * upgrade, so it is safe to commit.
 *
 * Each host's project skills directory is the one its skills documentation
 * names: Claude Code reads .claude/skills, Codex .agents/skills, Bob
 * .bob/skills, and Cursor, OpenCode, and VS Code read both .agents/skills and
 * .claude/skills.
 */

import { realpathSync } from 'node:fs';
import { join, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { launchParts, type McpServersKey } from './merge-mcp.ts';
import type { TomlValue } from './merge-toml.ts';

export const MCP_SERVER_NAME = 'construct';

export const WIRABLE_CLIENTS = ['claude-code', 'cursor', 'vscode', 'opencode', 'codex', 'bob'] as const;
export type WirableClient = (typeof WIRABLE_CLIENTS)[number];

/** Hosts a session can be in: every wirable host, or one Construct cannot name. */
export const KNOWN_CLIENTS = [...WIRABLE_CLIENTS, 'unknown'] as const;
export type ClientId = (typeof KNOWN_CLIENTS)[number];

/** This install's command-line entry point. */
export const LAUNCHER = fileURLToPath(new URL('../../../bin/construct.mjs', import.meta.url));

/** How a host file starts Construct: `construct` from the PATH, or the project's own dependency through npx. */
export interface Launch {
  readonly command: string;
  readonly args: readonly string[];
  readonly form: 'path' | 'project-dependency';
}

function real(path: string): string {
  try {
    return realpathSync(path);
  } catch {
    return path;
  }
}

/** The launch a host file in this project should carry, given which install is writing it. */
export function launchFor(projectRoot: string, launcher: string = LAUNCHER): Launch {
  const dependencies = join(real(projectRoot), 'node_modules') + sep;
  return real(launcher).startsWith(dependencies)
    ? { command: 'npx', args: ['--no-install', 'construct'], form: 'project-dependency' }
    : { command: 'construct', args: [], form: 'path' };
}

export function serveArgs(client: ClientId): string[] {
  return ['serve', `--client=${client}`];
}

interface WiringFacts {
  readonly id: WirableClient;
  /** The host's name as a person knows it. */
  readonly label: string;
  /** The file the host reads, relative to the project root. */
  readonly relativePath: string;
  readonly documentation: string;
  /** Commands whose presence on PATH says the host is installed here. */
  readonly binaries: readonly string[];
  /** The project skills directory the host reads, relative to the project root. */
  readonly projectSkillsDir: string;
  /** True when the host also reads Claude Code's project skills directory, so one copy there serves both. */
  readonly readsClaudeSkills: boolean;
  /**
   * What the person does once, in the host, before a session there reaches
   * Construct. Init writes none of these settings; each is the host's own
   * approval or trust step, and how each host prompts is as its docs say.
   */
  readonly firstRun: readonly string[];
  /** True when the entry starts `serve` for this client. */
  bound(entry: Record<string, unknown>): boolean;
}

export type ClientWiring =
  | (WiringFacts & { readonly format: 'json'; readonly serversKey: McpServersKey; entry(launch: Launch): Record<string, unknown> })
  | (WiringFacts & { readonly format: 'toml'; readonly serversKey: 'mcp_servers'; entry(launch: Launch): Record<string, TomlValue> });

function boundTo(client: WirableClient): (entry: Record<string, unknown>) => boolean {
  return (entry) => {
    const parts = launchParts(entry);
    return parts.includes('serve') && parts.includes(`--client=${client}`);
  };
}

const serveLine = (launch: Launch, client: WirableClient, ...extra: string[]): string[] => [...launch.args, ...serveArgs(client), ...extra];

/** Claude Code's project skills directory, which Cursor, OpenCode, and VS Code also read. */
export const CLAUDE_PROJECT_SKILLS_DIR = join('.claude', 'skills');
/** The shared project skills directory Codex, Cursor, OpenCode, and VS Code read. */
const AGENTS_PROJECT_SKILLS_DIR = join('.agents', 'skills');

export const CLIENT_WIRINGS: readonly ClientWiring[] = Object.freeze([
  {
    id: 'claude-code',
    label: 'Claude Code',
    binaries: ['claude'],
    projectSkillsDir: CLAUDE_PROJECT_SKILLS_DIR,
    readsClaudeSkills: true,
    firstRun: [
      'Start a new Claude Code session in this folder; a session already open does not see Construct.',
      'Approve the project server construct when Claude Code asks. `claude mcp get construct` shows whether it is pending, approved, or rejected; if you declined it, `claude mcp reset-project-choices` asks again.',
      'Allow Construct\'s tools when Claude Code asks, or add mcp__construct to permissions.allow in your own settings.',
    ],
    relativePath: '.mcp.json',
    format: 'json',
    serversKey: 'mcpServers',
    documentation: 'https://code.claude.com/docs/en/mcp (project-scoped .mcp.json)',
    entry: (launch) => ({ type: 'stdio', command: launch.command, args: serveLine(launch, 'claude-code') }),
    bound: boundTo('claude-code'),
  },
  {
    id: 'cursor',
    label: 'Cursor',
    binaries: ['cursor', 'cursor-agent'],
    projectSkillsDir: AGENTS_PROJECT_SKILLS_DIR,
    readsClaudeSkills: true,
    firstRun: [
      'Open this folder in Cursor, or start cursor-agent here.',
      'Check that construct is on in Cursor\'s MCP settings.',
    ],
    relativePath: join('.cursor', 'mcp.json'),
    format: 'json',
    serversKey: 'mcpServers',
    documentation: 'https://cursor.com/docs/context/mcp (project .cursor/mcp.json; ${workspaceFolder} names the project)',
    entry: (launch) => ({ type: 'stdio', command: launch.command, args: serveLine(launch, 'cursor', '--project=${workspaceFolder}') }),
    bound: boundTo('cursor'),
  },
  {
    id: 'vscode',
    label: 'VS Code',
    binaries: ['code', 'code-insiders'],
    projectSkillsDir: AGENTS_PROJECT_SKILLS_DIR,
    readsClaudeSkills: true,
    firstRun: [
      'Open this folder in VS Code and trust the workspace; workspace MCP servers follow Workspace Trust.',
      'In Copilot Chat agent mode, start construct from the tools list if it has not started.',
    ],
    relativePath: join('.vscode', 'mcp.json'),
    format: 'json',
    serversKey: 'servers',
    documentation: 'https://code.visualstudio.com/docs/copilot/chat/mcp-servers (workspace .vscode/mcp.json; cwd ${workspaceFolder})',
    entry: (launch) => ({ type: 'stdio', command: launch.command, args: serveLine(launch, 'vscode'), cwd: '${workspaceFolder}' }),
    bound: boundTo('vscode'),
  },
  {
    id: 'opencode',
    label: 'OpenCode',
    binaries: ['opencode'],
    projectSkillsDir: AGENTS_PROJECT_SKILLS_DIR,
    readsClaudeSkills: true,
    firstRun: ['Start opencode in this folder.'],
    relativePath: 'opencode.json',
    format: 'json',
    serversKey: 'mcp',
    documentation: 'https://opencode.ai/docs/mcp-servers (project opencode.json, local servers)',
    entry: (launch) => ({ type: 'local', command: [launch.command, ...serveLine(launch, 'opencode')], enabled: true }),
    bound: boundTo('opencode'),
  },
  {
    id: 'codex',
    label: 'Codex',
    binaries: ['codex'],
    projectSkillsDir: AGENTS_PROJECT_SKILLS_DIR,
    readsClaudeSkills: false,
    firstRun: [
      'Start codex in this folder and trust the project when it asks; Codex reads .codex/config.toml only in trusted projects.',
      'Approve construct\'s tool calls when Codex asks.',
    ],
    relativePath: join('.codex', 'config.toml'),
    format: 'toml',
    serversKey: 'mcp_servers',
    documentation: 'https://learn.chatgpt.com/docs/extend/mcp (project .codex/config.toml, read in trusted projects only; tool_timeout_sec defaults to 60)',
    // Above the 60 s Construct waits for the person on a question, so the host does not give up first.
    entry: (launch) => ({ command: launch.command, args: serveLine(launch, 'codex'), tool_timeout_sec: 120 }),
    bound: boundTo('codex'),
  },
  {
    id: 'bob',
    label: 'IBM Bob',
    binaries: ['bob'],
    projectSkillsDir: join('.bob', 'skills'),
    readsClaudeSkills: false,
    firstRun: [
      'Open this folder in Bob; it reads .bob/mcp.json.',
      'Approve construct\'s tools when Bob asks.',
    ],
    relativePath: join('.bob', 'mcp.json'),
    format: 'json',
    serversKey: 'mcpServers',
    documentation: 'https://bob.ibm.com/docs/ide/configuration/mcp/mcp-in-bob (project .bob/mcp.json)',
    entry: (launch) => ({ command: launch.command, args: serveLine(launch, 'bob'), disabled: false }),
    bound: boundTo('bob'),
  },
]);

export function clientWiring(id: string): ClientWiring | null {
  return CLIENT_WIRINGS.find((c) => c.id === id) ?? null;
}

/**
 * The project skills directory the operational skill is planted in for this
 * host, given every host wired in the project. One copy serves as many hosts
 * as can read it: Claude Code's directory when Claude Code is wired and this
 * host reads it too, else the host's own. The result is relative to the
 * project root.
 */
export function projectSkillsDirFor(client: WirableClient, wired: readonly WirableClient[]): string {
  const w = clientWiring(client)!;
  return w.readsClaudeSkills && wired.includes('claude-code') ? CLAUDE_PROJECT_SKILLS_DIR : w.projectSkillsDir;
}

/** The client id a `--client` value or an ambient host name means. */
export function normalizeClient(raw: string | undefined): ClientId {
  if (!raw) return 'unknown';
  const key = raw.trim().toLowerCase();
  const aliases: Record<string, ClientId> = { claude: 'claude-code', 'claude-code': 'claude-code', cursor: 'cursor', vscode: 'vscode', 'vs-code': 'vscode', opencode: 'opencode', codex: 'codex', bob: 'bob' };
  return aliases[key] ?? 'unknown';
}

/** The hosts a list of `--client` values names, comma lists and aliases included, and the values that name none. */
export function parseClients(values: readonly string[]): { clients: WirableClient[]; unknown: string[] } {
  const clients: WirableClient[] = [];
  const unknown: string[] = [];
  for (const raw of values.flatMap((v) => v.split(',')).map((v) => v.trim()).filter(Boolean)) {
    const id = normalizeClient(raw);
    if (id === 'unknown') unknown.push(raw);
    else if (!clients.includes(id)) clients.push(id);
  }
  return { clients, unknown };
}
