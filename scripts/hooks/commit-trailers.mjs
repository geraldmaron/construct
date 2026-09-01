#!/usr/bin/env node
/**
 * commit-trailers.mjs — strips and rejects git attribution trailers on commits.
 * Construct commit messages carry the bead id in the subject line only; no
 * Co-authored-by or similar trailers belong in this repository.
 */

import { readFileSync, writeFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

/** Git attribution trailers this project refuses in commit messages. */
export const ATTRIBUTION_TRAILER =
  /^(Co-authored-by|Signed-off-by|Reviewed-by|Helped-by|Assisted-by|Reported-by):/i;

/** Remove attribution trailer lines; trim trailing blank lines. */
export function stripAttributionTrailers(message) {
  const lines = message.replace(/\r\n/g, '\n').split('\n');
  const kept = lines.filter((line) => !ATTRIBUTION_TRAILER.test(line.trim()));
  while (kept.length > 0 && kept[kept.length - 1] === '') kept.pop();
  return kept.join('\n') + (kept.length > 0 ? '\n' : '');
}

/** Every attribution trailer still present after stripping. */
export function findAttributionTrailers(message) {
  return message
    .replace(/\r\n/g, '\n')
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => ATTRIBUTION_TRAILER.test(line));
}

export function stripCommitMessageFile(path) {
  const before = readFileSync(path, 'utf8');
  const after = stripAttributionTrailers(before);
  if (after !== before) writeFileSync(path, after, 'utf8');
  return after;
}

function main(argv) {
  const mode = argv[2];
  const path = argv[3];
  if (!path) {
    process.stderr.write('commit-trailers: expected a commit message file path\n');
    process.exit(2);
  }

  if (mode === 'strip') {
    stripCommitMessageFile(path);
    return;
  }

  if (mode === 'check') {
    const message = readFileSync(path, 'utf8');
    const hits = findAttributionTrailers(message);
    if (hits.length === 0) return;
    process.stderr.write(
      'commit-trailers: blocked commit — attribution trailers are not allowed in this repo\n' +
        hits.map((line) => `  ${line}\n`).join(''),
    );
    process.exit(1);
  }

  process.stderr.write('commit-trailers: usage: strip|check <commit-msg-file>\n');
  process.exit(2);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main(process.argv);
}
