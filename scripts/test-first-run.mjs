#!/usr/bin/env node
/**
 * test-first-run.mjs — the cheap first-run mechanism/surface subset.
 *
 * Ordinary CI runs this instead of the full suite. The full gate (npm test,
 * read-only HOME, packaged-install smoke) stays on workflow_dispatch and on
 * the release-tag workflow. This subset is not optional: a first-run
 * regression must fail a push, not wait for a manual dispatch.
 *
 * Locked cases — the mechanism, not a phrase catalog and not a namer:
 *   - Host in session: the host infers. Two surfaces only — session
 *     dispatch or inbox. The keyword map is not consulted. Empty fake
 *     staff from keywords is a fail.
 *   - No hardcoded sentence → domain ID.
 *   - First construct command in the walkthrough is not doctor / status / help.
 *
 * Files that have not landed yet are skipped; files that exist are run.
 * An empty run is a failure — the check is not optional.
 */

import { existsSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';

const FILES = [
  'tests/cli/first-run-surface.test.ts',
  'tests/cli/first-run.test.ts',
  'tests/cli/first-run-ground.test.ts',
  'tests/cli/hear.test.ts',
  'tests/cli/session-dispatch.test.ts',
  'tests/cli/ambient-dispatch.test.ts',
  'tests/cli/init.test.ts',
  'tests/cli/status.test.ts',
  'tests/cli/staff.test.ts',
  'tests/cli/work-dispatch-scope.test.ts',
  'tests/cli/help-and-flags.test.ts',
  'tests/hosts/mcp/projection.test.ts',
  'tests/kernel/staffing/profile.test.ts',
];

function main() {
  const present = FILES.filter((file) => existsSync(file));
  const missing = FILES.filter((file) => !existsSync(file));
  if (present.length === 0) {
    process.stderr.write(
      'test-first-run: no first-run staffing/surface files found — the check is not optional\n',
    );
    process.exit(1);
  }
  for (const file of missing) {
    process.stderr.write(`test-first-run: skip (not in this tree) ${file}\n`);
  }
  const result = spawnSync(process.execPath, ['--test', ...present], {
    stdio: 'inherit',
  });
  if (result.error) {
    process.stderr.write(`test-first-run: ${result.error.message}\n`);
    process.exit(1);
  }
  process.exit(result.status === null ? 1 : result.status);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}
