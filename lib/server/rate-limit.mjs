/**
 * lib/server/rate-limit.mjs — token-bucket rate limiting for the dashboard.
 *
 * Three tiers, configurable via env:
 *
 *   read    60 req/min/key  (dashboard polling, list endpoints)
 *   chat    10 req/min/key  (/api/chat/stream — bursty + expensive)
 *   write    5 req/min/key  (state-mutating endpoints — approvals, config)
 *
 * `key` is by default the request's source IP, with the active session id
 * mixed in when present so two users behind the same NAT get separate
 * buckets. Buckets live in-memory; they are NOT shared across processes.
 * Adequate for solo mode; team and enterprise deployments need a shared
 * store (Redis or Postgres) because a multi-instance worker pool needs
 * one rate-limit view across replicas.
 */

const DEFAULT_TIERS = {
  read:  { capacity: 60, refillPerMs: 60 / 60_000 },
  chat:  { capacity: 10, refillPerMs: 10 / 60_000 },
  write: { capacity:  5, refillPerMs:  5 / 60_000 },
};

const BUCKETS = new Map();

function readEnvLimits(env) {
  // Operators can override any tier via CONSTRUCT_RATELIMIT_<TIER>=N where N
  // is requests-per-minute. Capacity = N; refill = N / 60_000.
  const out = {};
  for (const tier of Object.keys(DEFAULT_TIERS)) {
    const raw = env[`CONSTRUCT_RATELIMIT_${tier.toUpperCase()}`];
    const n = raw ? Number(raw) : null;
    out[tier] = (n && n > 0)
      ? { capacity: n, refillPerMs: n / 60_000 }
      : DEFAULT_TIERS[tier];
  }
  return out;
}

function takeFromBucket(key, tier, env) {
  const limits = readEnvLimits(env);
  const cfg = limits[tier];
  if (!cfg) return { allowed: true, retryAfterMs: 0 };

  const now = Date.now();
  const id = `${tier}:${key}`;
  const existing = BUCKETS.get(id);
  if (!existing) {
    BUCKETS.set(id, { tokens: cfg.capacity - 1, lastRefill: now });
    return { allowed: true, retryAfterMs: 0, tokensLeft: cfg.capacity - 1 };
  }
  const elapsed = now - existing.lastRefill;
  const refilled = Math.min(cfg.capacity, existing.tokens + elapsed * cfg.refillPerMs);
  if (refilled >= 1) {
    BUCKETS.set(id, { tokens: refilled - 1, lastRefill: now });
    return { allowed: true, retryAfterMs: 0, tokensLeft: refilled - 1 };
  }
  BUCKETS.set(id, { tokens: refilled, lastRefill: now });
  const retryAfterMs = Math.ceil((1 - refilled) / cfg.refillPerMs);
  return { allowed: false, retryAfterMs, tokensLeft: 0 };
}

function clientKey(req) {
  // Honour X-Forwarded-For (single-tenant deploy behind ALB), fall back to
  // the socket address. If a session cookie is present, mix it in so the
  // same IP serving multiple users yields per-user buckets.
  const xf = req.headers['x-forwarded-for'];
  const ip = (xf ? String(xf).split(',')[0] : req.socket?.remoteAddress) || 'unknown';
  const cookie = req.headers.cookie || '';
  const sessionMatch = cookie.match(/(?:^|;)\s*cx_session=([^;]+)/);
  const session = sessionMatch ? sessionMatch[1] : '';
  return `${ip}|${session}`;
}

/**
 * Apply rate limit to `req`. Returns { allowed, retryAfterMs }. When the
 * call is denied, callers should set `Retry-After` and respond 429.
 */
export function checkRateLimit(req, tier, { env = process.env, key } = {}) {
  const k = key || clientKey(req);
  return takeFromBucket(k, tier, env);
}

/**
 * Test-only — wipe every in-memory bucket so a fresh test run starts clean.
 */
export function _resetRateLimitBucketsForTests() {
  BUCKETS.clear();
}

export { DEFAULT_TIERS };
