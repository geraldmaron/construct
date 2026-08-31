/**
 * hosts/integrations/cursor.ts — Cursor HostIntegrationAdapter.
 */

import { resolve } from 'node:path';
import type {
  HostIntegrationAdapter,
  HostIntegrationCapabilities,
  IntegrationPlan,
  IntegrationStateView,
  IntegrationVerification,
} from '../../kernel/integration/types.ts';
import {
  PROJECT_MCP_SERVER_NAME,
  buildProjectMcpServerEntry,
  projectMcpConfigPath,
} from '../cursor/mcpconfig.ts';
import { mergeMcpServerEntry, readMcpServerEntry } from './merge-mcp.ts';

const CAPS: HostIntegrationCapabilities = {
  capabilities: ['mcp-stdio', 'project-skills', 'session-binding', 'config-merge'],
  maturity: 'measured',
};

export function createCursorIntegrationAdapter(): HostIntegrationAdapter {
  return {
    id: 'cursor',
    capabilities: () => CAPS,
    async resolveProjectRoot(hints) {
      return resolve(hints.hostProvidedRoot ?? hints.cwd ?? process.cwd());
    },
    async inspect(projectRoot) {
      const path = projectMcpConfigPath(projectRoot);
      const entry = readMcpServerEntry(path, PROJECT_MCP_SERVER_NAME);
      if (!entry) {
        return { hostId: 'cursor', status: 'absent', path } satisfies IntegrationStateView;
      }
      const args = Array.isArray(entry.args) ? entry.args.map(String) : [];
      const bound =
        args.some((a) => a.startsWith('--client=')) && args.some((a) => a.startsWith('--project='));
      return {
        hostId: 'cursor',
        status: bound ? 'installed' : 'broken',
        path,
        detail: bound ? undefined : 'construct-mcp entry lacks --client/--project session binding',
      };
    },
    async plan(projectRoot) {
      const path = projectMcpConfigPath(projectRoot);
      return {
        hostId: 'cursor',
        actions: [
          {
            kind: 'write-mcp',
            path,
            reason: `merge ${PROJECT_MCP_SERVER_NAME} with session-bound serve`,
          },
        ],
      } satisfies IntegrationPlan;
    },
    async install(projectRoot) {
      const path = projectMcpConfigPath(projectRoot);
      const entry = buildProjectMcpServerEntry({ client: 'cursor', projectRoot }, projectRoot);
      const result = mergeMcpServerEntry(path, PROJECT_MCP_SERVER_NAME, entry);
      if (!result.ok) throw new Error(`cursor integration: ${result.reason} at ${result.path}`);
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
