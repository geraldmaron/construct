/**
 * hosts/integrations/vscode.ts — VS Code HostIntegrationAdapter (.vscode/mcp.json).
 *
 * VS Code uses a `servers` root key (not mcpServers) and prefers type: stdio.
 */

import { join, resolve } from 'node:path';
import type {
  HostIntegrationAdapter,
  HostIntegrationCapabilities,
  IntegrationPlan,
  IntegrationStateView,
  IntegrationVerification,
} from '../../kernel/integration/types.ts';
import { buildServeEntry } from '../serve-launch.ts';
import { mergeMcpServerEntry, readMcpServerEntry } from './merge-mcp.ts';

export const VSCODE_MCP_SERVER_NAME = 'construct-mcp';

const CAPS: HostIntegrationCapabilities = {
  capabilities: ['mcp-stdio', 'session-binding', 'config-merge'],
  maturity: 'documented',
};

export function vscodeMcpConfigPath(projectRoot: string): string {
  return join(projectRoot, '.vscode', 'mcp.json');
}

export function buildVscodeMcpServerEntry(
  projectRoot: string,
): Record<string, unknown> {
  const base = buildServeEntry({ client: 'vscode', projectRoot });
  return { type: 'stdio', ...base };
}

export function createVscodeIntegrationAdapter(): HostIntegrationAdapter {
  return {
    id: 'vscode',
    capabilities: () => CAPS,
    async resolveProjectRoot(hints) {
      return resolve(hints.hostProvidedRoot ?? hints.cwd ?? process.cwd());
    },
    async inspect(projectRoot) {
      const path = vscodeMcpConfigPath(projectRoot);
      const entry = readMcpServerEntry(path, VSCODE_MCP_SERVER_NAME, { serversKey: 'servers' });
      if (!entry) {
        return { hostId: 'vscode', status: 'absent', path } satisfies IntegrationStateView;
      }
      const args = Array.isArray(entry.args) ? entry.args.map(String) : [];
      const bound =
        args.some((a) => a.startsWith('--client=')) && args.some((a) => a.startsWith('--project='));
      return {
        hostId: 'vscode',
        status: bound ? 'installed' : 'broken',
        path,
        detail: bound ? undefined : 'construct-mcp entry lacks --client/--project session binding',
      };
    },
    async plan(projectRoot) {
      const path = vscodeMcpConfigPath(projectRoot);
      return {
        hostId: 'vscode',
        actions: [
          {
            kind: 'write-mcp',
            path,
            reason: `merge ${VSCODE_MCP_SERVER_NAME} with session-bound serve`,
          },
        ],
      } satisfies IntegrationPlan;
    },
    async install(projectRoot) {
      const path = vscodeMcpConfigPath(projectRoot);
      const entry = buildVscodeMcpServerEntry(projectRoot);
      const result = mergeMcpServerEntry(path, VSCODE_MCP_SERVER_NAME, entry, {
        serversKey: 'servers',
      });
      if (!result.ok) throw new Error(`vscode integration: ${result.reason} at ${result.path}`);
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
