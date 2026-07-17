/**
 * tests/writes/github.functional.test.mjs — GitHub writes routed through the
 * governed write envelope (LMCP-J5).
 *
 * Uses a fake `gh`-shaped adapter (no real network, no real gh CLI spawn) to
 * validate the two acceptance behaviors: cross-run duplicate detection via
 * issue search + idempotency marker, and secondary-rate-limit (403 +
 * retry-after) handling that retries then surfaces rather than spinning.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { writeWithEnvelope } from '../../lib/writes/envelope.mjs';
import { WriteSentLog } from '../../lib/writes/sent-log.mjs';
import { createGovernedGithubProvider } from '../../lib/providers/contract/adapters/github/governed-write.mjs';
import { RateLimitError } from '../../lib/providers/contract/errors.mjs';

/**
 * Fake GitHub CLI adapter — mirrors the shape of
 * lib/providers/contract/adapters/github/index.mjs's write()/search(), but
 * holds issues in memory and never spawns a process.
 */
function makeFakeGhAdapter({ rateLimitedAttempts = 0, retryAfterSeconds = 1 } = {}) {
  const issues = [];
  const prs = [];
  let nextNumber = 1;
  let nextPrNumber = 1;
  let callsSeen = 0;
  let rateLimitCallsRemaining = rateLimitedAttempts;

  return {
    issues,
    prs,
    callCount: () => callsSeen,
    async write(item) {
      callsSeen += 1;

      if (item.type === 'pr') {
        if (rateLimitCallsRemaining > 0) {
          rateLimitCallsRemaining -= 1;
          throw new RateLimitError('secondary rate limit exceeded', {
            provider: 'github',
            retryAfter: retryAfterSeconds,
          });
        }
        const number = nextPrNumber++;
        const url = `https://github.com/test-owner/test-repo/pull/${number}`;
        prs.push({ number, title: item.title, body: item.body, headRefName: item.head, baseRefName: item.base ?? 'main', url });
        return { type: 'pr-created', url };
      }

      if (item.type !== 'issue') throw new Error(`unsupported type: ${item.type}`);

      if (rateLimitCallsRemaining > 0) {
        rateLimitCallsRemaining -= 1;
        throw new RateLimitError('secondary rate limit exceeded', {
          provider: 'github',
          retryAfter: retryAfterSeconds,
        });
      }

      const number = nextNumber++;
      const url = `https://github.com/test-owner/test-repo/issues/${number}`;
      issues.push({ number, title: item.title, body: item.body, url });
      return { type: 'issue-created', url };
    },
    async search(query, opts = {}) {
      if (opts.scope === 'prs') {
        const headMatch = /^head:(.*)$/.exec(query);
        const head = headMatch ? headMatch[1] : query;
        return prs
          .filter((p) => p.headRefName === head)
          .map((p) => ({ number: p.number, title: p.title, headRefName: p.headRefName, baseRefName: p.baseRefName, url: p.url }));
      }
      const titleMatch = /^(.*) in:title$/.exec(query);
      const titleNeedle = titleMatch ? titleMatch[1] : query;
      return issues
        .filter((i) => i.title === titleNeedle || (i.body || '').includes(titleNeedle))
        .map((i) => ({ number: i.number, title: i.title, body: i.body, url: i.url }));
    },
  };
}

describe('GitHub writes through the governed envelope', () => {
  it('duplicate submission yields a linkback to the existing issue, not a new one', async () => {
    const ghAdapter = makeFakeGhAdapter();
    const provider = createGovernedGithubProvider({ ghAdapter });
    const sentLog = new WriteSentLog();

    const payload = { type: 'issue', title: 'Flaky test in CI', body: 'Investigate flake.' };

    const first = await writeWithEnvelope({
      provider, config: {}, sentLog,
      payload: { ...payload, idempotencyKey: 'flaky-ci-1' },
      idempotencyKey: 'run-1-flaky-ci',
    });
    assert.equal(first.status, 'sent');
    assert.equal(ghAdapter.callCount(), 1);
    assert.equal(ghAdapter.issues.length, 1);

    // Simulate a second, independent run (fresh sent-log — cross-run/cross-process)
    // that submits the identical issue again. Local idempotency-key dedup is
    // bypassed on purpose so the assertion proves GitHub-side search dedup,
    // not just sent-log replay.
    const freshSentLog = new WriteSentLog();
    const second = await writeWithEnvelope({
      provider, config: {}, sentLog: freshSentLog,
      payload: { ...payload, idempotencyKey: 'flaky-ci-1' },
      idempotencyKey: 'run-2-flaky-ci',
    });

    assert.equal(second.status, 'sent');
    assert.equal(ghAdapter.issues.length, 1, 'no second issue should be created on GitHub');
    assert.equal(second.envelope.result.type, 'issue-duplicate');
    assert.equal(second.envelope.result.linkback, ghAdapter.issues[0].url);
    assert.equal(second.envelope.externalUrl, ghAdapter.issues[0].url);
  });

  it('creates distinct issues for distinct titles', async () => {
    const ghAdapter = makeFakeGhAdapter();
    const provider = createGovernedGithubProvider({ ghAdapter });

    await writeWithEnvelope({
      provider, config: {},
      payload: { type: 'issue', title: 'Bug A', body: 'a', idempotencyKey: 'bug-a' },
    });
    await writeWithEnvelope({
      provider, config: {},
      payload: { type: 'issue', title: 'Bug B', body: 'b', idempotencyKey: 'bug-b' },
    });

    assert.equal(ghAdapter.issues.length, 2);
  });

  it('secondary-rate-limit: retries per retry-after then succeeds', async () => {
    const ghAdapter = makeFakeGhAdapter({ rateLimitedAttempts: 2, retryAfterSeconds: 1 });
    const waits = [];
    const provider = createGovernedGithubProvider({
      ghAdapter,
      maxRateLimitRetries: 2,
      sleepFn: async (ms) => { waits.push(ms); },
    });

    const result = await writeWithEnvelope({
      provider, config: {},
      payload: { type: 'issue', title: 'Rate limited issue', body: 'body', idempotencyKey: 'rl-1' },
    });

    assert.equal(result.status, 'sent');
    assert.deepEqual(waits, [1000, 1000], 'each retry should wait exactly retry-after ms');
    assert.equal(ghAdapter.callCount(), 3, 'two rate-limited attempts + one success');
  });

  it('secondary-rate-limit: exhausting retries surfaces the error, does not spin silently', async () => {
    const ghAdapter = makeFakeGhAdapter({ rateLimitedAttempts: 10, retryAfterSeconds: 2 });
    const waits = [];
    const provider = createGovernedGithubProvider({
      ghAdapter,
      maxRateLimitRetries: 2,
      sleepFn: async (ms) => { waits.push(ms); },
    });

    const result = await writeWithEnvelope({
      provider, config: {},
      payload: { type: 'issue', title: 'Persistently limited issue', body: 'body', idempotencyKey: 'rl-2' },
      maxRetries: 1,
    });

    assert.equal(result.status, 'error');
    assert.match(result.envelope.error, /secondary rate limit/i);
    assert.equal(waits.length, 2, 'bounded retries: does not retry forever');
    assert.equal(ghAdapter.callCount(), 3, 'initial attempt + 2 bounded retries, then surfaced');
  });

  it('audit trail: sent-log records the final linkback for a successful issue write', async () => {
    const ghAdapter = makeFakeGhAdapter();
    const provider = createGovernedGithubProvider({ ghAdapter });
    const sentLog = new WriteSentLog();

    await writeWithEnvelope({
      provider, config: {}, sentLog,
      payload: { type: 'issue', title: 'Audited issue', body: 'body', idempotencyKey: 'audit-1' },
      idempotencyKey: 'audit-key-1',
    });

    const record = sentLog.findByIdempotencyKey('audit-key-1');
    assert.equal(record.status, 'sent');
    assert.ok(record.externalUrl.startsWith('https://github.com/'));
  });
});

describe('GitHub PR writes through the governed envelope (head-branch dedup)', () => {
  it('creates a PR for a new head branch', async () => {
    const ghAdapter = makeFakeGhAdapter();
    const provider = createGovernedGithubProvider({ ghAdapter });

    const result = await writeWithEnvelope({
      provider, config: {},
      payload: { type: 'pr', title: 'Add feature X', body: 'desc', head: 'feature-x', base: 'main' },
    });

    assert.equal(result.status, 'sent');
    assert.equal(ghAdapter.prs.length, 1);
    assert.equal(result.envelope.result.type, 'pr-created');
  });

  it('a second PR for the same head branch yields a linkback, not a new PR', async () => {
    const ghAdapter = makeFakeGhAdapter();
    const provider = createGovernedGithubProvider({ ghAdapter });
    const payload = { type: 'pr', title: 'Add feature X', body: 'desc', head: 'feature-x', base: 'main' };

    const first = await writeWithEnvelope({ provider, config: {}, sentLog: new WriteSentLog(), payload, idempotencyKey: 'run-1' });
    assert.equal(ghAdapter.prs.length, 1);

    // Fresh sent-log simulates a second, independent run — proves GitHub-side
    // head-branch dedup, not just local idempotency-key replay.
    const second = await writeWithEnvelope({ provider, config: {}, sentLog: new WriteSentLog(), payload, idempotencyKey: 'run-2' });

    assert.equal(second.status, 'sent');
    assert.equal(ghAdapter.prs.length, 1, 'no second PR should be created on GitHub');
    assert.equal(second.envelope.result.type, 'pr-duplicate');
    assert.equal(second.envelope.result.linkback, first.envelope.result.url);
  });

  it('distinct head branches create distinct PRs', async () => {
    const ghAdapter = makeFakeGhAdapter();
    const provider = createGovernedGithubProvider({ ghAdapter });

    await writeWithEnvelope({ provider, config: {}, payload: { type: 'pr', title: 'A', head: 'branch-a', idempotencyKey: 'a' } });
    await writeWithEnvelope({ provider, config: {}, payload: { type: 'pr', title: 'B', head: 'branch-b', idempotencyKey: 'b' } });

    assert.equal(ghAdapter.prs.length, 2);
  });

  it('requires title and head', async () => {
    const provider = createGovernedGithubProvider({ ghAdapter: makeFakeGhAdapter() });
    await assert.rejects(() => provider.write({}, { type: 'pr', head: 'x' }), /title is required/);
    await assert.rejects(() => provider.write({}, { type: 'pr', title: 'x' }), /head is required/);
  });

  it('secondary-rate-limit on PR create retries then succeeds', async () => {
    const ghAdapter = makeFakeGhAdapter({ rateLimitedAttempts: 1, retryAfterSeconds: 1 });
    const waits = [];
    const provider = createGovernedGithubProvider({ ghAdapter, sleepFn: async (ms) => { waits.push(ms); } });

    const result = await writeWithEnvelope({
      provider, config: {},
      payload: { type: 'pr', title: 'Retried PR', head: 'retry-branch' },
    });

    assert.equal(result.status, 'sent');
    assert.equal(waits.length, 1);
    assert.equal(ghAdapter.prs.length, 1);
  });
});
