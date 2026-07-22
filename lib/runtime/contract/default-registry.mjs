/**
 * lib/runtime/contract/default-registry.mjs — the production runtime
 * registry, wiring each conforming adapter under
 * lib/runtime/contract/adapters/ to a stable key. M4 (Worker Profile runtime
 * selection) and M5a (model-loop migration) resolve runtimes through
 * createDefaultRuntimeRegistry().resolve(key), not by importing adapter
 * modules directly — the registry is the swap seam.
 *
 * "coding-claude" resolves to the CLI-subprocess transport (claude-cli.mjs),
 * unchanged by the replacement proof below.
 * The replacement proof for bead/construct-b0nny.24
 * (tests/functional/runtime-adapter-swap.functional.test.mjs) constructs a
 * throwaway registry, swaps its "coding-claude" entry to the Messages-API
 * transport (claude-api.mjs) mid-flight, and rolls it back — both
 * implementations conform to the same contract and pass the same
 * conformance suite, generalizing spike F's gh-CLI-to-REST provider swap
 * (docs/notes/research/workspace-control-plane/synthesis/spike-f-runtime-replacement.md)
 * to the runtime-adapter layer.
 */
import { createRuntimeRegistry } from './registry.mjs';
import { createInProcessRuntime } from './adapters/general/inprocess.mjs';
import { createClaudeCliRuntime } from './adapters/coding/claude-cli.mjs';
import { createAcpStdioRuntime } from './adapters/coding/acp-stdio.mjs';

// createInProcessRuntime requires a handler function; the default registry
// wires an identity handler (echoes the invoke input back as output) since
// the production handler for a given 'general' invocation is caller-supplied
// work, not a fixed function this module can know in advance — a real caller
// passes its own handler via opts.

export const DEFAULT_RUNTIME_FACTORIES = Object.freeze({
  general: (opts) => createInProcessRuntime({ handler: async (input) => input, ...opts }),
  'coding-claude': (opts) => createClaudeCliRuntime(opts),
  'coding-acp': (opts) => createAcpStdioRuntime({ command: 'acp-agent', ...opts }),
});

export function createDefaultRuntimeRegistry(factories = DEFAULT_RUNTIME_FACTORIES) {
  const registry = createRuntimeRegistry();
  for (const [key, factory] of Object.entries(factories)) {
    registry.register(key, () => factory());
  }
  return registry;
}
