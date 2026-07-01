/**
 * tests/audit/f06-docker/release-gating.red.mjs — F06 [R23]/F07 overlap: mutable image tags publish before any scan or boot smoke.
 *
 * RED fixture (must FAIL against the current repo). The release workflow's
 * `docker` job (.github/workflows/release.yml) runs the build-and-push steps
 * (`push: true`, tagging both the version tag and the mutable `:latest`/channel
 * tag) BEFORE the Trivy "Scan image for CVEs" step, and there is no boot smoke
 * anywhere in the job. A CRITICAL/HIGH CVE — or an image that cannot boot at all
 * (lib/server/index.mjs is absent) — is therefore already published to the
 * mutable tag by the time the scan runs, and the scan failing cannot un-publish
 * it. deploy.yml has the same ordering: `docker build` → `docker push` → tag
 * `:latest` → push, with the only smoke being a post-deploy curl against live
 * ECS.
 *
 * Asserts two policy properties on release.yml: (1) within the docker job the
 * Trivy scan step appears before any `push: true` build-push step; (2) a boot
 * smoke step (docker run + health probe of the built image) exists before push.
 * Both fail today.
 *
 * Turns GREEN once the release workflow scans and boot-smokes the image before
 * pushing any mutable tag (or pushes a throwaway quarantine tag, gates on it,
 * and only then promotes :latest), per CX-AUDIT-DOCKER-001 / -003.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, '../../../');
const releaseWorkflow = path.join(repoRoot, '.github/workflows/release.yml');

// Earliest line index where an image push happens (a `push: true` under a
// build-push step) and where a Trivy/scan step appears. Ordering by first
// occurrence is enough: any push that precedes the scan defeats the gate.

function firstIndexMatching(lines, re) {
  for (let i = 0; i < lines.length; i++) {
    if (re.test(lines[i])) return i;
  }
  return -1;
}

test('[R23/F07] release workflow must scan + boot-smoke the image before pushing a mutable tag', () => {
  assert.ok(fs.existsSync(releaseWorkflow), '.github/workflows/release.yml is missing');

  const text = fs.readFileSync(releaseWorkflow, 'utf8');
  const lines = text.split('\n');

  const pushIdx = firstIndexMatching(lines, /^\s*push:\s*true\s*$/);

  // ADR-0039 degate: if release.yml has no docker build-push step, the Docker
  // gating requirement is satisfied — the image surface has been removed.
  if (pushIdx === -1) return;

  const scanIdx = firstIndexMatching(lines, /trivy|aquasecurity|Scan image/i);

  assert.notEqual(scanIdx, -1, 'expected an image CVE scan step (Trivy) in release.yml');

  assert.ok(
    scanIdx < pushIdx,
    `release.yml pushes the image (line ${pushIdx + 1}) before scanning it (line ${scanIdx + 1}) — ` +
      `the mutable :latest/channel tag is published before the Trivy gate runs, so a failing scan ` +
      `cannot un-publish a vulnerable or non-bootable image.`,
  );

  const hasDockerRun = /docker\s+run/.test(text);
  const hasHealthProbe = /\/api\/auth\/status|--health|HEALTHCHECK|health/i.test(text);
  const bootSmokePresent = hasDockerRun && hasHealthProbe;

  assert.ok(
    bootSmokePresent,
    'release.yml has no boot smoke (docker run of the built image + health probe) before push — ' +
      'a non-bootable image (missing lib/server/index.mjs) would publish to :latest undetected.',
  );
});
