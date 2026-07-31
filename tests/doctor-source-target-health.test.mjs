/**
 * tests/doctor-source-target-health.test.mjs — unit coverage for the
 * source-target health checker.
 *
 * Exercises the pure paths the functional doctor test does not: the zero-target
 * silent pass, a healthy directory, and the credential-presence soft notice.
 */

import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { checkSourceTargetHealth } from '../lib/doctor/source-target-health.mjs';
import { rmTmpDir } from './helpers/cleanup.mjs';

const tmp = [];
test.after(() => { for (const d of tmp) { try { rmTmpDir(d); } catch {} } });

function projectWith(targets) {
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'cx-sth-'));
  tmp.push(cwd);
  fs.writeFileSync(path.join(cwd, 'construct.config.json'), JSON.stringify({ sources: { targets } }));
  return cwd;
}

test('zero configured targets → silent (configured 0, no findings)', () => {
  const cwd = projectWith([]);
  const res = checkSourceTargetHealth({ cwd, env: {} });
  assert.equal(res.configured, 0);
  assert.deepEqual(res.findings, []);
});

test('a healthy directory target reports ok', () => {
  const cwd = projectWith([{ id: 'proj-app', provider: 'directory', selector: { path: '.' } }]);
  const docs = path.join(cwd, 'here');
  fs.mkdirSync(docs);
  const cwd2 = projectWith([{ id: 'proj-app', provider: 'directory', selector: { path: docs } }]);
  const res = checkSourceTargetHealth({ cwd: cwd2, env: {} });
  assert.equal(res.configured, 1);
  const dirFinding = res.findings.find((f) => f.label.includes('proj-app'));
  assert.ok(dirFinding?.ok, 'existing directory resolves');
});

test('a network-backed target with no credential env emits a soft notice', () => {
  const cwd = projectWith([{ id: 'jira-core', provider: 'jira', selector: { project: 'CORE' } }]);
  const withCred = checkSourceTargetHealth({ cwd, env: { JIRA_API_TOKEN: 'x' } });
  assert.equal(withCred.findings.filter((f) => /credential not detected/.test(f.label)).length, 0, 'no notice when creds present');

  const withoutCred = checkSourceTargetHealth({ cwd, env: {} });
  const notice = withoutCred.findings.find((f) => /credential not detected/.test(f.label));
  assert.ok(notice, 'notice when creds absent');
  assert.equal(notice.optional, true, 'credential absence is a soft notice, not a hard failure');
});
