/**
 * cli/init.ts — initialize a Construct project in place.
 *
 * Creates project-local config and format-v1 state. Safe initialization does
 * not require `--yes`. `--dry-run` previews without writing. Reconciles MCP for
 * an ambient host or an explicit `--client=` when that client has an
 * installable HostIntegrationAdapter.
 */

import { existsSync } from 'node:fs';
import { UnsupportedAlphaStoreError } from '../kernel/state/format.ts';
import {
  initializeProject,
  STATE_GITIGNORE_PATTERN,
} from '../kernel/project/initialize.ts';
import { resolveProjectContext } from '../kernel/project/context.ts';
import { projectConfigPath, projectDbPath } from '../kernel/project/layout.ts';
import { upsertIntegration } from '../kernel/state/integrations.ts';
import { detectAmbientHost } from '../hosts/ambient.ts';
import {
  integrationAdapterFor,
  integrationIsInstallable,
} from '../hosts/integrations/registry.ts';
import type { HostIntegrationAdapter } from '../kernel/integration/types.ts';
import { gitRoot } from './settings-file.ts';
import { packageVersion } from './runtime.ts';
import { plantOperationalSkill } from './skills.ts';
import {
  resolveHostSkillsDir,
  SKILLS_HOST_NAMES,
  type SkillsHostName,
} from '../kernel/paths.ts';
import { OPERATIONAL_SKILL } from '../kernel/skills/library.ts';

function flag(argv: string[], name: string): boolean {
  return argv.includes(name);
}

function parseClientFlag(argv: string[]): string | undefined {
  for (const arg of argv) {
    if (arg.startsWith('--client=')) {
      const value = arg.slice('--client='.length).trim();
      return value === '' ? undefined : value;
    }
  }
  const idx = argv.indexOf('--client');
  if (idx >= 0 && typeof argv[idx + 1] === 'string' && !argv[idx + 1]!.startsWith('--')) {
    return argv[idx + 1]!.trim();
  }
  return undefined;
}

function resolveIntegrationAdapter(
  argv: string[],
  env: NodeJS.ProcessEnv,
): {
  readonly adapter: HostIntegrationAdapter | null;
  readonly source: 'flag' | 'ambient' | 'none';
  readonly requested: string | null;
} {
  const clientFlag = parseClientFlag(argv);
  if (clientFlag !== undefined) {
    return {
      adapter: integrationAdapterFor(clientFlag),
      source: 'flag',
      requested: clientFlag,
    };
  }
  const ambient = detectAmbientHost(env);
  if (ambient) {
    return {
      adapter: integrationAdapterFor(ambient.host),
      source: 'ambient',
      requested: ambient.host,
    };
  }
  return { adapter: null, source: 'none', requested: null };
}

function resolveSkillsHost(
  argv: string[],
  env: NodeJS.ProcessEnv,
): SkillsHostName | null {
  const clientFlag = parseClientFlag(argv);
  if (clientFlag !== undefined && (SKILLS_HOST_NAMES as readonly string[]).includes(clientFlag)) {
    return clientFlag as SkillsHostName;
  }
  const ambient = detectAmbientHost(env);
  if (ambient && (SKILLS_HOST_NAMES as readonly string[]).includes(ambient.host)) {
    return ambient.host as SkillsHostName;
  }
  return null;
}

/**
 * `construct init [--dry-run] [--client=<id>]`
 */
export async function init(
  argv: string[] = [],
  cwd: string = process.cwd(),
  env: NodeJS.ProcessEnv = process.env,
): Promise<number> {
  const dryRun = flag(argv, '--dry-run');
  const ctx = resolveProjectContext({
    gitRoot: gitRoot(cwd) ?? undefined,
    cwd,
    allowCwdFallback: true,
  });

  const configPath = projectConfigPath(ctx.root);
  const dbPath = projectDbPath(ctx.root);
  const { adapter, source, requested } = resolveIntegrationAdapter(argv, env);
  const skillsHost = resolveSkillsHost(argv, env);

  if (dryRun) {
    process.stdout.write(`construct init (dry-run)\n`);
    process.stdout.write(`  project root: ${ctx.root} (${ctx.rootSource})\n`);
    process.stdout.write(
      `  config: ${configPath}${existsSync(configPath) ? ' (exists)' : ' (would create)'}\n`,
    );
    process.stdout.write(
      `  state:  ${dbPath}${existsSync(dbPath) ? ' (exists)' : ' (would create)'}\n`,
    );
    process.stdout.write(`  gitignore: ensure ${STATE_GITIGNORE_PATTERN}\n`);
    if (skillsHost) {
      process.stdout.write(
        `  would install operational skill ${OPERATIONAL_SKILL} → ${resolveHostSkillsDir(skillsHost, env)}\n`,
      );
    } else {
      process.stdout.write(
        '  operational skill: skipped (no ambient/--client host with a skills directory)\n',
      );
    }
    if (adapter && integrationIsInstallable(adapter)) {
      const plan = await adapter.plan(ctx.root);
      for (const action of plan.actions) {
        process.stdout.write(`  would ${action.kind}: ${action.path} (${action.reason})\n`);
      }
    } else if (adapter) {
      process.stdout.write(
        `  client: ${adapter.id} — native MCP install unsupported (maturity=${adapter.capabilities().maturity})\n`,
      );
    } else if (requested) {
      process.stdout.write(`  client: ${requested} — no HostIntegrationAdapter\n`);
    } else {
      process.stdout.write(
        '  client: none — pass --client=… or open from a supported host to reconcile MCP\n',
      );
    }
    return 0;
  }

  try {
    const result = initializeProject(ctx);
    process.stdout.write(`Initialized Construct project at ${result.root}\n`);
    process.stdout.write(
      `  config: ${result.configPath}${result.createdConfig ? ' (created)' : ' (kept)'}\n`,
    );
    process.stdout.write(
      `  state:  ${result.dbPath}${result.createdState ? ' (created)' : ' (opened)'}\n`,
    );
    if (result.ensuredGitignore) {
      process.stdout.write(`  gitignore: added ${STATE_GITIGNORE_PATTERN}\n`);
    }

    if (skillsHost) {
      const skillsDir = resolveHostSkillsDir(skillsHost, env);
      const planted = plantOperationalSkill(skillsDir);
      process.stdout.write(
        planted.ok
          ? `  skill: ${planted.detail}\n`
          : `  skill: skipped — ${planted.detail}\n`,
      );
    } else {
      process.stdout.write(
        '  skill: no host skills directory resolved — open from a supported host or pass --client=…\n',
      );
    }

    if (adapter && integrationIsInstallable(adapter)) {
      await adapter.install(ctx.root);
      const verification = await adapter.verify(ctx.root);
      upsertIntegration(result.store, {
        hostId: adapter.id,
        status: verification.ok ? 'installed' : 'broken',
        constructVersion: packageVersion(),
        generationVersion: '1',
        path: verification.checks[0]?.detail,
        kind: 'mcp-project',
        at: new Date().toISOString(),
      });
      process.stdout.write(
        verification.ok
          ? `  integration: ${adapter.id} installed (session-bound MCP)\n`
          : `  integration: ${adapter.id} wrote but verify failed\n`,
      );
    } else if (adapter) {
      process.stdout.write(
        `  client: ${adapter.id} (${source}) — native MCP install unsupported; configure serve --client=${adapter.id} --project=<root> by hand\n`,
      );
    } else if (requested) {
      process.stdout.write(`  client: ${requested} — no integration adapter\n`);
    } else {
      process.stdout.write(
        '  client: none detected — open from a supported host or pass --client=… to reconcile MCP\n',
      );
    }

    result.store.close();
    process.stdout.write(
      'Use Construct from your agent session. Do not run construct work as an interactive protocol.\n',
    );
    return 0;
  } catch (error) {
    if (error instanceof UnsupportedAlphaStoreError) {
      process.stderr.write(`${error.message}\n`);
      return 1;
    }
    throw error;
  }
}
