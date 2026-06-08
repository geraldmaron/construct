/**
 * doctor-warning-paths.functional.test.mjs — doctor messages that reference
 * a path must reference the real one. The original defect: "Contract
 * violations (66 in last 24h — see ~/.cx/contract-violations.jsonl)"
 * pointed at the home dir, but the file moved to .cx/ in the project root.
 * Users went looking, didn't find it, ignored the warning.
 *
 * Strategy: run `construct doctor` against a fixture project that contains
 * a known violations file, capture the output, and assert the printed path
 * resolves to the real file.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { spawnSync } from 'node:child_process';

const REPO = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..', '..');
const BIN = path.join(REPO, 'bin', 'construct');

test('contract-violations doctor warning prints the real project-scoped path', () => {
  const fakeRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'doctor-paths-'));
  const fakeHome = fs.mkdtempSync(path.join(os.tmpdir(), 'doctor-home-'));
  try {
    // package.json signals to resolveProjectScopedPath that fakeRoot is a
    // project root, so the violation log resolves under fakeRoot/.cx/.

    fs.writeFileSync(path.join(fakeRoot, 'package.json'), JSON.stringify({ name: 'fixture' }));
    fs.mkdirSync(path.join(fakeRoot, '.cx'), { recursive: true });
    const violationsFile = path.join(fakeRoot, '.cx', 'contract-violations.jsonl');
    fs.writeFileSync(
      violationsFile,
      JSON.stringify({
        ts: new Date().toISOString(),
        sequence: 1,
        agent: 'construct',
        contractId: 'fixture',
        direction: 'output',
        missing: ['x'],
        prev_line_hash: null,
      }) + '\n',
    );

    const result = spawnSync(BIN, ['doctor'], {
      cwd: fakeRoot,
      env: {
        ...process.env,
        HOME: fakeHome,
        CONSTRUCT_SKIP_BOOTSTRAP_PROBE: '1',
        BOOTSTRAP_CHECKED: '1',
        CONSTRUCT_DISABLE_AUTO_CLEANUP: '1',
      },
      encoding: 'utf8',
      timeout: 60000,
    });

    // Overall doctor pass/fail is irrelevant against a bare fixture; only
    // the contract-violations line matters here.

    const violationsLine = result.stdout.split('\n').find((l) => l.includes('Contract violations'));
    assert.ok(violationsLine, `doctor output should mention 'Contract violations'. stdout: ${result.stdout.slice(0, 500)}`);
    assert.ok(
      violationsLine.includes(violationsFile),
      `Contract violations line should reference the real path ${violationsFile}.
Got: ${violationsLine}`,
    );
    assert.ok(
      !violationsLine.includes('~/.cx/contract-violations.jsonl'),
      `Contract violations line should not still reference the stale ~/.cx/ path.
Got: ${violationsLine}`,
    );
  } finally {
    fs.rmSync(fakeRoot, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
    fs.rmSync(fakeHome, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  }
});

test('doctor no longer surfaces deleted pre-push bypass infrastructure', () => {
  const fakeRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'doctor-bypass-'));
  const fakeHome = fs.mkdtempSync(path.join(os.tmpdir(), 'doctor-bypass-home-'));
  try {
    // A stale prepush-bypass.log must NOT cause doctor to emit a warning.
    // Construct has no writer for this path; surfacing entries from it
    // would resurrect a deleted enforcement surface.

    const auditDir = path.join(fakeHome, '.construct', 'audit');
    fs.mkdirSync(auditDir, { recursive: true });
    fs.writeFileSync(
      path.join(auditDir, 'prepush-bypass.log'),
      JSON.stringify({ ts: new Date().toISOString(), reason: 'stale fixture' }) + '\n',
    );

    fs.writeFileSync(path.join(fakeRoot, 'package.json'), JSON.stringify({ name: 'fixture' }));
    const result = spawnSync(BIN, ['doctor'], {
      cwd: fakeRoot,
      env: {
        ...process.env,
        HOME: fakeHome,
        CONSTRUCT_SKIP_BOOTSTRAP_PROBE: '1',
        BOOTSTRAP_CHECKED: '1',
        CONSTRUCT_DISABLE_AUTO_CLEANUP: '1',
      },
      encoding: 'utf8',
      timeout: 60000,
    });

    assert.ok(
      !result.stdout.includes('Pre-push bypasses in last'),
      `doctor must not surface the deleted pre-push bypass warning.\nstdout: ${result.stdout}`,
    );
    assert.ok(
      !result.stdout.includes('Pre-push bypass log not present'),
      `doctor must not surface the green pre-push bypass line either — the whole check is gone.\nstdout: ${result.stdout}`,
    );
  } finally {
    fs.rmSync(fakeRoot, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
    fs.rmSync(fakeHome, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  }
});
