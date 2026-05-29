/**
 * tests/ci-parity.test.mjs — local pre-push gate must run the same checks
 * as the CI lint suite, with the same flags.
 *
 * The failure class this guards against: a developer edits ONE of
 *   - .github/workflows/ci.yml (CI surface)
 *   - .beads/hooks/pre-push (git pre-push hook)
 *   - lib/hooks/pre-push-gate.mjs (Claude Code PreToolUse Bash hook)
 * and forgets the other two. Result: local gates go green, the CI lint
 * suite goes red after every push, and the team trains itself to ignore
 * red CI because "it'll fix itself on the next try."
 *
 * The dashboard-bundle drift step in particular bit us twice in one
 * branch: once when the local check ran without a build prerequisite
 * (false-clean locally, real-fail in CI) and once when CI was edited to
 * build with the wrong script (`build:next` instead of `build`). Both
 * would have been caught here.
 *
 * Add new parity assertions to this file every time a new lint check is
 * wired into the CI lint suite. Escape hatch for legitimate divergence: a
 * `# noparity` marker on the same line lets a particular invocation opt
 * out (e.g. a CI-only doctor check that can't run pre-push).
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

// Extract every `bin/construct <subcommand> <--flag ...>` invocation
// from a source blob. Requires the `bin/construct` prefix so error-message
// references like 'Run construct docs:update' (no flags, inside a string)
// don't get counted as invocations. Strips quotes and commas so the YAML
// `'--check'`, shell `--check`, and JS array `'--check'` forms all
// normalize to the same string. Drops lines marked `# noparity`.

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

test('CI lint suite invokes bin/construct dashboard:sync --build', () => {
  // The asymmetry contract: CI runs `dashboard:sync --build` standalone
  // because it has no shared test runner that builds the dashboard for it.
  // Local gates intentionally do NOT invoke dashboard:sync directly —
  // `npm test` (which both local gates run) includes
  // tests/functional/dashboard-build.functional.test.mjs, which already
  // does the same build end-to-end. Running it twice in the same gate
  // races on apps/dashboard/.next/. This test enforces:
  //   - CI invocation is exactly `dashboard:sync --build` (not --check)
  //   - dashboard-build.functional.test.mjs exists (the load-bearing
  //     coverage that lets local gates skip the standalone invocation)

  const ci = extractInvocations(CI_YAML, 'dashboard:sync');
  assert.ok(ci.length > 0, 'CI lint suite must invoke bin/construct dashboard:sync at least once');
  assert.deepEqual(ci, ['dashboard:sync --build'],
    `CI must invoke 'dashboard:sync --build' (found: ${ci.join(' | ')}). ` +
    `Using --check alone fails on fresh checkouts because lib/server/static/ is gitignored.`);

  const dashboardBuildTest = resolve(ROOT, 'tests/functional/dashboard-build.functional.test.mjs');
  assert.ok(
    readFileSync(dashboardBuildTest, 'utf8').includes('next build'),
    'tests/functional/dashboard-build.functional.test.mjs must exist and run next build — ' +
    'it is the load-bearing local-gate coverage that lets `npm test` substitute for ' +
    'an explicit dashboard:sync invocation in the pre-push gates.',
  );
});

test('docs:update --check is wired into CI lint suite and both local pre-push gates', () => {
  // Weaker assertion than dashboard:sync because lib/hooks/pre-push-gate.mjs
  // has an auto-fix path that re-runs `docs:update` (no flag) on drift then
  // `docs:update --check` again — a legitimate divergence from CI. We only
  // assert that the gating `--check` invocation appears in all three.

  const wanted = 'docs:update --check';
  const sources = {
    ci: CI_YAML,
    beads: BEADS_HOOK,
    claude: CLAUDE_HOOK,
  };
  for (const [name, source] of Object.entries(sources)) {
    const invocations = extractInvocations(source, 'docs:update');
    assert.ok(invocations.includes(wanted),
      `${name} must invoke 'bin/construct ${wanted}' (found: ${invocations.join(' | ') || 'none'})`);
  }
});
