#!/usr/bin/env node
/**
 * lint-action-pins.mjs — every `uses:` in a workflow under .github/workflows/
 * names a full 40-hex commit SHA, never a tag or branch.
 *
 * A tag like `@v4` is mutable: whoever controls the action's repository can
 * retag it at any moment to point at a different commit, and the next run
 * silently executes whatever that commit contains. The release workflow
 * carries `id-token: write` and publishes with `--provenance`, so a retagged
 * action there would publish a backdoored package under a valid attestation
 * — the provenance would be honest about a supply chain that was not. A
 * commit SHA has no such mutability: the same 40 hex characters always name
 * the same tree.
 *
 * `docker://` and local `./`-relative actions are exempt: a digest-pinned
 * image is its own immutable reference, and a local action is checked out
 * with the repository itself, so there is nothing external to retag.
 */

import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

const SCOPE = '.github/workflows';

const SHA_PIN = /^[0-9a-f]{40}$/;

/**
 * Every `uses:` line in `text` that does not pin to a 40-hex commit SHA, each
 * with its 1-based line number and the reference it named instead.
 */
export function violationsIn(relPath, text) {
  const violations = [];
  const lines = text.split('\n');
  lines.forEach((line, i) => {
    const match = /^\s*-?\s*uses:\s*(\S+)\s*$/.exec(line);
    if (!match) return;
    const ref = match[1];
    if (ref.startsWith('docker://') || ref.startsWith('./') || ref.startsWith('../')) return;
    const at = ref.lastIndexOf('@');
    const version = at === -1 ? '' : ref.slice(at + 1);
    if (SHA_PIN.test(version)) return;
    violations.push({ relPath, line: i + 1, ref });
  });
  return violations;
}

/** Every tracked-or-untracked-but-not-ignored workflow file under SCOPE. */
function lintableFiles() {
  const out = execFileSync(
    'git',
    ['ls-files', '--cached', '--others', '--exclude-standard', `${SCOPE}/`],
    { encoding: 'utf8' },
  );
  return [...new Set(out.split('\n').filter(Boolean))].filter(
    (f) => f.endsWith('.yml') || f.endsWith('.yaml'),
  );
}

function main() {
  let violations = 0;
  for (const relPath of lintableFiles()) {
    const text = readFileSync(relPath, 'utf8');
    for (const v of violationsIn(relPath, text)) {
      violations += 1;
      process.stderr.write(
        `action-pins: ${v.relPath}:${v.line}: "${v.ref}" is not pinned to a commit SHA — ` +
          'a tag or branch is mutable, and this workflow needs to run exactly the code it was reviewed against. ' +
          'Pin as owner/action@<40-hex-sha> # vX.Y.Z\n',
      );
    }
  }
  if (violations > 0) {
    process.stderr.write(
      `\n${violations} action-pins violation(s). Every third-party action must be pinned to a commit SHA, not a movable tag.\n`,
    );
    process.exit(1);
  }
  process.stdout.write('lint-action-pins: clean\n');
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}
