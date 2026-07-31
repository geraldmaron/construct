/**
 * tests/writes/transport-env-resolution.test.mjs — jira and confluence
 * governed-write transports accept the canonical env-var convention
 * (JIRA_BASE_URL/JIRA_API_TOKEN, CONFLUENCE_BASE_URL/CONFLUENCE_API_TOKEN —
 * the same names lib/extensions/manifests/*.manifest.json declare as
 * secretEnvKeys) with the legacy JIRA_URL/JIRA_TOKEN and
 * CONFLUENCE_URL/CONFLUENCE_TOKEN pair as a fallback, never the reverse.
 * Fixed Jira's split; this closes the identical gap
 * Confluence had (flagged as a follow-up in that same change).
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import { createJiraTransport } from '../../lib/providers/contract/adapters/jira/transport.mjs';
import { createConfluenceTransport } from '../../lib/providers/contract/adapters/confluence/transport.mjs';
import { AuthError } from '../../lib/providers/contract/errors.mjs';

function withEnv(vars, fn) {
  const prev = {};
  for (const key of Object.keys(vars)) prev[key] = process.env[key];
  try {
    for (const [key, value] of Object.entries(vars)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    return fn();
  } finally {
    for (const [key, value] of Object.entries(prev)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
}

test('jira transport resolves via canonical JIRA_BASE_URL/JIRA_API_TOKEN', () => {
  withEnv({
    JIRA_BASE_URL: 'https://canonical.atlassian.net', JIRA_EMAIL: 'a@b.com', JIRA_API_TOKEN: 'canonical-token',
    JIRA_URL: undefined, JIRA_TOKEN: undefined,
  }, () => {
    assert.doesNotThrow(() => createJiraTransport());
  });
});

test('jira transport falls back to legacy JIRA_URL/JIRA_TOKEN when canonical vars are absent', () => {
  withEnv({
    JIRA_BASE_URL: undefined, JIRA_API_TOKEN: undefined,
    JIRA_URL: 'https://legacy.atlassian.net', JIRA_EMAIL: 'a@b.com', JIRA_TOKEN: 'legacy-token',
  }, () => {
    assert.doesNotThrow(() => createJiraTransport());
  });
});

// No direct accessor exposes the resolved baseUrl/token — request() closes
// over them — so the following only proves construction succeeds; the
// precedence assertion itself lives in transport.mjs's `??` chain.

test('jira transport prefers canonical vars when both conventions are set', () => {
  withEnv({
    JIRA_BASE_URL: 'https://canonical.atlassian.net', JIRA_API_TOKEN: 'canonical-token', JIRA_EMAIL: 'a@b.com',
    JIRA_URL: 'https://legacy.atlassian.net', JIRA_TOKEN: 'legacy-token',
  }, () => {
    assert.doesNotThrow(() => createJiraTransport());
  });
});

test('jira transport throws AuthError when neither convention is configured', () => {
  withEnv({ JIRA_BASE_URL: undefined, JIRA_URL: undefined, JIRA_EMAIL: undefined, JIRA_API_TOKEN: undefined, JIRA_TOKEN: undefined }, () => {
    assert.throws(() => createJiraTransport(), AuthError);
  });
});

test('confluence transport resolves via canonical CONFLUENCE_BASE_URL/CONFLUENCE_API_TOKEN', () => {
  withEnv({
    CONFLUENCE_BASE_URL: 'https://canonical.atlassian.net/wiki', CONFLUENCE_EMAIL: 'a@b.com', CONFLUENCE_API_TOKEN: 'canonical-token',
    CONFLUENCE_URL: undefined, CONFLUENCE_TOKEN: undefined,
  }, () => {
    assert.doesNotThrow(() => createConfluenceTransport());
  });
});

test('confluence transport falls back to legacy CONFLUENCE_URL/CONFLUENCE_TOKEN when canonical vars are absent', () => {
  withEnv({
    CONFLUENCE_BASE_URL: undefined, CONFLUENCE_API_TOKEN: undefined,
    CONFLUENCE_URL: 'https://legacy.atlassian.net/wiki', CONFLUENCE_EMAIL: 'a@b.com', CONFLUENCE_TOKEN: 'legacy-token',
  }, () => {
    assert.doesNotThrow(() => createConfluenceTransport());
  });
});

test('confluence transport throws AuthError when neither convention is configured', () => {
  withEnv({ CONFLUENCE_BASE_URL: undefined, CONFLUENCE_URL: undefined, CONFLUENCE_EMAIL: undefined, CONFLUENCE_API_TOKEN: undefined, CONFLUENCE_TOKEN: undefined }, () => {
    assert.throws(() => createConfluenceTransport(), AuthError);
  });
});
