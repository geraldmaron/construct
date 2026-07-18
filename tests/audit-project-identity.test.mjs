/**
 * tests/audit-project-identity.test.mjs — scripts/audit-project-identity.mjs.
 *
 * Isolates HOME (via CX_HOME_OVERRIDE) so the audit never reads or reports on
 * the real developer machine's `~/.construct/projects/` tree.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

import { auditProjectIdentity } from '../scripts/audit-project-identity.mjs';
import { deriveProjectKey } from '../lib/state-root.mjs';

const dirs = [];
function mkTmp(prefix = 'cx-audit-') {
  const d = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), prefix)));
  dirs.push(d);
  return d;
}

const homeOverride = mkTmp('cx-audit-home-');
const prevHomeOverride = process.env.CX_HOME_OVERRIDE;
process.env.CX_HOME_OVERRIDE = homeOverride;

test.after(() => {
  for (const d of dirs) { try { fs.rmSync(d, { recursive: true, force: true }); } catch {} }
  if (prevHomeOverride === undefined) delete process.env.CX_HOME_OVERRIDE;
  else process.env.CX_HOME_OVERRIDE = prevHomeOverride;
});

test('reports the canonical bucket as absent for a project with no accumulated state', () => {
  const repo = mkTmp();
  execFileSync('git', ['init', '-q'], { cwd: repo });
  const report = auditProjectIdentity(repo);
  assert.equal(report.canonicalKey, deriveProjectKey(repo));
  const canonical = report.findings.find((f) => f.label.startsWith('canonical'));
  assert.equal(canonical.exists, false);
  assert.equal(report.flagged.length, 0);
});

test('flags the homedir()-fallback bucket when one exists, without deleting or merging it', () => {
  const repo = mkTmp();
  execFileSync('git', ['init', '-q'], { cwd: repo });
  const homedirKey = deriveProjectKey(os.homedir());
  const bucket = path.join(homeOverride, '.construct', 'projects', homedirKey);
  fs.mkdirSync(path.join(bucket, 'lancedb'), { recursive: true });

  const report = auditProjectIdentity(repo);
  assert.equal(report.flagged.length, 1);
  assert.match(report.flagged[0], /Review manually/);
  assert.ok(fs.existsSync(bucket), 'the audit must not delete the flagged bucket');
});
