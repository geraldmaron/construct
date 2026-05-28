/**
 * tests/providers/creds.test.mjs — credential management utility tests.
 *
 * All tests write to a temporary directory so the user's real
 * ~/.construct/config.env is never touched. Each test imports the creds
 * module with HOME overridden to the tmpdir.
 *
 * Verifies:
 *   - readCreds() returns an empty object when config.env is absent.
 *   - writeCreds() creates the file and sets mode 0600.
 *   - writeCreds() updates an existing block without destroying other blocks.
 *   - deleteCreds() removes a block and leaves the rest intact.
 *   - listCreds() returns the expected array shape.
 *   - checkCredsFileMode() returns ok=true for 0600, ok=false for 0644.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, it, before, after, beforeEach } from 'node:test';

let tmpHome;
let credsModule;

before(async () => {
  tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), 'cx-creds-test-'));

  // Override HOME so the creds module targets our tmpdir.
  process.env._ORIGINAL_HOME = process.env.HOME;
  process.env.HOME = tmpHome;

  credsModule = await import('../../lib/providers/creds.mjs');
});

after(() => {
  process.env.HOME = process.env._ORIGINAL_HOME;
  delete process.env._ORIGINAL_HOME;
  fs.rmSync(tmpHome, { recursive: true, force: true });
});

beforeEach(() => {
  const fp = path.join(tmpHome, '.construct', 'config.env');
  if (fs.existsSync(fp)) fs.unlinkSync(fp);
});

describe('credsFilePath', () => {
  it('returns a path ending in .construct/config.env under HOME', () => {
    const fp = credsModule.credsFilePath();
    assert.ok(fp.includes('.construct'));
    assert.ok(fp.endsWith('config.env'));
    assert.ok(fp.startsWith(tmpHome));
  });
});

describe('readCreds', () => {
  it('returns empty object when file is absent', () => {
    const result = credsModule.readCreds();
    assert.deepEqual(result, {});
  });

  it('returns parsed creds after a write', () => {
    credsModule.writeCreds('github', { key: 'ghp_test', account: 'myorg' });
    const result = credsModule.readCreds();
    assert.ok(result['github']);
    assert.equal(result['github'].account, 'myorg');
    assert.equal(result['github'].key, 'ghp_test');
    assert.ok(result['github'].rotatedAt);
    assert.ok(result['github'].nextRotationDue);
  });

  it('parses multiple provider blocks', () => {
    credsModule.writeCreds('github', { key: 'ghp_test', account: 'org1' });
    credsModule.writeCreds('slack', { key: 'xoxb_test', account: 'workspace1' });
    const result = credsModule.readCreds();
    assert.ok(result['github']);
    assert.ok(result['slack']);
    assert.equal(result['slack'].account, 'workspace1');
  });
});

describe('writeCreds', () => {
  it('creates .construct dir and config.env if absent', () => {
    credsModule.writeCreds('github', { key: 'ghp_abc', account: 'testorg' });
    const fp = credsModule.credsFilePath();
    assert.ok(fs.existsSync(fp));
  });

  it('sets file mode to 0600', () => {
    credsModule.writeCreds('github', { key: 'ghp_abc', account: 'testorg' });
    const fp = credsModule.credsFilePath();
    const stat = fs.statSync(fp);
    const mode = stat.mode & 0o777;
    assert.equal(mode, 0o600);
  });

  it('updates an existing block without destroying other blocks', () => {
    credsModule.writeCreds('github', { key: 'ghp_old', account: 'org' });
    credsModule.writeCreds('slack', { key: 'xoxb_test', account: 'ws' });
    credsModule.writeCreds('github', { key: 'ghp_new' });

    const result = credsModule.readCreds();
    assert.equal(result['github'].key, 'ghp_new');
    assert.equal(result['github'].account, 'org', 'account preserved when not updated');
    assert.ok(result['slack'], 'slack block must survive a github update');
  });

  it('preserves existing key when only account is updated', () => {
    credsModule.writeCreds('github', { key: 'ghp_keep', account: 'oldorg' });
    credsModule.writeCreds('github', { account: 'neworg' });
    const result = credsModule.readCreds();
    assert.equal(result['github'].key, 'ghp_keep');
    assert.equal(result['github'].account, 'neworg');
  });

  it('normalises hyphenated provider names', () => {
    credsModule.writeCreds('atlassian-jira', { key: 'jira_key', account: 'myinstance' });
    const result = credsModule.readCreds();
    assert.ok(result['atlassian-jira']);
    assert.equal(result['atlassian-jira'].key, 'jira_key');
  });
});

describe('deleteCreds', () => {
  it('removes a provider block from the file', () => {
    credsModule.writeCreds('github', { key: 'ghp_abc', account: 'org' });
    credsModule.deleteCreds('github');
    const result = credsModule.readCreds();
    assert.ok(!result['github']);
  });

  it('leaves other blocks intact after deletion', () => {
    credsModule.writeCreds('github', { key: 'ghp_abc', account: 'org' });
    credsModule.writeCreds('slack', { key: 'xoxb_test', account: 'ws' });
    credsModule.deleteCreds('github');
    const result = credsModule.readCreds();
    assert.ok(!result['github']);
    assert.ok(result['slack']);
  });

  it('is a no-op when provider does not exist', () => {
    credsModule.writeCreds('slack', { key: 'xoxb_test', account: 'ws' });
    assert.doesNotThrow(() => credsModule.deleteCreds('github'));
    const result = credsModule.readCreds();
    assert.ok(result['slack']);
  });
});

describe('listCreds', () => {
  it('returns an empty array when no creds are stored', () => {
    const list = credsModule.listCreds();
    assert.deepEqual(list, []);
  });

  it('returns one entry per provider with expected shape', () => {
    credsModule.writeCreds('github', { key: 'ghp_abc', account: 'myorg' });
    credsModule.writeCreds('slack', { key: 'xoxb_test', account: 'myws' });
    const list = credsModule.listCreds();
    assert.equal(list.length, 2);
    for (const entry of list) {
      assert.ok('provider' in entry);
      assert.ok('account' in entry);
      assert.ok('rotatedAt' in entry);
      assert.ok('nextRotationDue' in entry);
    }
    const githubEntry = list.find((e) => e.provider === 'github');
    assert.ok(githubEntry);
    assert.equal(githubEntry.account, 'myorg');
  });
});

describe('checkCredsFileMode', () => {
  it('returns ok=true and mode=absent when file does not exist', () => {
    const result = credsModule.checkCredsFileMode();
    assert.equal(result.ok, true);
    assert.equal(result.mode, 'absent');
  });

  it('returns ok=true when mode is exactly 0600', () => {
    credsModule.writeCreds('github', { key: 'ghp_abc', account: 'org' });
    const result = credsModule.checkCredsFileMode();
    assert.equal(result.ok, true);
    assert.equal(result.mode, '0600');
  });

  it('returns ok=false when mode is wider than 0600', () => {
    credsModule.writeCreds('github', { key: 'ghp_abc', account: 'org' });
    const fp = credsModule.credsFilePath();
    fs.chmodSync(fp, 0o644);
    const result = credsModule.checkCredsFileMode();
    assert.equal(result.ok, false);
    assert.equal(result.mode, '0644');
  });
});
