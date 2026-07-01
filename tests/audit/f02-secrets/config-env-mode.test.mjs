/**
 * tests/audit/f02-secrets/config-env-mode.red.mjs — F02 [R13] config.env file-mode contract.
 *
 * Regression guard for CX-AUDIT-SECRETS-003. config.env can hold a plaintext API key,
 * so writeEnvValues (lib/env-config.mjs) creates it with mode 0600 and re-applies 0600
 * on every rewrite — a credential file is never group/world readable, regardless of
 * which caller writes it. Two properties are pinned: a fresh write is 0600, and a
 * rewrite tightens a pre-existing 0644 file rather than inheriting the loose inode mode.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { writeEnvValues } from '../../../lib/env-config.mjs';

// Mode is meaningful only on POSIX; on Windows the bits do not map to the same access
// semantics, so the contract is asserted where it applies.

const POSIX = process.platform !== 'win32';

test('[R13] writeEnvValues creates config.env with 0600 (no group/world read)', { skip: !POSIX }, (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cx-f02-mode-create-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));

  const file = path.join(dir, 'config.env');
  writeEnvValues(file, { ANTHROPIC_API_KEY: 'sk-not-a-real-key-zzz' });

  const mode = fs.statSync(file).mode & 0o777;
  assert.equal(
    mode & 0o077,
    0,
    `config.env is group/world-accessible (mode ${mode.toString(8)}); a credential file must be 0600`,
  );
});

test('[R13] writeEnvValues tightens a pre-existing world-readable config.env on rewrite', { skip: !POSIX }, (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cx-f02-mode-rewrite-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));

  // A config.env left group/world-readable by an older write (or by a caller that
  // skipped the post-write chmod). fs.writeFileSync truncates an existing inode and
  // keeps its mode, so a plain rewrite does NOT self-heal the loose bits — the contract
  // must actively re-apply 0600 every time it persists the credential file.
  const file = path.join(dir, 'config.env');
  fs.writeFileSync(file, 'ANTHROPIC_API_KEY=sk-not-a-real-key-zzz\n', 'utf8');
  fs.chmodSync(file, 0o644);

  writeEnvValues(file, { OPENAI_API_KEY: 'sk-not-a-real-key-yyy' });

  const mode = fs.statSync(file).mode & 0o777;
  assert.equal(
    mode & 0o077,
    0,
    `rewrite left config.env group/world-accessible (mode ${mode.toString(8)}); the write must re-apply 0600`,
  );
});
