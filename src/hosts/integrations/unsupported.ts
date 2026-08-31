/**
 * hosts/integrations/unsupported.ts — honest stub HostIntegrationAdapters
 * for clients without a measured MCP writer yet.
 */

import { resolve } from 'node:path';
import type {
  HostIntegrationAdapter,
  HostIntegrationCapabilities,
  IntegrationPlan,
  IntegrationStateView,
  IntegrationVerification,
} from '../../kernel/integration/types.ts';

const CAPS: HostIntegrationCapabilities = {
  capabilities: [],
  maturity: 'unsupported',
};

/**
 * Report-only adapter: inspect/plan never invent an install path;
 * install throws so callers cannot pretend wiring succeeded.
 */
export function createUnsupportedIntegrationAdapter(id: string): HostIntegrationAdapter {
  return {
    id,
    capabilities: () => CAPS,
    async resolveProjectRoot(hints) {
      return resolve(hints.hostProvidedRoot ?? hints.cwd ?? process.cwd());
    },
    async inspect(projectRoot) {
      return {
        hostId: id,
        status: 'absent',
        path: projectRoot,
        detail: `${id}: no native MCP install path yet — configure serve --client=${id} --project=<root> manually`,
      } satisfies IntegrationStateView;
    },
    async plan(projectRoot) {
      return {
        hostId: id,
        actions: [
          {
            kind: 'report',
            path: projectRoot,
            reason: `${id}: unsupported for automatic install; use manual session-bound serve`,
          },
        ],
      } satisfies IntegrationPlan;
    },
    async install() {
      throw new Error(
        `${id}: native MCP install is unsupported — wire construct serve --client=${id} --project=<root> by hand`,
      );
    },
    async verify(projectRoot) {
      const view = await this.inspect(projectRoot);
      return {
        ok: false,
        checks: [
          {
            name: 'native-install',
            ok: false,
            detail: view.detail,
          },
        ],
      } satisfies IntegrationVerification;
    },
  };
}
