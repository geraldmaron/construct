/**
 * tests/connectors/jira/api.test.ts — the site is where the credential is sent,
 * so the site is validated before anything rides a header to it.
 *
 * What is held here: a real Jira Cloud site resolves to its host-only https
 * origin whether or not it was written with a scheme or a trailing slash, and a
 * value crafted to smuggle another host into the origin is refused by name
 * rather than silently addressed.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { siteOrigin, readJiraCredentials, JIRA_SITE_ENV } from '../../../src/connectors/jira/api.ts';

test('a real Jira Cloud site becomes its host-only https origin', () => {
  assert.equal(siteOrigin('acme.atlassian.net'), 'https://acme.atlassian.net');
  assert.equal(siteOrigin('https://acme.atlassian.net'), 'https://acme.atlassian.net');
  assert.equal(siteOrigin('https://acme.atlassian.net/'), 'https://acme.atlassian.net');
  assert.equal(siteOrigin('http://acme.atlassian.net'), 'https://acme.atlassian.net');
});

test('a site whose host is not atlassian.net is refused', () => {
  const hostile: readonly string[] = [
    'evil.com/@acme.atlassian.net',
    'evil.com',
    'acme.atlassian.net.evil.com',
    'notatlassian.net',
    'atlassian.net',
  ];
  for (const value of hostile) {
    assert.throws(
      () => siteOrigin(value),
      /must be a Jira Cloud site/,
      `expected ${value} to be refused`,
    );
  }
});

test('the smuggled-host origin never resolves to the attacker host', () => {
  // The whole point: the resolved host is the attacker's, so it must not pass.
  assert.equal(new URL('https://evil.com/@acme.atlassian.net').hostname, 'evil.com');
  assert.throws(() => siteOrigin('evil.com/@acme.atlassian.net'), /refusing evil\.com/);
});

test('readJiraCredentials refuses a hostile site rather than returning a working origin', () => {
  assert.throws(
    () =>
      readJiraCredentials({
        [JIRA_SITE_ENV]: 'evil.com/@acme.atlassian.net',
        CONSTRUCT_JIRA_EMAIL: 'someone@example.com',
        CONSTRUCT_JIRA_API_TOKEN: 'placeholder-not-a-real-token',
      }),
    /must be a Jira Cloud site/,
  );
});

test('readJiraCredentials returns null when the environment carries no credential', () => {
  assert.equal(readJiraCredentials({}), null);
});
