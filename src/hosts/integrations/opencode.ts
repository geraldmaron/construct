/**
 * hosts/integrations/opencode.ts — OpenCode HostIntegrationAdapter.
 *
 * Project MCP lives in opencode.json under `mcp`, with type:local and a single
 * command argv array (not command+args). Schema verified against OpenCode docs.
 */

import { join, resolve } from 'node:path';
import type {
  HostIntegrationAdapter,
  HostIntegrationCapabilities,
  IntegrationPlan,
  IntegrationStateView,
  IntegrationVerification,
} from '../../kernel/integration/types.ts';
import { buildServeArgs } from '../serve-launch.ts';
import { mergeMcpServerEntry, readMcpServerEntry } from './merge-mcp.ts';

export const OPENCODE_MCP_SERVER_NAME = 'construct-mcp';

const CAPS: HostIntegrationCapabilities = {
  capabilities: ['mcp-stdio', 'session-binding', 'config-merge'],
  maturity: 'documented',
};

export function opencodeMcpConfigPath(projectRoot: string): string {
  return join(projectRoot, 'opencode.json');
}

/** OpenCode local MCP entry: command is the full argv. */
export function buildOpencodeMcpServerEntry(projectRoot: string): Record<string, unknown> {
  return {
    type: 'local',
    command: [process.execPath, ...buildServeArgs({ client: 'opencode', projectRoot })],
    enabled: true,
  };
}

function commandBound(entry: Record<string, unknown>): boolean {
  const command = Array.isArray(entry.command) ? entry.command.map(String) : [];
  return (
    command.some((a) => a.startsWith('--client=')) &&
    command.some((a) => a.startsWith('--project='))
  );
}

export function createOpencodeIntegrationAdapter(): HostIntegrationAdapter {
  return {
    id: 'opencode',
    capabilities: () => CAPS,
    async resolveProjectRoot(hints) {
      return resolve(hints.hostProvidedRoot ?? hints.cwd ?? process.cwd());
    },
    async inspect(projectRoot) {
      const path = opencodeMcpConfigPath(projectRoot);
      const entry = readMcpServerEntry(path, OPENCODE_MCP_SERVER_NAME, { serversKey: 'mcp' });
      if (!entry) {
        return { hostId: 'opencode', status: 'absent', path } satisfies IntegrationStateView;
      }
      const bound = commandBound(entry);
      return {
        hostId: 'opencode',
        status: bound ? 'installed' : 'broken',
        path,
        detail: bound ? undefined : 'construct-mcp entry lacks --client/--project session binding',
      };
    },
    async plan(projectRoot) {
      const path = opencodeMcpConfigPath(projectRoot);
      return {
        hostId: 'opencode',
        actions: [
          {
            kind: 'write-mcp',
            path,
            reason: `merge ${OPENCODE_MCP_SERVER_NAME} with session-bound serve (type:local)`,
          },
        ],
      } satisfies IntegrationPlan;
    },
    async install(projectRoot) {
      const path = opencodeMcpConfigPath(projectRoot);
      const entry = buildOpencodeMcpServerEntry(projectRoot);
      const result = mergeMcpServerEntry(path, OPENCODE_MCP_SERVER_NAME, entry, {
        serversKey: 'mcp',
        seed: { $schema: 'https://opencode.ai/config.json' },
      });
      if (!result.ok) throw new Error(`opencode integration: ${result.reason} at ${result.path}`);
    },
    async verify(projectRoot) {
      const view = await this.inspect(projectRoot);
      const checks = [
        {
          name: 'mcp-entry',
          ok: view.status === 'installed',
          detail: view.detail ?? view.path,
        },
      ];
      return {
        ok: checks.every((c) => c.ok),
        checks,
      } satisfies IntegrationVerification;
    },
  };
}
