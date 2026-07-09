/**
 * tests/hook-scan-secrets.test.mjs — secret scanner pattern coverage.
 *
 * Spawns lib/hooks/scan-secrets.mjs against fixture files and asserts that
 * each known secret format is detected (exit code 2 + the matching pattern
 * name appears in stderr) and that placeholders are not false-positives.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { describe, it, before, after } from 'node:test';
import { rmTmpDir } from './helpers/cleanup.mjs';

const HERE = path.dirname(new URL(import.meta.url).pathname);
const ROOT = path.resolve(HERE, '..');
const HOOK = path.join(ROOT, 'lib', 'hooks', 'scan-secrets.mjs');

let tmpDir;

before(() => { tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cx-secrets-')); });
after(() => { rmTmpDir(tmpDir); });

function runScanOn(content, ext = '.env') {
  const file = path.join(tmpDir, `fixture${ext}`);
  fs.writeFileSync(file, content);
  return spawnSync(process.execPath, [HOOK], {
    encoding: 'utf8',
    env: { ...process.env, TOOL_INPUT_FILE_PATH: file },
    timeout: 5000,
  });
}

describe('scan-secrets patterns', () => {
  // Fixtures are constructed at runtime from parts so no full secret-shaped
  // literal appears in committed source. This sidesteps GitHub's push-
  // protection scanner (which matches literals) while still exercising the
  // hook's regex on the runtime-assembled string.
  const z10 = '0' + '0'.repeat(9);
  const f24 = ('FAKEfake').repeat(3);
  const fixtures = [
    ['GitHub fine-grained PAT', `GITHUB_PAT=github_pat_${'TEST'.repeat(5) + 'TT'}_${'FAKE'.repeat(15)}fak`],
    ['Slack bot token', `TOKEN=${'xoxb'}-${z10}-${z10}-${f24}`],
    ['Stripe live secret', `STRIPE=${'sk_'}${'live_'}${'FAKE'.repeat(7)}`],
    ['Twilio account SID', `TWILIO_ACCOUNT_SID=${'AC'}${'0'.repeat(32)}`],
    ['SendGrid API key', `SENDGRID=${'SG'}.${'FAKE0000FAKE0000FAKE00'}.${'FAKE'.repeat(11)}fake`],
    ['JWT (signed)', `token=${'eyJ'}${'fakeFAKEfake'}.${'eyJ'}${'fakeFAKEfake'}.${'fakeFAKEfakeFAKE'}`],
    ['GCP API key', `KEY=${'AIza'}${'FAKE'.repeat(7) + 'fak0000'}`],
    ['Database URL with credentials', `DATABASE_URL=${'postgres'}${'ql'}://testuser:fakepassword@host:5432/db`],
    ['AWS session token', `AWS_TOK=${'ASIA'}${'00000000'.repeat(2)}`],
  ];

  for (const [label, sample] of fixtures) {
    it(`detects ${label}`, () => {
      const r = runScanOn(sample);
      assert.equal(r.status, 2, `expected block, got ${r.status}\nstderr: ${r.stderr}`);
      assert.ok(
        r.stderr.includes(label),
        `expected "${label}" in stderr, got: ${r.stderr}`
      );
    });
  }

  it('does not flag placeholder values', () => {
    const r = runScanOn('OPENAI_API_KEY=sk-...\nGCP=AIza<your-key>');
    assert.equal(r.status, 0, `placeholders must not block; stderr: ${r.stderr}`);
  });

  it('exits 0 when no file is set', () => {
    const r = spawnSync(process.execPath, [HOOK], {
      encoding: 'utf8',
      env: { ...process.env, TOOL_INPUT_FILE_PATH: '' },
      timeout: 5000,
    });
    assert.equal(r.status, 0);
  });
});
