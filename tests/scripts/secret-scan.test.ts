/**
 * tests/scripts/secret-scan.test.ts — the pre-commit secret scanner's own rule.
 *
 * What is held here: every credential shape the scanner claims to know trips it,
 * a dotenv filename is caught while its example template is not, and ordinary
 * lines pass. The scanner is exercised directly against synthetic inputs — no
 * commit, no staging, no real key.
 *
 * Each synthetic credential is assembled from fragments at runtime, so no line
 * of this file carries a contiguous secret shape for the scanner itself (which
 * scans this file's own diff) to flag.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
// @ts-expect-error — the hook is plain .mjs, deliberately outside src/
import { scanAddedLines, scanDiff, isSecretEnvFile } from '../../scripts/hooks/secret-scan.mjs';

const BODY = 'abcdefghijklmnopqrstuvwxyz0123456789';

test('every named credential shape trips the scanner', () => {
  const values: readonly string[] = [
    'sk-' + 'ant-' + 'api03-' + BODY,
    'sk-' + 'proj-' + BODY,
    'AKIA' + 'IOSFODNN7EXAMPLE',
    'ghp_' + BODY + BODY.slice(0, 4),
    'ghs_' + BODY + BODY.slice(0, 4),
    'gho_' + BODY + BODY.slice(0, 4),
    'github_' + 'pat_' + '11ABCDEFG0' + BODY + '_ABCDEFGHIJKLMNOP',
    'xox' + 'b-' + '0000000000-1111111111-abcdEFGHijkl',
    'ATATT3' + 'xFfGF0' + BODY + 'ABCDEF' + '=1A2B3C4D',
    'AIza' + BODY.slice(0, 35),
    '-----BEGIN RSA ' + 'PRIVATE KEY-----',
  ];
  for (const value of values) {
    const hits = scanAddedLines([`+  const key = "${value}";`]);
    assert.ok(hits.length > 0, `expected ${value} to be flagged`);
  }
});

test('an ordinary added line is not flagged', () => {
  const hits = scanAddedLines([
    '+  const message = "Model not found: ollama/qwen3.5:4b";',
    '+// internationalization is not a secret',
  ]);
  assert.deepEqual(hits, []);
});

test('a dotenv filename is a secret file, its example template is not', () => {
  assert.ok(isSecretEnvFile('.env'));
  assert.ok(isSecretEnvFile('.env.local'));
  assert.ok(isSecretEnvFile('config/.env.production'));
  assert.ok(isSecretEnvFile('service.env'));
  assert.equal(isSecretEnvFile('.env.example'), false);
  assert.equal(isSecretEnvFile('src/environment.ts'), false);
  assert.equal(isSecretEnvFile('README.md'), false);
});

test('a staged .env file is flagged even when its added lines are innocent', () => {
  const diff = ['+++ b/.env', '@@ -0,0 +1 @@', '+PORT=3000'].join('\n');
  const hits = scanDiff(diff);
  assert.ok(hits.some((h: string) => h.includes('.env')));
});

test('a staged .env.example is not flagged for its name alone', () => {
  const diff = ['+++ b/.env.example', '@@ -0,0 +1 @@', '+PORT='].join('\n');
  assert.deepEqual(scanDiff(diff), []);
});
