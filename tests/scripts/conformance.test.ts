import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));

test('the conformance run needs no credential and reports every host as passed, failed, or untested with a reason', () => {
  const out = mkdtempSync(join(tmpdir(), 'construct-conformance-test-'));
  try {
    const report = join(out, 'report.json');
    const r = spawnSync(process.execPath, [join(ROOT, 'scripts', 'conformance.mjs'), `--out=${report}`], { cwd: ROOT, encoding: 'utf8', env: { ...process.env, CLAUDECODE: '1' } });
    assert.equal(r.status, 0, r.stdout + r.stderr);
    const parsed = JSON.parse(readFileSync(report, 'utf8')) as { live: boolean; summary: { passed: number; failed: number; untested: number }; checks: { host: string; check: string; status: string; detail: string }[] };
    assert.equal(parsed.live, false);
    assert.equal(parsed.summary.failed, 0);
    assert.ok(parsed.summary.passed > 0);
    for (const c of parsed.checks) {
      assert.ok(['passed', 'failed', 'untested'].includes(c.status), `${c.host}/${c.check}: ${c.status}`);
      if (c.status === 'untested') assert.ok(c.detail.length > 10, `${c.host}/${c.check} is untested without a reason`);
    }
    for (const host of ['claude-code', 'cursor', 'vscode', 'opencode', 'codex', 'bob']) {
      assert.ok(parsed.checks.some((c) => c.host === host && c.check === 'live host call' && c.status === 'untested'), `${host}: a static run never claims a live host call`);
    }
    assert.match(r.stdout, /^\| Host \| Check \| Status \| Detail \|/m);
  } finally {
    rmSync(out, { recursive: true, force: true });
  }
});
