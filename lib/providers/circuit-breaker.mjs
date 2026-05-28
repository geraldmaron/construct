/**
 * lib/providers/circuit-breaker.mjs — per-provider circuit breaker.
 *
 * Wraps any async function with three-state breaker semantics:
 *
 *   CLOSED  — calls run normally. Consecutive failures are counted.
 *   OPEN    — calls fail-fast with a `CircuitOpenError`. After
 *             `cooldownMs`, the breaker transitions to HALF_OPEN.
 *   HALF_OPEN — the next call is a probe. Success → CLOSED, failure → OPEN.
 *
 * Wraps provider HTTP calls so when a remote system goes down, Construct
 * stops drilling it (and stops blocking user-facing operations on the failure
 * mode) until the cooldown elapses. State is per-key, so one provider going
 * down doesn't trip another's breaker.
 *
 * The breaker classifies errors via `isFailure(err)`. By default any
 * non-null error counts as a failure. Callers can pass a predicate to
 * exclude expected errors (e.g. 4xx auth errors that don't indicate the
 * remote system is unhealthy).
 *
 * Inspection: `getBreaker(key).state`, `.openedAt`, `.failureCount` are
 * read-only views, useful for `construct doctor` to surface "GitHub
 * provider circuit OPEN since 12:34:56".
 */

const STATES = Object.freeze({ CLOSED: 'closed', OPEN: 'open', HALF_OPEN: 'half_open' });

const REGISTRY = new Map();

class CircuitOpenError extends Error {
  constructor(key, openedAt) {
    super(`circuit breaker '${key}' is open (since ${new Date(openedAt).toISOString()})`);
    this.name = 'CircuitOpenError';
    this.key = key;
    this.openedAt = openedAt;
  }
}

class Breaker {
  constructor(key, options = {}) {
    this.key = key;
    this.failureThreshold = options.failureThreshold ?? 5;
    this.cooldownMs = options.cooldownMs ?? 30_000;
    this.isFailure = options.isFailure || ((err) => err != null);
    this.state = STATES.CLOSED;
    this.failureCount = 0;
    this.openedAt = null;
  }

  reset() {
    this.state = STATES.CLOSED;
    this.failureCount = 0;
    this.openedAt = null;
  }

  _maybeHalfOpen() {
    if (this.state !== STATES.OPEN) return;
    if (Date.now() - this.openedAt >= this.cooldownMs) {
      this.state = STATES.HALF_OPEN;
    }
  }

  _recordSuccess() {
    if (this.state === STATES.HALF_OPEN) {
      this.reset();
      return;
    }
    if (this.state === STATES.CLOSED) {
      this.failureCount = 0;
    }
  }

  _recordFailure() {
    if (this.state === STATES.HALF_OPEN) {
      this.state = STATES.OPEN;
      this.openedAt = Date.now();
      return;
    }
    this.failureCount += 1;
    if (this.failureCount >= this.failureThreshold) {
      this.state = STATES.OPEN;
      this.openedAt = Date.now();
    }
  }

  async run(fn, ...args) {
    this._maybeHalfOpen();
    if (this.state === STATES.OPEN) {
      throw new CircuitOpenError(this.key, this.openedAt);
    }
    try {
      const result = await fn(...args);
      this._recordSuccess();
      return result;
    } catch (err) {
      if (this.isFailure(err)) this._recordFailure();
      throw err;
    }
  }
}

export function getBreaker(key, options) {
  if (!REGISTRY.has(key)) REGISTRY.set(key, new Breaker(key, options));
  return REGISTRY.get(key);
}

export function describeBreakers() {
  return [...REGISTRY.values()].map((b) => ({
    key: b.key,
    state: b.state,
    failureCount: b.failureCount,
    openedAt: b.openedAt,
  }));
}

export function resetBreaker(key) {
  REGISTRY.get(key)?.reset();
}

export function clearBreakerRegistry() {
  REGISTRY.clear();
}

export { STATES, CircuitOpenError };
