/**
 * cli/serve.ts — put Construct inside the agent host over MCP, bound to this
 * project and this session. A host launches it; a person rarely types it.
 */

import { resolve } from 'node:path';
import { serveMcp } from '../hosts/mcp/server.ts';
import { KNOWN_CLIENTS } from '../hosts/wiring/clients.ts';
import { boolFlag, stringFlag, type CommandSpec, type ParsedArgs } from './commands.ts';
import { createContext, type CliContext } from './context.ts';
import { openBroker } from './broker-context.ts';
import { say, writeJson } from './output.ts';

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
  const { project, binding, broker } = openBroker(bound, { client: stringFlag(args, 'client'), headless: boolFlag(args, 'headless'), executor: stringFlag(args, 'executor') });
  try {
    if (boolFlag(args, 'describe') || args.json) {
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
