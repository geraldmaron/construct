/**
 * kernel/session/binding.ts — structural interactive session identity.
 *
 * Prefer host-native MCP launch args (`construct serve --client=… --project=…`)
 * over ambient environment detection as routing authority. Env detection may
 * remain for diagnostics and CLI hints.
 */

export const KNOWN_CLIENTS = [
  'claude-code',
  'cursor',
  'opencode',
  'bob',
  'vscode',
  'codex',
  'unknown',
] as const;

export type ClientId = (typeof KNOWN_CLIENTS)[number];

export interface SessionBinding {
  /** Always true for serve-launched interactive MCP. */
  readonly interactive: true;
  /** Client where the user is interacting. */
  readonly client: ClientId;
  /** Absolute project root when known. */
  readonly projectRoot: string | null;
  /** How client was bound. */
  readonly clientSource: 'flag' | 'default-unknown';
  /** How project was bound. */
  readonly projectSource: 'flag' | 'cwd' | 'absent';
}

function parseFlag(argv: readonly string[], name: string): string | undefined {
  const prefix = `--${name}=`;
  for (const arg of argv) {
    if (arg.startsWith(prefix)) {
      const value = arg.slice(prefix.length).trim();
      return value === '' ? undefined : value;
    }
  }
  const idx = argv.indexOf(`--${name}`);
  if (idx >= 0 && typeof argv[idx + 1] === 'string' && !argv[idx + 1]!.startsWith('--')) {
    return argv[idx + 1]!.trim();
  }
  return undefined;
}

function normalizeClient(raw: string | undefined): { client: ClientId; source: SessionBinding['clientSource'] } {
  if (raw === undefined) return { client: 'unknown', source: 'default-unknown' };
  const key = raw.trim().toLowerCase();
  // Accept adapter short names and product ids.
  const aliases: Record<string, ClientId> = {
    claude: 'claude-code',
    'claude-code': 'claude-code',
    cursor: 'cursor',
    opencode: 'opencode',
    bob: 'bob',
    vscode: 'vscode',
    'vs-code': 'vscode',
    codex: 'codex',
    unknown: 'unknown',
  };
  const mapped = aliases[key];
  if (mapped) return { client: mapped, source: 'flag' };
  return { client: 'unknown', source: 'flag' };
}

/**
 * Build a session binding from serve argv. Missing client still yields
 * interactive=true with client unknown — never falls through to headless.
 */
export function parseSessionBinding(
  argv: readonly string[],
  cwd: string = process.cwd(),
): SessionBinding {
  const clientRaw = parseFlag(argv, 'client');
  const projectRaw = parseFlag(argv, 'project');
  const { client, source: clientSource } = normalizeClient(clientRaw);

  if (projectRaw !== undefined) {
    return {
      interactive: true,
      client,
      clientSource,
      projectRoot: projectRaw,
      projectSource: 'flag',
    };
  }

  return {
    interactive: true,
    client,
    clientSource,
    projectRoot: cwd,
    projectSource: 'cwd',
  };
}

/** Owner string for task leases from a binding. */
export function sessionOwner(binding: SessionBinding): string {
  return `session:${binding.client}`;
}
