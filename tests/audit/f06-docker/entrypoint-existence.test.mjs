/**
 * tests/audit/f06-docker/entrypoint-existence.red.mjs — F06 [R23] Dockerfile CMD points at a non-existent entrypoint.
 *
 * RED fixture (must FAIL against the current repo). The Dockerfile's final
 * instruction is `CMD ["node", "lib/server/index.mjs"]`, but the dashboard HTTP
 * daemon (`lib/server/`) was deleted by ADR-0039's 2026-06-25 amendment. The
 * image copies the whole source tree (`COPY . .`) minus .dockerignore exclusions,
 * yet no lib/server/index.mjs exists anywhere in that tree — so the container
 * builds successfully and then exits immediately with
 * `Error: Cannot find module '/app/lib/server/index.mjs'`.
 *
 * Parses the CMD out of the real Dockerfile, resolves the referenced path
 * against the repo root, and asserts existence. Absent today.
 *
 * Turns GREEN once the Dockerfile CMD targets a file that actually ships (a real
 * server entrypoint is restored, or the CMD is repointed at the shipped binary),
 * per CX-AUDIT-DOCKER-002 / -004.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, '../../../');
const dockerfile = path.join(repoRoot, 'Dockerfile');

// Parse the last CMD instruction in JSON-array (exec) form and return its argv.
// The Dockerfile uses `CMD ["node", "lib/server/index.mjs"]`; reading the array
// literal and JSON-parsing it keeps the assertion tracking whatever the image
// will actually exec, not a hardcoded copy of today's path.

function readCmdArgv(dockerfileText) {
  const lines = dockerfileText.split('\n');
  let lastCmd = null;
  for (const line of lines) {
    const m = line.match(/^\s*CMD\s+(\[.*\])\s*$/);
    if (m) lastCmd = m[1];
  }
  if (!lastCmd) return null;
  return JSON.parse(lastCmd);
}

test('[R23] Dockerfile CMD entrypoint must exist in the repo source tree', () => {
  // ADR-0039 degate: if the Dockerfile was removed (Docker surface degated), the
  // entrypoint requirement is satisfied — there is nothing to boot.
  if (!fs.existsSync(dockerfile)) return;

  const text = fs.readFileSync(dockerfile, 'utf8');
  const argv = readCmdArgv(text);

  assert.ok(Array.isArray(argv) && argv.length >= 2, 'could not parse a JSON-array CMD from the Dockerfile');
  assert.equal(argv[0], 'node', `expected the CMD to launch node; got ${JSON.stringify(argv[0])}`);

  const entrypointRel = argv[1];
  const entrypointAbs = path.join(repoRoot, entrypointRel);

  assert.ok(
    fs.existsSync(entrypointAbs),
    `Dockerfile CMD references ${entrypointRel}, but that file does not exist in the repo — ` +
      `the image builds but exits at boot with "Cannot find module /app/${entrypointRel}". ` +
      `lib/server/ was deleted by ADR-0039 (2026-06-25).`,
  );
});
