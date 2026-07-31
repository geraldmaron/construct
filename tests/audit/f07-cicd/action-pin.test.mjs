/**
 * tests/audit/f07-cicd/action-pin.red.mjs — F07/R25/R27 mutable-action-tag proof.
 *
 * RED fixtures (must FAIL against the current .github/workflows/*.yml). Every
 * `uses:` reference in every workflow points at a mutable tag (`@v6`,
 * `@v0.36.0`, …) rather than an immutable 40-hex commit SHA. A mutable tag lets
 * the action's owner (or anyone who compromises that repo) repoint the tag at
 * new code that then runs with this pipeline's secrets and GITHUB_TOKEN — the
 * exact tj-actions/changed-files supply-chain class. GitHub and OpenSSF both
 * require third-party actions to be pinned to a full commit SHA.
 *
 * Contract these encode: every third-party `uses:` (any owner
 * other than the first-party `actions/*` namespace) MUST be pinned to a
 * 40-hex-char commit SHA, and the audit's stated target pins first-party
 * `actions/*` to SHAs too. The first assertion is the hard gate (third-party
 * SHA pins); the second is the audit's full-coverage target (all actions).
 *
 * Reads the real workflow YAML read-only and line-scans for `uses:` — no YAML
 * library, no network, no mutation. The failure message lists every offending
 * `file:line  uses: …` so the fix can pin them one by one.
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const HERE = dirname(fileURLToPath(import.meta.url));
const WORKFLOWS_DIR = join(HERE, '..', '..', '..', '.github', 'workflows');

const SHA_PIN = /@[0-9a-f]{40}\b/;
const FIRST_PARTY = /^actions\//;

// A `uses:` value is `owner/repo[/path]@ref` or `./local-action` or
// `docker://…`. Local and docker refs are not pinnable action tags, so the
// scan only collects remote `owner/...@ref` references.
function collectUses() {
  const found = [];
  for (const file of readdirSync(WORKFLOWS_DIR).filter((f) => /\.ya?ml$/.test(f)).sort()) {
    const lines = readFileSync(join(WORKFLOWS_DIR, file), 'utf8').split('\n');
    lines.forEach((line, i) => {
      const m = line.match(/^\s*(?:-\s*)?uses:\s*(\S+)/);
      if (!m) return;
      const ref = m[1].replace(/['"]/g, '');
      if (ref.startsWith('./') || ref.startsWith('docker://')) return;
      const owner = ref.split('/')[0];
      found.push({ file, line: i + 1, ref, owner, text: line.trim() });
    });
  }
  return found;
}

test('every third-party action uses: must be pinned to a 40-hex commit SHA', () => {
  const uses = collectUses();
  assert.ok(uses.length > 0, 'no uses: references found — scan is mis-targeted');

  const offenders = uses
    .filter((u) => !FIRST_PARTY.test(u.ref))
    .filter((u) => !SHA_PIN.test(u.ref))
    .map((u) => `${u.file}:${u.line}  ${u.text}`);

  assert.deepEqual(
    offenders,
    [],
    `third-party actions pinned to mutable tags instead of commit SHAs:\n${offenders.join('\n')}`,
  );
});

test('all action uses: (incl. first-party) must be pinned to a 40-hex commit SHA', () => {
  const uses = collectUses();
  const offenders = uses
    .filter((u) => !SHA_PIN.test(u.ref))
    .map((u) => `${u.file}:${u.line}  ${u.text}`);

  assert.deepEqual(
    offenders,
    [],
    `actions pinned to mutable tags instead of commit SHAs (${offenders.length} total):\n${offenders.join('\n')}`,
  );
});
