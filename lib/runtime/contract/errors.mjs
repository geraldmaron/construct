/**
 * lib/runtime/contract/errors.mjs — typed error hierarchy for runtime adapters.
 *
 * Mirrors lib/providers/contract/errors.mjs's shape so callers that already
 * catch provider errors by type/code can extend the same pattern to
 * runtimes. Callers use these to decide retry, fallback-to-another-runtime,
 * or user-facing messaging without string-matching error messages.
 */

export class RuntimeError extends Error {
  constructor(message, { runtime, code, cause } = {}) {
    super(message, { cause });
    this.name = 'RuntimeError';
    this.runtime = runtime;
    this.code = code;
  }
}

export class RuntimeNotReadyError extends RuntimeError {
  constructor(runtime) {
    super(`Runtime "${runtime}" was invoked before init() completed`, { runtime, code: 'NOT_READY' });
    this.name = 'RuntimeNotReadyError';
  }
}

export class InvocationError extends RuntimeError {
  constructor(message, opts = {}) {
    super(message, { ...opts, code: opts.code ?? 'INVOCATION_FAILED' });
    this.name = 'InvocationError';
  }
}

export class InvocationTimeoutError extends RuntimeError {
  constructor(runtime, timeoutMs) {
    super(`Runtime "${runtime}" invocation exceeded ${timeoutMs}ms`, { runtime, code: 'INVOCATION_TIMEOUT' });
    this.name = 'InvocationTimeoutError';
    this.timeoutMs = timeoutMs;
  }
}
