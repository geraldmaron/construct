/**
 * lib/runtime/contract/adapters/coding/acp-stdio.mjs — process-or-ACP runtime.
 *
 * The "process-or-ACP" runtime shape named in directive §17 E4: a
 * long-lived subprocess runtime that speaks newline-delimited JSON-RPC 2.0
 * over stdio, rather than argv-in/exit-code-out per call
 * (process-transport.mjs's shape). This is a minimal request/response
 * framing in the family Agent Client Protocol implementations use — it does
 * not claim conformance to any specific published ACP wire spec, only
 * demonstrates the transport shape (persistent process, structured
 * request/response over stdio, out-of-band cancel notification) the
 * directive names as a distinct runtime category from a one-shot CLI
 * subprocess.
 *
 * `spawnFn` defaults to node:child_process's spawn; tests inject a fake
 * duplex-stream-shaped process to avoid spawning a real binary.
 */
import { spawn as nodeSpawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { RuntimeNotReadyError, InvocationError } from '../../errors.mjs';

export function createAcpStdioRuntime({ name = 'acp-stdio', command, args = [], spawnFn = nodeSpawn, env } = {}) {
  if (!command) throw new TypeError('createAcpStdioRuntime requires a command');

  let child = null;
  let ready = false;
  let buffer = '';
  const pending = new Map();

  function handleLine(line) {
    if (!line.trim()) return;
    let message;
    try {
      message = JSON.parse(line);
    } catch {
      return;
    }
    const waiter = pending.get(message.id);
    if (!waiter) return;
    pending.delete(message.id);
    if (message.error) waiter.reject(new InvocationError(message.error.message ?? 'ACP error', { runtime: name }));
    else waiter.resolve(message.result);
  }

  return {
    name,
    kind: 'coding',
    capabilities: ['interrupt'],

    async init() {
      child = spawnFn(command, args, { env: env ?? process.env });
      child.stdout?.on('data', (chunk) => {
        buffer += chunk.toString();
        let idx;
        while ((idx = buffer.indexOf('\n')) >= 0) {
          const line = buffer.slice(0, idx);
          buffer = buffer.slice(idx + 1);
          handleLine(line);
        }
      });
      ready = true;
    },

    async health() {
      return { live: ready && !!child && child.exitCode == null };
    },

    async invoke(request, context = {}) {
      if (!ready || !child) throw new RuntimeNotReadyError(name);
      const invocationId = context.invocationId ?? randomUUID();

      const resultPromise = new Promise((resolve, reject) => {
        pending.set(invocationId, { resolve, reject });
      });

      child.stdin?.write(`${JSON.stringify({ jsonrpc: '2.0', id: invocationId, method: 'invoke', params: request?.input })}\n`);

      try {
        const output = await resultPromise;
        return { id: invocationId, status: 'completed', output, error: null };
      } catch (err) {
        if (err?.code === 'CANCELLED') {
          return { id: invocationId, status: 'cancelled', output: null, error: null };
        }
        return {
          id: invocationId,
          status: 'failed',
          output: null,
          error: err instanceof InvocationError ? err : new InvocationError(err.message, { runtime: name, cause: err }),
        };
      } finally {
        pending.delete(invocationId);
      }
    },

    async cancel(invocationId) {
      const waiter = pending.get(invocationId);
      if (!waiter) return { cancelled: false, reason: 'unknown invocation id' };
      pending.delete(invocationId);
      child.stdin?.write(`${JSON.stringify({ jsonrpc: '2.0', method: 'cancel', params: { id: invocationId } })}\n`);
      waiter.reject(new InvocationError('cancelled by caller', { runtime: name, code: 'CANCELLED' }));
      return { cancelled: true };
    },
  };
}
