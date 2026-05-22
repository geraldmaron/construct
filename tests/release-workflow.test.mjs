/**
 * tests/release-workflow.test.mjs — release workflow configuration guard.
 *
 * Validates .github/workflows/release.yml for known anti-patterns that cause
 * silent publish failures. These checks run on every PR so regressions are
 * caught before they can affect a tag push.
 *
 * Key failure mode protected against:
 *   setup-node@v6 automatically sets NODE_AUTH_TOKEN=github.token when
 *   registry-url is configured without an explicit node-auth-token. A GitHub
 *   token is not a valid npm token — the npm registry returns 404. The fix is
 *   to omit registry-url from the publish job's setup-node step and configure
 *   the registry separately, letting npm use OIDC Trusted Publishers natively.
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const yaml = readFileSync(resolve(root, '.github/workflows/release.yml'), 'utf8');

// ── Helpers ───────────────────────────────────────────────────────────────────

// Extract from the first occurrence of a top-level job key to the next one.
// Top-level job keys are at exactly 2-space indent with no deeper indentation
// on the same line — matched as `\n  word:` where word uses only [a-z0-9-].
function jobSection(raw, jobName) {
  const start = raw.indexOf(`\n  ${jobName}:`);
  if (start === -1) return '';
  const nextJob = raw.slice(start + 1).search(/\n  [a-z][a-z0-9-]*:/);
  return nextJob === -1 ? raw.slice(start) : raw.slice(start, start + 1 + nextJob);
}

const publishSection = jobSection(yaml, 'publish');

// ── Tests ─────────────────────────────────────────────────────────────────────

test('publish job has id-token: write permission for OIDC provenance', () => {
  assert.match(yaml, /id-token:\s*write/);
});

test('publish job setup-node does not use registry-url without explicit node-auth-token', () => {
  // setup-node@v6 injects github.token as NODE_AUTH_TOKEN when registry-url is
  // set and no node-auth-token is passed. github.token is not a valid npm token.
  const setupNodeBlock = publishSection.match(/uses:\s*actions\/setup-node[\s\S]*?(?=\n      -|\n  \w)/)?.[0] ?? '';
  const hasRegistryUrl = /registry-url/.test(setupNodeBlock);
  const hasExplicitToken = /node-auth-token/.test(setupNodeBlock);
  assert.ok(
    !hasRegistryUrl || hasExplicitToken,
    'setup-node in publish job uses registry-url without node-auth-token — ' +
    'setup-node@v6 will inject github.token as NODE_AUTH_TOKEN, breaking npm OIDC auth. ' +
    'Either remove registry-url (configure registry separately) or pass node-auth-token explicitly.',
  );
});

test('publish job has npm whoami verification step before publish', () => {
  assert.match(
    publishSection,
    /npm whoami/,
    'publish job must run `npm whoami` before packaging to fail fast on auth errors',
  );
});

test('publish job uses --provenance flag for attestation', () => {
  assert.match(publishSection, /npm publish.*--provenance/);
});

test('publish job uses --access public for scoped package', () => {
  assert.match(publishSection, /npm publish.*--access public/);
});

test('publish job does not set NODE_AUTH_TOKEN to a secret', () => {
  // NODE_AUTH_TOKEN must not be set to any secret in the publish step —
  // Trusted Publishers OIDC handles auth without a stored token.
  const publishStep = publishSection.match(/name:\s*Publish to npm[\s\S]*?(?=\n      -\s*name:|\n  \w|$)/)?.[0] ?? '';
  assert.doesNotMatch(
    publishStep,
    /NODE_AUTH_TOKEN:\s*\$\{\{\s*secrets\./,
    'publish step sets NODE_AUTH_TOKEN from secrets — Trusted Publishers OIDC requires no stored token',
  );
});

test('release gate runs construct doctor and docs:verify', () => {
  assert.match(yaml, /construct doctor/);
  assert.match(yaml, /construct docs:verify/);
});

test('trivy-action is pinned to a specific release tag, not @master', () => {
  assert.doesNotMatch(yaml, /trivy-action@master/, 'trivy-action must not float on @master (supply-chain risk)');
  assert.match(yaml, /trivy-action@v?\d+\.\d+\.\d+/, 'trivy-action must be pinned to a specific version tag');
});
