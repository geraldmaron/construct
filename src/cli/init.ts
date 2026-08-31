/**
 * cli/init.ts — initialize a Construct project in place.
 *
 * Creates project-local config and format-v1 state. Safe initialization does
 * not require `--yes`. `--dry-run` previews without writing. When an ambient
 * client is detected, reconciles that host's MCP entry with session binding.
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
import { integrationAdapterFor } from '../hosts/integrations/registry.ts';
import { gitRoot } from './settings-file.ts';
import { packageVersion } from './runtime.ts';

function flag(argv: string[], name: string): boolean {
  return argv.includes(name);
}

/**
 * `construct init [--dry-run]`
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
  const ambient = detectAmbientHost(env);
  const adapter = ambient ? integrationAdapterFor(ambient.host) : null;

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
    if (adapter) {
      const plan = await adapter.plan(ctx.root);
      for (const action of plan.actions) {
        process.stdout.write(`  would ${action.kind}: ${action.path} (${action.reason})\n`);
      }
    } else if (ambient) {
      process.stdout.write(
        `  client: ${ambient.host} detected — no HostIntegrationAdapter yet\n`,
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

    if (adapter) {
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
    } else if (ambient) {
      process.stdout.write(
        `  client: ${ambient.host} (via ${ambient.marker}) — no integration adapter yet\n`,
      );
    } else {
      process.stdout.write(
        '  client: none detected — open from a supported host to reconcile MCP\n',
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
