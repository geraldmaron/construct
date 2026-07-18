/**
 * lib/runtime/contract/adapters/coding/process-transport.mjs — shared
 * OS-process transport for coding-runtime adapters that shell out to a CLI
 * (see claude-cli.mjs).
 *
 * Generalizes the gh-CLI subprocess shape spike F validated for a provider
 * transport
 * (docs/notes/research/workspace-control-plane/synthesis/spike-f-runtime-replacement.md)
 * into a runtime-adapter transport: async spawn (not spawnSync), so an
 * in-flight call can genuinely be interrupted via child.kill() — the
 * 'interrupt' capability this transport declares and the conformance suite
 * verifies.
 *
 * `spawnFn` defaults to node:child_process's spawn; tests inject a fake to
 * avoid spawning a real binary, the same DI convention
 * lib/providers/contract/adapters/*'s governed-write wrappers already use
 * for their transports.
 */
import { spawn as nodeSpawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { RuntimeNotReadyError, InvocationError } from '../../errors.mjs';

export function createProcessTransportRuntime({
  name,
  kind = 'coding',
  command,
  buildArgs = (input) => (Array.isArray(input?.args) ? input.args : []),
  buildStdin = (input) => input?.stdin,
  parseOutput = (stdout) => stdout,
  spawnFn = nodeSpawn,
  env,
} = {}) {
  if (!name) throw new TypeError('createProcessTransportRuntime requires a name');
  if (!command) throw new TypeError('createProcessTransportRuntime requires a command');

  let ready = false;
  const children = new Map();

  return {
    name,
    kind,
    capabilities: ['interrupt'],

    async init() {
      ready = true;
    },

    async health() {
      return { live: ready };
    },

    async invoke(request, context = {}) {
      if (!ready) throw new RuntimeNotReadyError(name);
      const invocationId = context.invocationId ?? randomUUID();
      const args = buildArgs(request?.input);
      const stdin = buildStdin(request?.input);

      const child = spawnFn(command, args, { env: env ?? process.env });
      children.set(invocationId, child);

      let stdout = '';
      let stderr = '';
      child.stdout?.on('data', (chunk) => {
        stdout += chunk;
      });
      child.stderr?.on('data', (chunk) => {
        stderr += chunk;
      });
      if (stdin != null) child.stdin?.end(stdin);
      else child.stdin?.end();

      try {
        const { code, signal } = await new Promise((resolve, reject) => {
          child.once('error', reject);
          child.once('close', (exitCode, exitSignal) => resolve({ code: exitCode, signal: exitSignal }));
        });

        if (signal) {
          return { id: invocationId, status: 'cancelled', output: null, error: null };
        }
        if (code !== 0) {
          return {
            id: invocationId,
            status: 'failed',
            output: null,
            error: new InvocationError(`${command} exited ${code}: ${stderr.trim()}`, { runtime: name }),
          };
        }
        return { id: invocationId, status: 'completed', output: parseOutput(stdout), error: null };
      } catch (err) {
        return {
          id: invocationId,
          status: 'failed',
          output: null,
          error: new InvocationError(err.message, { runtime: name, cause: err }),
        };
      } finally {
        children.delete(invocationId);
      }
    },

    async cancel(invocationId) {
      const child = children.get(invocationId);
      if (!child) return { cancelled: false, reason: 'unknown invocation id' };
      child.kill('SIGTERM');
      return { cancelled: true };
    },
  };
}
