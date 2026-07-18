/**
 * tests/helpers/fake-child-process.mjs — EventEmitter-shaped fake child
 * process for runtime-adapter tests that inject spawnFn, avoiding a real
 * subprocess (mirrors sterile-env.mjs's DI convention for provider tests).
 */
import { EventEmitter } from 'node:events';

/**
 * Returns a spawnFn compatible with node:child_process's spawn(command, args, opts)
 * signature. The fake child emits 'close' after delayMs unless killed first,
 * writing stdout (or invoking onStdin to compute it) before closing.
 *
 * @param {object} [opts]
 * @param {string|((stdin: string) => string)} [opts.stdout] - text to emit on
 *   stdout, or a function of the written stdin
 * @param {number} [opts.code] - exit code (default 0)
 * @param {number} [opts.delayMs] - delay before 'close' fires (default 0)
 * @returns {(command: string, args: string[], spawnOpts: object) => EventEmitter}
 */
export function createFakeSpawn({ stdout = '', code = 0, delayMs = 0 } = {}) {
  return function fakeSpawn() {
    const child = new EventEmitter();
    child.stdout = new EventEmitter();
    child.stderr = new EventEmitter();
    let written = '';
    child.stdin = {
      end(chunk) {
        if (chunk != null) written += chunk;
      },
      write(chunk) {
        written += chunk;
        return true;
      },
    };

    let settled = false;
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      const text = typeof stdout === 'function' ? stdout(written) : stdout;
      if (text) child.stdout.emit('data', Buffer.from(text));
      child.emit('close', code, null);
    }, delayMs);

    child.kill = (signal = 'SIGTERM') => {
      if (settled) return true;
      settled = true;
      clearTimeout(timer);
      child.emit('close', null, signal);
      return true;
    };

    return child;
  };
}
