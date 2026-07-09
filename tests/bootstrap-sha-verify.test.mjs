/**
 * tests/bootstrap-sha-verify.test.mjs — coverage for verify_sha256 in
 * templates/distribution/bootstrap.sh.
 *
 * The bootstrap shim is what non-Node peers use to download a single-file
 * Construct binary from GitHub Releases. SHA-256 verification of the
 * downloaded artefact against its `.sha256` sidecar is the integrity gate;
 * if it ever silently broke we would install whatever a man-in-the-middle
 * served. These tests pin the behavior: bare-hex digest works, the
 * `sha256sum -c`-style "<sha>  <filename>" line is parsed correctly,
 * mismatches and malformed inputs fail closed.
 *
 * The function is extracted from bootstrap.sh on the fly via sed so we
 * exercise the real shipped code rather than a copy.
 */

import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { describe, it, after } from 'node:test';
import { fileURLToPath } from 'node:url';
import { rmTmpDir } from './helpers/cleanup.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const BOOTSTRAP_SH = path.join(HERE, '..', 'templates', 'distribution', 'bootstrap.sh');

function sha256(content) {
  return createHash('sha256').update(content).digest('hex');
}

function runVerify(filePath, expectedDigest) {
  const script = `
    set -eu
    source <(sed -n '/^verify_sha256()/,/^}/p' "${BOOTSTRAP_SH}")
    if verify_sha256 "${filePath}" "${expectedDigest}"; then
      echo "MATCH"
    else
      echo "MISMATCH:$?"
    fi
  `;
  return spawnSync('bash', ['-c', script], { encoding: 'utf8' });
}

describe('bootstrap.sh verify_sha256', () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cx-bootstrap-sha-'));
  after(() => { rmTmpDir(tmpDir); });
  const binPath = path.join(tmpDir, 'fake-binary');
  fs.writeFileSync(binPath, 'pretend this is a construct binary');
  const realSha = sha256(fs.readFileSync(binPath));

  it('passes when the expected digest matches', () => {
    const result = runVerify(binPath, realSha);
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /MATCH/);
  });

  it('parses the `<sha>  <filename>` sha256sum -c style line', () => {
    const result = runVerify(binPath, `${realSha}  fake-binary`);
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /MATCH/);
  });

  it('fails when the digest differs by one character', () => {
    const tampered = realSha.slice(0, -1) + (realSha.endsWith('a') ? 'b' : 'a');
    const result = runVerify(binPath, tampered);
    assert.match(result.stdout, /MISMATCH/);
  });

  it('fails closed on an empty expected digest (refuses to install unverified)', () => {
    const result = runVerify(binPath, '');
    assert.match(result.stdout, /MISMATCH/);
  });

  it('fails closed on a short or malformed expected digest', () => {
    const result = runVerify(binPath, 'not-a-valid-sha');
    assert.match(result.stdout, /MISMATCH/);
  });
});

describe('bootstrap.sh syntax', () => {
  it('passes `bash -n` (no syntax errors)', () => {
    const result = spawnSync('bash', ['-n', BOOTSTRAP_SH], { encoding: 'utf8' });
    assert.equal(result.status, 0, result.stderr);
  });
});
