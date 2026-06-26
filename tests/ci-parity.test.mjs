/**
 * tests/ci-parity.test.mjs — local pre-push hooks must NOT duplicate the CI
 * lint suite. CI is the source of truth.
 *
 * Earlier revisions of this test enforced the opposite contract: every
 * `bin/construct lint:*` invocation in CI also had to appear in both
 * pre-push hooks (lib/hooks/pre-push-gate.mjs and .beads/hooks/pre-push).
 * That symmetry was the anti-pattern. Running the full CI matrix locally
 * on every push made `CONSTRUCT_SKIP_PREPUSH=1` a daily escape hatch,
 * which trained the team to ignore the gate. A gate that gets skipped
 * is not a gate.
 *
 * The inverted contract: pre-push hooks stay narrow and fast (claude/*
 * refusal, prior-CI SHA re-push check, PR body lint). Test/build/audit/
 * evals/lint live exclusively in CI, which runs in a clean container
 * and is the merge gate of record. This test guards the narrow shape
 * by failing if any `bin/construct lint:*` / `evals` / `docs:verify` /
 * `docs:update --check` invocation creeps back into either local hook.
 *
 * Escape hatch for legitimate exceptions: `# noparity` marker on the
 * invocation line (matches the prior contract's escape).
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, '..');

const CI_YAML = readFileSync(resolve(ROOT, '.github/workflows/ci.yml'), 'utf8');
const BEADS_HOOK = readFileSync(resolve(ROOT, '.beads/hooks/pre-push'), 'utf8');
const CLAUDE_HOOK = readFileSync(resolve(ROOT, 'lib/hooks/pre-push-gate.mjs'), 'utf8');

// Match invocations of `bin/construct <subcommand>` in any source flavor
// (YAML, shell, JS array). Drops lines flagged `# noparity`.

function extractInvocations(source, subcommand) {
  const out = [];
  for (const line of source.split('\n')) {
    if (line.includes('# noparity')) continue;
    const re = new RegExp(
      `bin/construct['"]?[\\s,]+['"]?${subcommand}['"]?(?:[\\s,]+['"]?--[a-z][a-z0-9-]*['"]?)*`,
      'g',
    );
    let m;
    while ((m = re.exec(line)) !== null) {
      const normalized = m[0]
        .replace(/^.*bin\/construct['"]?[\s,]+['"]?/, '')
        .replace(/['"]/g, '')
        .replace(/,/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
      out.push(normalized);
    }
  }
  return out;
}

// Subcommands that MUST NOT appear in either local pre-push hook. Each is
// heavyweight, deterministic, and fully covered by a CI job. Adding one of
// these to a local hook re-creates the doom-loop that the gate-shrinking
// work removed.

const CI_ONLY_SUBCOMMANDS = [
  'docs:update',
  'docs:verify',
  'lint:comments',
  'lint:agents',
  'lint:contracts',
  'lint:profiles',
  'lint:templates',
  'evals',
  'gates:audit',
  'doctor',
];

for (const sub of CI_ONLY_SUBCOMMANDS) {
  test(`${sub} stays in CI only — never in local pre-push hooks`, () => {
    const claude = extractInvocations(CLAUDE_HOOK, sub);
    const beads = extractInvocations(BEADS_HOOK, sub);
    assert.equal(claude.length, 0,
      `lib/hooks/pre-push-gate.mjs invokes 'bin/construct ${sub}': ${claude.join(' | ')}. ` +
      `CI is the source of truth for this check — remove it from the local hook or add # noparity.`);
    assert.equal(beads.length, 0,
      `.beads/hooks/pre-push invokes 'bin/construct ${sub}': ${beads.join(' | ')}. ` +
      `CI is the source of truth for this check — remove it from the local hook or add # noparity.`);
  });
}

test('every check stripped from local hooks is still covered by some CI job', () => {
  // Sanity check that we didn't drop a check from CI when we stripped it
  // from the local hooks. Each gated subcommand should appear in
  // .github/workflows/ci.yml in one of:
  //   - `bin/construct <sub>`   — most construct subcommands
  //   - `npm run <sub>`         — lint:profiles (script alias)
  //   - `scripts/<file>.mjs`    — lint:templates (CI runs the underlying
  //                               script directly via lint-commits-pr.mjs)
  // Exceptions: doctor (developer-facing diagnostic, not a CI gate).

  const directScriptCoverage = {
    'lint:templates': /scripts\/lint-commits-pr\.mjs/,
  };
  const ciGated = CI_ONLY_SUBCOMMANDS.filter((s) => s !== 'doctor');
  for (const sub of ciGated) {
    const binInvocations = extractInvocations(CI_YAML, sub).length;
    const npmRunPattern = new RegExp(`npm run ${sub}\\b`);
    const npmRun = npmRunPattern.test(CI_YAML);
    const direct = directScriptCoverage[sub]?.test(CI_YAML) ?? false;
    assert.ok(binInvocations > 0 || npmRun || direct,
      `CI has no invocation of '${sub}' — the local hook stopped running it ` +
      `but CI doesn't either. Add 'bin/construct ${sub}', 'npm run ${sub}', or the ` +
      `equivalent script call to .github/workflows/ci.yml.`);
  }
});
