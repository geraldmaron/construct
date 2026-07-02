/**
 * publish-validation-propagation.test.mjs — F13/AP5 publish validation honesty.
 *
 * Pins the propagation contract missing from the original output-quality fix:
 * when export succeeds but post-export validation fails, runPublish().ok must
 * be false, the headline must stop claiming "Published", and the CLI must exit
 * non-zero while still printing the validation failure detail lines.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { runPublish, runPublishCli } from '../../../lib/publish.mjs';

const REPO = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..', '..', '..');

function makeWorkspace(prefix) {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

function withCapturedConsole(fn) {
  const stdout = [];
  const stderr = [];
  const origLog = console.log;
  const origError = console.error;
  console.log = (...args) => stdout.push(args.map(String).join(' '));
  console.error = (...args) => stderr.push(args.map(String).join(' '));
  return Promise.resolve()
    .then(fn)
    .then((result) => ({ result, stdout: stdout.join('\n'), stderr: stderr.join('\n') }))
    .finally(() => {
      console.log = origLog;
      console.error = origError;
    });
}

test('validation failure propagates into runPublish().ok, headline message, and CLI exit code', async () => {
  const dir = makeWorkspace('publish-validation-fail-');
  try {
    const input = path.join(dir, 'broken.md');
    const output = path.join(dir, 'broken.out.md');
    fs.writeFileSync(input, '# Broken publish\n\nSee [missing notes](./missing.txt).\n', 'utf8');

    const result = runPublish({
      inputPath: input,
      outputPath: output,
      format: 'md',
      gate: false,
      cwd: dir,
      repoRoot: REPO,
    });

    assert.equal(result.ledger.export?.ok, true, 'precondition: export must succeed so only validation is failing');
    assert.equal(result.ledger.validation?.ok, false, 'precondition: validation must fail for the missing local reference');
    assert.equal(result.ok, false, 'validation failure must make runPublish().ok false');
    assert.match(result.message, /^Publish blocked: output validation failed for /);
    assert.doesNotMatch(result.message, /^Published\b/);

    const cli = await withCapturedConsole(() => runPublishCli([
      input,
      '--to=md',
      `--output=${output}`,
      '--no-gate',
    ], { cwd: dir, repoRoot: REPO }));

    assert.equal(cli.result.exitCode, 1, 'CLI must exit non-zero when output validation failed');
    assert.doesNotMatch(cli.stdout, /^Published\b/m, 'validation failure must not print a success headline');
    assert.match(cli.stderr, /^Publish blocked: output validation failed for /m);
    assert.match(cli.stderr, /references: failed/);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('passing publishes remain successful and keep the Published headline', async () => {
  const dir = makeWorkspace('publish-validation-pass-');
  try {
    const input = path.join(dir, 'clean.md');
    const output = path.join(dir, 'clean.out.md');
    fs.writeFileSync(input, '# Clean publish\n\nNo broken references here.\n', 'utf8');

    const result = runPublish({
      inputPath: input,
      outputPath: output,
      format: 'md',
      gate: false,
      cwd: dir,
      repoRoot: REPO,
    });

    assert.equal(result.ok, true, result.message);
    assert.equal(result.ledger.validation?.ok, true, 'validation should pass for the clean source');
    assert.match(result.message, /^Published /);

    const cli = await withCapturedConsole(() => runPublishCli([
      input,
      '--to=md',
      `--output=${output}`,
      '--no-gate',
    ], { cwd: dir, repoRoot: REPO }));

    assert.equal(cli.result.exitCode, 0, 'passing publish should still exit 0');
    assert.match(cli.stdout, /^Published /m);
    assert.equal(cli.stderr, '');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('preview semantics remain intact for a passing publish', async () => {
  const dir = makeWorkspace('publish-validation-preview-');
  try {
    const input = path.join(dir, 'preview.md');
    const output = path.join(dir, 'preview.out.md');
    fs.writeFileSync(input, '# Preview publish\n\nStill valid.\n', 'utf8');

    const result = runPublish({
      inputPath: input,
      outputPath: output,
      format: 'md',
      gate: false,
      preview: true,
      cwd: dir,
      repoRoot: REPO,
    });

    assert.equal(result.ok, true, result.message);
    assert.match(result.message, /^Published /);

    const cli = await withCapturedConsole(() => runPublishCli([
      input,
      '--to=md',
      `--output=${output}`,
      '--no-gate',
      '--preview',
    ], { cwd: dir, repoRoot: REPO }));

    assert.equal(cli.result.exitCode, 0, 'preview should remain non-failing when validation passes');
    assert.match(cli.stdout, /^Published /m);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
