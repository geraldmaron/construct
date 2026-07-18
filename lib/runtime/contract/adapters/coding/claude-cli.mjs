/**
 * lib/runtime/contract/adapters/coding/claude-cli.mjs — Claude Code CLI runtime.
 *
 * The "Claude" runtime shape named in directive §17 E4, and the "before"
 * side of this bead's replacement proof (see claude-api.mjs for the
 * "after"). A thin specialization of process-transport.mjs: shells out to
 * the `claude` binary in non-interactive print mode (`claude -p <prompt>`),
 * one process per invoke() call. Requires the `claude` CLI installed and
 * authenticated on the host — the same operational-migration shape spike F
 * found for the gh CLI transport it generalizes from.
 */
import { createProcessTransportRuntime } from './process-transport.mjs';

export function createClaudeCliRuntime({ name = 'claude-cli', command = 'claude', spawnFn } = {}) {
  return createProcessTransportRuntime({
    name,
    kind: 'coding',
    command,
    buildArgs: (input) => ['-p', String(input?.prompt ?? '')],
    parseOutput: (stdout) => stdout.trim(),
    spawnFn,
  });
}
