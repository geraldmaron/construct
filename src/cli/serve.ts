/**
 * cli/serve.ts — put Construct inside the agent host over MCP, bound to this
 * project and this session. A host launches it; a person rarely types it.
 */

import { resolve } from 'node:path';
import { serveLazyMcp, serveMcp, serveUnboundMcp } from '../hosts/mcp/server.ts';
import { KNOWN_CLIENTS } from '../hosts/wiring/clients.ts';
import { NoProjectError } from '../kernel/project/discover.ts';
import { UnsupportedStateError } from '../kernel/state/format.ts';
import { boolFlag, stringFlag, type CommandSpec, type ParsedArgs } from './commands.ts';
import { createContext, ProjectBusyError, type CliContext } from './context.ts';
import { bindingFor, openBroker } from './broker-context.ts';
import { OperationError, say, writeJson } from './output.ts';
import { packageVersion } from './version.ts';

export const SERVE_SPEC: CommandSpec = {
  path: ['serve'],
  gloss: 'speak MCP over stdio for the host that launched it, bound to this project',
  group: 'Host',
  positionals: [],
  flags: [
    { name: 'client', gloss: `which host is on the other end: ${KNOWN_CLIENTS.join(' | ')}`, takesValue: true },
    { name: 'project', gloss: 'the project root to bind (default: found from the working directory)', takesValue: true },
    { name: 'headless', gloss: 'serve the runner surface instead of the person’s session', takesValue: false },
    { name: 'executor', gloss: 'the runner’s id, with --headless', takesValue: true },
    { name: 'describe', gloss: 'print the surface this would serve and exit', takesValue: false },
  ],
  readOnly: false,
};

export async function serve(args: ParsedArgs, ctx: CliContext = createContext()): Promise<number> {
  const projectFlag = stringFlag(args, 'project');
  const bound = projectFlag ? { ...ctx, cwd: resolve(projectFlag) } : ctx;
  const flags = { client: stringFlag(args, 'client'), headless: boolFlag(args, 'headless'), executor: stringFlag(args, 'executor') };
  const binding = bindingFor(bound, flags);
  const describe = boolFlag(args, 'describe') || args.json;
  let opened: ReturnType<typeof openBroker> | null = null;
  try {
    opened = openBroker(bound, flags);
  } catch (error) {
    if (describe) throw error;
    if (error instanceof ProjectBusyError) {
      let lazy: ReturnType<typeof openBroker> | null = null;
      try {
        await serveLazyMcp(binding.surface, () => {
          lazy = openBroker(bound, flags);
          return lazy.broker;
        }, packageVersion());
      } finally {
        (lazy as ReturnType<typeof openBroker> | null)?.project.store.close();
      }
      return 0;
    }
    if (error instanceof UnsupportedStateError) {
      const next = error.kind === 'newer'
        ? 'Upgrade Construct to the version that wrote this project’s state, then restart this MCP server. Do not reset.'
        : error.kind === 'older'
          ? 'Run `construct migrate` in the project (it backs the store up first), then restart this MCP server.'
          : 'Ask the person whether to run `construct reset`; it replaces this project’s state. Then restart this MCP server.';
      await serveUnboundMcp(binding.surface, error.message.split('\n')[0]!, packageVersion(), next);
      return 0;
    }
    if (error instanceof NoProjectError || error instanceof OperationError) {
      await serveUnboundMcp(binding.surface, error.message, packageVersion());
      return 0;
    }
    throw error;
  }
  const { project, broker } = opened;
  try {
    if (describe) {
      const record = { surface: binding.surface, client: binding.client, executor: binding.executorId, project: project.root, capabilities: [...broker.host.available].sort(), maxTier: broker.host.maxTier };
      if (args.json) writeJson(record);
      else {
        say(`would serve the ${record.surface} surface for ${record.client} bound to ${record.project}`);
        say(`  executor ${record.executor}; may reach ${record.maxTier}; capabilities: ${record.capabilities.join(', ')}`);
      }
      return 0;
    }
    await serveMcp(binding.surface, broker);
    return 0;
  } finally {
    project.store.close();
  }
}
