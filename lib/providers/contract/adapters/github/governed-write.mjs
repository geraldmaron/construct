/**
 * lib/providers/contract/adapters/github/governed-write.mjs — envelope-shaped
 * GitHub write adapter.
 *
 * Wraps the CLI-backed github adapter (./index.mjs) in the provider shape
 * lib/writes/envelope.mjs expects: write(config, payload), meta.id, search().
 * Adds two behaviors the raw CLI adapter cannot provide on its own:
 *
 *   - Cross-run duplicate detection: every created issue carries a hidden
 *     idempotency marker (HTML comment) in its body. Before creating, this
 *     wrapper searches GitHub itself for an issue carrying that marker, so
 *     dedup survives across process restarts and machines, not just the
 *     local sent-log.
 *   - Secondary-rate-limit backoff: GitHub content-creation endpoints return
 *     403 with a "secondary rate limit" message (no clean HTTP Retry-After
 *     on the gh CLI transport). This wrapper retries a bounded number of
 *     times honoring the parsed retry-after, then surfaces the error rather
 *     than spinning silently — the envelope's own generic retry/backoff is
 *     bypassed here because it is not retry-after aware.
 *
 * `type: 'issue'` writes get marker + dedup treatment. `type: 'pr'` writes
 * (construct-p4cba.2) dedup by head branch instead of a body marker — GitHub
 * itself refuses a second open PR for the same head→base pair, so a branch-
 * name search before create is a natural, reliable identity key that needs
 * no synthetic marker. Other write types pass straight through to the
 * underlying adapter.
 */

import { RateLimitError } from '../../errors.mjs';

const MARKER_PREFIX = 'construct:idempotency:';

function markerFor(key) {
  return `<!-- ${MARKER_PREFIX}${key} -->`;
}

function extractMarkerKey(text) {
  const match = new RegExp(`${MARKER_PREFIX}([a-zA-Z0-9_-]+)`).exec(text || '');
  return match ? match[1] : null;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * @param {object} opts
 * @param {object} opts.ghAdapter - underlying CLI adapter (default export of ./index.mjs)
 * @param {number} [opts.maxRateLimitRetries] - bounded retry-after retries before surfacing (default 2)
 * @param {function} [opts.sleepFn] - injectable sleep for tests
 */
export function createGovernedGithubProvider({ ghAdapter, maxRateLimitRetries = 2, sleepFn = sleep } = {}) {
  if (!ghAdapter) throw new Error('createGovernedGithubProvider: ghAdapter is required');

  async function findExistingByMarker(config, { title, markerKey }) {
    const results = await ghAdapter.search(`${title} in:title`, { scope: 'issues' });
    for (const candidate of results || []) {
      const body = candidate.body ?? candidate.textMatches?.map((m) => m.fragment).join(' ') ?? '';
      const haystack = `${candidate.title ?? ''} ${body}`;
      if (extractMarkerKey(haystack) === markerKey || candidate.title === title) {
        return candidate;
      }
    }
    return null;
  }

  async function findExistingPrByHead(head) {
    const results = await ghAdapter.search(`head:${head}`, { scope: 'prs' });
    return (results || []).find((candidate) => candidate.headRefName === head) ?? null;
  }

  async function writePrWithRetry(config, payload) {
    let attempt = 0;
    for (;;) {
      try {
        return await ghAdapter.write({
          type: 'pr',
          title: payload.title,
          body: payload.body,
          head: payload.head,
          base: payload.base,
          draft: payload.draft,
        });
      } catch (err) {
        const isSecondaryRateLimit = err instanceof RateLimitError || err.status === 403;
        if (!isSecondaryRateLimit || attempt >= maxRateLimitRetries) {
          throw err;
        }
        attempt += 1;
        const retryAfterMs = (err.retryAfter ?? 60) * 1000;
        await sleepFn(retryAfterMs);
      }
    }
  }

  async function writeIssueWithRetry(config, payload, markerKey) {
    const bodyWithMarker = `${payload.body ?? ''}\n\n${markerFor(markerKey)}`;
    let attempt = 0;
    for (;;) {
      try {
        return await ghAdapter.write({
          type: 'issue',
          title: payload.title,
          body: bodyWithMarker,
          labels: payload.labels,
        });
      } catch (err) {
        const isSecondaryRateLimit = err instanceof RateLimitError || err.status === 403;
        if (!isSecondaryRateLimit || attempt >= maxRateLimitRetries) {
          throw err;
        }
        attempt += 1;
        const retryAfterMs = (err.retryAfter ?? 60) * 1000;
        await sleepFn(retryAfterMs);
      }
    }
  }

  return {
    meta: {
      id: 'github',
      displayName: 'GitHub (governed)',
      capabilities: ['write', 'search'],
      description: 'Envelope-routed GitHub writes with marker/head-branch dedup and retry-after backoff.',
    },

    async write(config, payload) {
      if (payload?.type === 'pr') {
        if (!payload.title) throw new Error('github governed write: payload.title is required for type "pr"');
        if (!payload.head) throw new Error('github governed write: payload.head is required for type "pr"');

        const existing = await findExistingPrByHead(payload.head);
        if (existing) {
          return {
            type: 'pr-duplicate',
            number: existing.number,
            url: existing.url,
            linkback: existing.url,
          };
        }

        return writePrWithRetry(config, payload);
      }

      if (payload?.type !== 'issue') {
        return ghAdapter.write(payload);
      }
      if (!payload.title) throw new Error('github governed write: payload.title is required for type "issue"');

      const markerKey = payload.idempotencyKey || payload.title;
      const existing = await findExistingByMarker(config, { title: payload.title, markerKey });
      if (existing) {
        return {
          type: 'issue-duplicate',
          id: existing.number ?? existing.id,
          number: existing.number,
          url: existing.url,
          linkback: existing.url,
        };
      }

      return writeIssueWithRetry(config, payload, markerKey);
    },

    async search(config, query) {
      return ghAdapter.search(query, { scope: 'issues' });
    },
  };
}

export default createGovernedGithubProvider;
