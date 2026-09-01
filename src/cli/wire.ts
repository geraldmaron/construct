/**
 * cli/wire.ts — legacy MCP config write.
 *
 * Prefer `construct init` (optionally `--client=`). This verb remains callable
 * so older docs and scripts do not hard-break, but it always names the
 * replacement and delegates to HostIntegrationAdapter rather than owning its
 * own writers. Full deletion is Phase G.
 */

import { existsSync, readFileSync } from 'node:fs';
import { relative } from 'node:path';
import { detectAmbientHost } from '../hosts/ambient.ts';
import {
  integrationAdapterFor,
  integrationIsInstallable,
} from '../hosts/integrations/registry.ts';

const INIT_HINT = 'construct init (or construct init --client=<id>)';

function refuse(message: string): number {
  process.stderr.write(
    `construct wire: ${message}\nPrefer ${INIT_HINT}. Manual recipe: docs/consumer-install.md.\n`,
  );
  return 1;
}

function refuseIfMalformed(configPath: string, cwd: string): number | null {
  if (!existsSync(configPath)) return null;
  try {
    const parsed: unknown = JSON.parse(readFileSync(configPath, 'utf8'));
    if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
      return refuse(
        `${relative(cwd, configPath) || configPath} exists but is not valid JSON — left untouched.`,
      );
    }
    return null;
  } catch {
    return refuse(
      `${relative(cwd, configPath) || configPath} exists but is not valid JSON — left untouched.`,
    );
  }
}

/**
 * `construct wire [--yes]` — preview or write ambient-host MCP via the
 * integration registry. Always prints a deprecation notice.
 */
export async function wire(
  argv: string[] = [],
  cwd: string = process.cwd(),
  env: NodeJS.ProcessEnv = process.env,
): Promise<number> {
  process.stderr.write(
    `construct wire is legacy — prefer ${INIT_HINT} to create project state and reconcile MCP.\n`,
  );

  const confirmed = argv.includes('--yes') || argv.includes('-y');
  const ambient = detectAmbientHost(env);
  if (ambient === null) {
    return refuse(
      'no ambient host detected — this process is not running inside a host Construct recognizes.',
    );
  }

  const adapter = integrationAdapterFor(ambient.host);
  if (!adapter || !integrationIsInstallable(adapter)) {
    return refuse(
      `running inside ${ambient.host} (detected via ${ambient.marker}), which has no native MCP install path yet.`,
    );
  }

  const plan = await adapter.plan(cwd);
  const action = plan.actions[0];
  const configPath = action?.path;
  if (configPath) {
    const malformed = refuseIfMalformed(configPath, cwd);
    if (malformed !== null) return malformed;
  }

  const view = await adapter.inspect(cwd);
  const displayPath = configPath
    ? relative(cwd, configPath) || configPath
    : view.path
      ? relative(cwd, view.path) || view.path
      : '(unknown)';

  if (view.status === 'installed') {
    process.stdout.write(
      `construct-mcp is already wired into ${displayPath} for ${ambient.host} (detected via ${ambient.marker}); nothing to change.\n`,
    );
    return 0;
  }

  if (!confirmed) {
    process.stdout.write(
      `construct wire: would wire construct-mcp into ${displayPath} for ${ambient.host} (detected via ${ambient.marker})\n` +
        'Nothing was written. Pass --yes to commit this legacy write.\n' +
        `Prefer ${INIT_HINT}.\n`,
    );
    return 0;
  }

  try {
    await adapter.install(cwd);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return refuse(message);
  }

  const verification = await adapter.verify(cwd);
  if (!verification.ok) {
    return refuse(`wrote ${displayPath} but verify failed`);
  }

  process.stdout.write(
    `wired construct-mcp into ${displayPath} for ${ambient.host} (detected via ${ambient.marker})\n`,
  );
  return 0;
}
