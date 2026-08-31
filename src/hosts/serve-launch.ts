/**
 * hosts/serve-launch.ts — shared construct serve argv for host MCP registration.
 *
 * Session binding is structural: every project MCP entry should name client and
 * project so the MCP process does not rely on ambient env for routing.
 */

import { fileURLToPath } from 'node:url';
import type { ClientId } from '../kernel/session/binding.ts';

const BIN = fileURLToPath(new URL('../../bin/construct.mjs', import.meta.url));

export interface ServeLaunchBinding {
  readonly client: ClientId | string;
  readonly projectRoot: string;
}

/** Default Node + bin/construct.mjs serve argv with session binding. */
export function buildServeArgs(binding: ServeLaunchBinding): string[] {
  return [
    BIN,
    'serve',
    `--client=${binding.client}`,
    `--project=${binding.projectRoot}`,
  ];
}

export function buildServeEntry(
  binding: ServeLaunchBinding,
  launch: { readonly command?: string; readonly args?: readonly string[] } = {},
): Record<string, unknown> {
  return {
    command: launch.command ?? process.execPath,
    args: [...(launch.args ?? buildServeArgs(binding))],
  };
}
