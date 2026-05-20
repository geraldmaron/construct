/**
 * tests/setup-prompts.test.mjs — `consentToInstall` decision matrix.
 *
 * Pins the Supabase-CLI-style consent flow: install-by-default in interactive
 * mode, --yes accepts without prompt, non-TTY silent skip, consent cache
 * round-trips through `~/.construct/config.env` so re-runs don't re-ask.
 */

import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, it, beforeEach, afterEach } from 'node:test';

import { consentToInstall } from '../lib/setup-prompts.mjs';
import { parseEnvFile } from '../lib/env-config.mjs';

let envPath;
let tmpHome;

beforeEach(() => {
  tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), 'cx-consent-'));
  envPath = path.join(tmpHome, 'config.env');
});

afterEach(() => {
  fs.rmSync(tmpHome, { recursive: true, force: true });
});

function fakeTty() {
  return Object.assign(Object.create(null), { isTTY: true, on: () => {} });
}

function fakeNonTty() {
  return Object.assign(Object.create(null), { isTTY: false, on: () => {} });
}

function fakeReadline(answer) {
  return {
    createInterface() {
      return {
        question(_q, cb) { cb(answer); },
        close() {},
      };
    },
  };
}

describe('consentToInstall', () => {
  it('returns false when alreadyConfigured is true (skips prompt, no cache write)', async () => {
    const result = await consentToInstall({
      name: 'postgres',
      isYes: false,
      alreadyConfigured: true,
      envPath,
      stdin: fakeTty(),
      stdout: { write() {} },
    });
    assert.equal(result.decision, false);
    assert.equal(result.source, 'pre-configured');
    assert.deepEqual(parseEnvFile(envPath), {}, 'no env writes when alreadyConfigured short-circuits');
  });

  it('returns cached yes without re-prompting when BOOTSTRAP_POSTGRES=yes', async () => {
    fs.writeFileSync(envPath, 'BOOTSTRAP_POSTGRES=yes\n');
    const result = await consentToInstall({
      name: 'postgres',
      isYes: false,
      envPath,
      stdin: fakeTty(),
      stdout: { write() {} },
    });
    assert.equal(result.decision, true);
    assert.equal(result.source, 'cached');
  });

  it('returns cached no without re-prompting when BOOTSTRAP_TELEMETRY=no', async () => {
    fs.writeFileSync(envPath, 'BOOTSTRAP_TELEMETRY=no\n');
    const result = await consentToInstall({
      name: 'telemetry',
      isYes: false,
      envPath,
      stdin: fakeTty(),
      stdout: { write() {} },
    });
    assert.equal(result.decision, false);
    assert.equal(result.source, 'cached');
  });

  it('--yes flag returns true and writes consent cache', async () => {
    const result = await consentToInstall({
      name: 'postgres',
      isYes: true,
      envPath,
      stdin: fakeNonTty(),
      stdout: { write() {} },
    });
    assert.equal(result.decision, true);
    assert.equal(result.source, 'flag');
    assert.equal(parseEnvFile(envPath).BOOTSTRAP_POSTGRES, 'yes');
  });

  it('non-TTY without --yes returns false silently (no prompt, no cache write)', async () => {
    const result = await consentToInstall({
      name: 'postgres',
      isYes: false,
      envPath,
      stdin: fakeNonTty(),
      stdout: { write() {} },
    });
    assert.equal(result.decision, false);
    assert.equal(result.source, 'non-tty');
    assert.equal(parseEnvFile(envPath).BOOTSTRAP_POSTGRES, undefined);
  });

  it('interactive TTY prompts and accepts Y as yes, writes cache', async () => {
    const result = await consentToInstall({
      name: 'postgres',
      isYes: false,
      envPath,
      readlineModule: fakeReadline('y'),
      stdin: fakeTty(),
      stdout: { write() {} },
    });
    assert.equal(result.decision, true);
    assert.equal(result.source, 'prompt');
    assert.equal(parseEnvFile(envPath).BOOTSTRAP_POSTGRES, 'yes');
  });

  it('interactive TTY accepts n as no, writes cache', async () => {
    const result = await consentToInstall({
      name: 'telemetry',
      isYes: false,
      envPath,
      readlineModule: fakeReadline('n'),
      stdin: fakeTty(),
      stdout: { write() {} },
    });
    assert.equal(result.decision, false);
    assert.equal(result.source, 'prompt');
    assert.equal(parseEnvFile(envPath).BOOTSTRAP_TELEMETRY, 'no');
  });

  it('empty answer uses the defaultYes (yes by default)', async () => {
    const result = await consentToInstall({
      name: 'postgres',
      isYes: false,
      envPath,
      readlineModule: fakeReadline(''),
      stdin: fakeTty(),
      stdout: { write() {} },
    });
    assert.equal(result.decision, true, 'empty input + defaultYes=true → yes');
  });

  it('force=true bypasses cache and re-prompts', async () => {
    fs.writeFileSync(envPath, 'BOOTSTRAP_POSTGRES=no\n');
    const result = await consentToInstall({
      name: 'postgres',
      isYes: false,
      force: true,
      envPath,
      readlineModule: fakeReadline('y'),
      stdin: fakeTty(),
      stdout: { write() {} },
    });
    assert.equal(result.decision, true);
    assert.equal(result.source, 'prompt');
    assert.equal(parseEnvFile(envPath).BOOTSTRAP_POSTGRES, 'yes', 'force re-prompt overwrites cache');
  });

  it('rejects calls missing required name or envPath', async () => {
    await assert.rejects(() => consentToInstall({ envPath, stdin: fakeNonTty() }), /name is required/);
    await assert.rejects(() => consentToInstall({ name: 'x', stdin: fakeNonTty() }), /envPath is required/);
  });
});
