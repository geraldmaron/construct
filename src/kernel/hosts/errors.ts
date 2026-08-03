/**
 * kernel/hosts/errors.ts — typed error hierarchy for host adapters. Ported from the
 * predecessor's runtime error hierarchy (construct-legacy
 * lib/runtime/.../errors.mjs).
 *
 * Callers use these to decide retry, fallback-to-another-host, or user-facing
 * messaging by type and code — never by string-matching an error message.
 */

export interface HostErrorOptions {
  readonly host?: string;
  readonly code?: string;
  readonly cause?: unknown;
}

export class HostError extends Error {
  readonly host: string | undefined;
  readonly code: string | undefined;

  constructor(message: string, options: HostErrorOptions = {}) {
    super(message, { cause: options.cause });
    this.name = 'HostError';
    this.host = options.host;
    this.code = options.code;
  }
}

export class HostNotReadyError extends HostError {
  constructor(host: string) {
    super(`Host "${host}" was invoked before init() completed`, { host, code: 'NOT_READY' });
    this.name = 'HostNotReadyError';
  }
}

export class InvocationError extends HostError {
  constructor(message: string, options: HostErrorOptions = {}) {
    super(message, { ...options, code: options.code ?? 'INVOCATION_FAILED' });
    this.name = 'InvocationError';
  }
}

export class InvocationTimeoutError extends HostError {
  readonly timeoutMs: number;

  constructor(host: string, timeoutMs: number) {
    super(`Host "${host}" invocation exceeded ${timeoutMs}ms`, {
      host,
      code: 'INVOCATION_TIMEOUT',
    });
    this.name = 'InvocationTimeoutError';
    this.timeoutMs = timeoutMs;
  }
}
