/**
 * tests/release-workflow.test.mjs — release workflow configuration guard.
 *
 * Validates .github/workflows/release.yml for known anti-patterns that cause
 * silent publish failures. These checks run on every PR so regressions are
 * caught before they can affect a tag push.
 *
 * Key failure mode protected against:
 *   npm CLI 10.x (shipped with Node 22) does not support OIDC-first auth for
 *   Trusted Publishers. It falls back to NODE_AUTH_TOKEN (github.token injected
 *   by setup-node when registry-url is set), and github.token is not a valid
 *   npm publish token — the registry returns 404. npm CLI 11.5.1+ is required
 *   (https://docs.npmjs.com/trusted-publishers). Node 24 ships with npm 11+ and
 *   npm 11 tries OIDC before any token fallback, so registry-url is safe.
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
  const nextJob = raw.slice(start + 1).search(/\n {2}[a-z][a-z0-9-]*:/);
  return nextJob === -1 ? raw.slice(start) : raw.slice(start, start + 1 + nextJob);
}

const publishSection = jobSection(yaml, 'publish');

// ── Tests ─────────────────────────────────────────────────────────────────────

test('publish job has id-token: write permission for OIDC provenance', () => {
  assert.match(yaml, /id-token:\s*write/);
});

test('publish job uses Node 24+ so npm CLI satisfies the 11.5.1+ OIDC requirement', () => {
  // npm CLI 11.5.1+ is required for Trusted Publishers OIDC. Node 22 ships with
  // npm 10.x which doesn't support OIDC-first auth. Node 24 ships with npm 11+.
  // https://docs.npmjs.com/trusted-publishers
  const setupNodeBlock = publishSection.match(/uses:\s*actions\/setup-node[\s\S]*?(?=\n {6}-|\n {2}\w)/)?.[0] ?? '';
  assert.match(
    setupNodeBlock,
    /node-version.*'?2[4-9]|node-version.*'?[3-9]\d/,
    'publish job setup-node must use node-version 24+ — npm CLI 11.5.1+ (required for OIDC Trusted Publishers) ships with Node 24',
  );
});

test('publish job verifies OIDC endpoint is available before publish', () => {
  // npm whoami always fails for OIDC Trusted Publishers (uses classic auth, not OIDC).
  // The correct check is that ACTIONS_ID_TOKEN_REQUEST_URL is set — that variable is
  // provided by the GitHub Actions OIDC runtime and is what npm publish exchanges.
  assert.match(
    publishSection,
    /ACTIONS_ID_TOKEN_REQUEST_URL/,
    'publish job must verify OIDC endpoint (ACTIONS_ID_TOKEN_REQUEST_URL) is available — ' +
    'npm whoami always fails for Trusted Publishers OIDC and should not be used',
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
  const publishStep = publishSection.match(/name:\s*Publish to npm[\s\S]*?(?=\n {6}-\s*name:|\n {2}\w|$)/)?.[0] ?? '';
  assert.doesNotMatch(
    publishStep,
    /NODE_AUTH_TOKEN:\s*\$\{\{\s*secrets\./,
    'publish step sets NODE_AUTH_TOKEN from secrets — Trusted Publishers OIDC requires no stored token',
  );
});

// The release gate routes its checks through npm scripts (thin wrappers over
// bin/construct). Either form — `npm run doctor` or a direct
// `node ./bin/construct doctor` — satisfies the guard, which tracks the gate
// running, not how the command is spelled.

test('release gate runs doctor and docs:verify', () => {
  assert.match(yaml, /construct doctor|npm run doctor/);
  assert.match(yaml, /construct docs:verify|npm run docs:verify/);
});

test('trivy-action is pinned to a specific release tag, not @master', () => {
  // If the docker job was removed (degate), trivy-action is absent — no pin required.
  if (!yaml.includes('trivy-action')) return;
  assert.doesNotMatch(yaml, /trivy-action@master/, 'trivy-action must not float on @master (supply-chain risk)');
  assert.match(yaml, /trivy-action@v?\d+\.\d+\.\d+/, 'trivy-action must be pinned to a specific version tag');
});

test('release workflow detects pre-release tags and routes the npm dist-tag', () => {
  // Pre-release tags (v1.0.5-alpha.1, v1.0.5-beta.N, v1.0.5-rc.N) must not
  // overwrite the latest dist-tag. The workflow extracts the channel from the
  // tag suffix and passes it to npm publish via --tag.
  assert.match(publishSection, /prerelease=true/, 'publish job must compute a prerelease flag from the tag');
  assert.match(publishSection, /npm publish .* --tag \$\{\{ steps\.ver\.outputs\.channel \}\}/,
    'npm publish must use --tag <channel> so pre-releases do not move latest');
});

test('homebrew tap bump is gated on stable tags (no "-" in the ref)', () => {
  const homebrewSection = jobSection(yaml, 'homebrew');
  assert.match(
    homebrewSection,
    /!contains\(github\.ref_name,\s*'-'\)/,
    'homebrew job must be gated on stable tags; pre-release should not bump the formula',
  );
});

test('docker image: latest tag is only pushed for stable releases', () => {
  // If the docker job was removed (degate), no:latest tag is pushed — requirement satisfied.
  const stableBlock = yaml.match(/Build and push \(stable[^\n]*\n[\s\S]*?cache-to: type=gha,mode=max/)?.[0] ?? '';
  if (!stableBlock) return;
  // Two build-and-push steps exist: one for stable (version + latest tags),
  // one for pre-release (version + channel tags). The stable step is gated on
  // prerelease == false; the pre-release step is gated on prerelease == true.
  // The :latest tag must only appear under the stable conditional.
  const preBlock = yaml.match(/Build and push \(prerelease[^\n]*\n[\s\S]*?cache-to: type=gha,mode=max/)?.[0] ?? '';
  assert.match(stableBlock, /construct:latest/, 'stable docker build must push :latest');
  assert.doesNotMatch(preBlock, /construct:latest/, 'pre-release docker build must NOT push :latest');
});
