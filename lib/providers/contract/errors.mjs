/**
 * providers/lib/errors.mjs — typed error hierarchy for providers.
 *
 * Core catches these by type to decide retry, fallback, or user-facing messaging.
 */

export class ProviderError extends Error {
  constructor(message, { provider, capability, code, cause } = {}) {
    super(message, { cause });
    this.name = 'ProviderError';
    this.provider = provider;
    this.capability = capability;
    this.code = code;
  }
}

export class CapabilityNotSupported extends ProviderError {
  constructor(provider, capability) {
    super(`Provider "${provider}" does not support capability "${capability}"`, {
      provider,
      capability,
      code: 'CAPABILITY_NOT_SUPPORTED',
    });
    this.name = 'CapabilityNotSupported';
  }
}

export class AuthError extends ProviderError {
  constructor(message, opts = {}) {
    super(message, { ...opts, code: 'AUTH_ERROR' });
    this.name = 'AuthError';
  }
}

export class RateLimitError extends ProviderError {
  constructor(message, { retryAfter, ...opts } = {}) {
    super(message, { ...opts, code: 'RATE_LIMIT' });
    this.name = 'RateLimitError';
    this.retryAfter = retryAfter;
  }
}

export class NotFoundError extends ProviderError {
  constructor(message, opts = {}) {
    super(message, { ...opts, code: 'NOT_FOUND' });
    this.name = 'NotFoundError';
  }
}
