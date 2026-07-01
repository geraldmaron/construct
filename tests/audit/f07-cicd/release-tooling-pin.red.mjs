/**
 * tests/audit/f07-cicd/release-tooling-pin.red.mjs — F07/R26 release-time tool-fetch proof.
 *
 * RED fixtures (must FAIL against the current release.yml). The binary build job
 * installs its build tooling at release time from the network rather than from
 * the pinned dev-dependency graph: `npm install -g esbuild` fetches the latest
 * esbuild, and `npx postject` resolves and downloads postject on demand. Both
 * pull unpinned, un-checksummed code into the job that produces the released
 * single-file binaries — a compromise of either package, or of the registry
 * resolution, lands directly in published artifacts. The release should build
 * from version-pinned dev deps (present in package-lock.json) or a checksummed
 * tool, not a dynamic global/`npx` fetch.
 *
 * Contract these encode (CX-AUDIT-CI-003): release.yml MUST NOT `npm install -g`
 * or `npx`-fetch build tooling during a release; build tools come from the
 * locked dependency graph. The assertions scan release.yml for both patterns and
 * list every offending `file:line`.
 *
 * Reads the real release.yml read-only and line-scans run-script bodies. No YAML
 * library, no network, no mutation.
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const HERE = dirname(fileURLToPath(import.meta.url));
const RELEASE_YML = join(HERE, '..', '..', '..', '.github', 'workflows', 'release.yml');

function scan(text, pattern) {
  const out = [];
  text.split('\n').forEach((line, i) => {
    if (pattern.test(line)) out.push(`release.yml:${i + 1}  ${line.trim()}`);
  });
  return out;
}

test('release.yml must not globally install build tooling (npm install -g)', () => {
  const offenders = scan(readFileSync(RELEASE_YML, 'utf8'), /npm\s+install\s+-g\b/);
  assert.deepEqual(
    offenders,
    [],
    `release.yml fetches unpinned build tooling via global install:\n${offenders.join('\n')}`,
  );
});

test('release.yml must not npx-fetch build tooling at release time', () => {
  // `npx <tool>` with no pre-existing local install resolves and downloads the
  // package on demand. Flag bare `npx <tool>` invocations in the release job.
  const offenders = scan(readFileSync(RELEASE_YML, 'utf8'), /(^|[^.\w])npx\s+\S/);
  assert.deepEqual(
    offenders,
    [],
    `release.yml resolves build tooling via npx at release time:\n${offenders.join('\n')}`,
  );
});
