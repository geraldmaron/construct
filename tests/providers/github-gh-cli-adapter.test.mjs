/**
 * tests/providers/github-gh-cli-adapter.test.mjs — real behavior of
 * lib/providers/contract/adapters/github/index.mjs's gh-CLI transport
 * (construct-4uxq0.13.3, Phase 9 audit checklist items "rate-limit" and
 * "permission-failure" behavior).
 *
 * A stub `gh` executable is placed first on PATH and driven by an env var, so
 * the adapter's real spawnSync('gh', ...) call, stderr parsing, and typed-error
 * mapping (AuthError / RateLimitError with parsed retryAfter) all run for
 * real — only the external `gh` binary itself is replaced, the same
 * PATH-stub pattern tests/helpers/sterile-host-env.mjs uses for `ollama`.
 * tests/writes/github.functional.test.mjs already covers the governed-write
 * wrapper's own retry/backoff loop against a fake ghAdapter object; this file
 * covers the layer beneath it — the raw CLI adapter's own error
 * classification from a real (stubbed) subprocess exit.
 */

import { describe, it, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { rmTmpDir } from '../helpers/cleanup.mjs';
import provider from '../../lib/providers/contract/adapters/github/index.mjs';
import { AuthError, RateLimitError } from '../../lib/providers/contract/errors.mjs';

const dirs = [];
function freshDir(prefix) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  dirs.push(dir);
  return dir;
}
after(() => { for (const d of dirs) { try { rmTmpDir(d); } catch {} } });

const GH_STUB = `#!/usr/bin/env node
const mode = process.env.GH_STUB_MODE || 'success';
const args = process.argv.slice(2);

if (mode === 'auth-fail') {
  process.stderr.write('gh: authentication required, run gh auth login\\n');
  process.exit(1);
}
if (mode === 'rate-limit-with-seconds') {
  process.stderr.write('HTTP 403: secondary rate limit exceeded, please retry after 30 seconds.\\n');
  process.exit(1);
}
if (mode === 'rate-limit-no-seconds') {
  process.stderr.write('HTTP 403: secondary rate limit exceeded\\n');
  process.exit(1);
}

if (args[0] === 'pr' && args[1] === 'list') {
  process.stdout.write(JSON.stringify([{ number: 1, title: 'Fix bug', state: 'OPEN' }]));
  process.exit(0);
}
if (args[0] === 'issue' && args[1] === 'create') {
  process.stdout.write('https://github.com/acme/widgets/issues/9\\n');
  process.exit(0);
}
process.stdout.write('[]');
process.exit(0);
`;

/**
 * Runs `run` with a stub `gh` executable first on PATH, driven by
 * GH_STUB_MODE, then restores both env vars — real subprocess dispatch
 * through the adapter's own spawnSync('gh', ...) call, not a fake in-process
 * transport.
 */
async function withGhStub(mode, run) {
  const binDir = freshDir('cx-gh-stub-bin-');
  const stubPath = path.join(binDir, 'gh');
  fs.writeFileSync(stubPath, GH_STUB);
  fs.chmodSync(stubPath, 0o755);

  const originalPath = process.env.PATH;
  const originalMode = process.env.GH_STUB_MODE;
  process.env.PATH = `${binDir}${path.delimiter}${originalPath}`;
  process.env.GH_STUB_MODE = mode;

  try {
    await run();
  } finally {
    process.env.PATH = originalPath;
    if (originalMode === undefined) delete process.env.GH_STUB_MODE;
    else process.env.GH_STUB_MODE = originalMode;
  }
}

describe('github gh-CLI adapter — permission-failure (real subprocess)', () => {
  it('read() maps an authentication-required stderr to a typed AuthError', async () => {
    await withGhStub('auth-fail', async () => {
      await assert.rejects(
        () => provider.read('prs'),
        (err) => {
          assert.ok(err instanceof AuthError);
          assert.equal(err.provider, 'github');
          assert.equal(err.code, 'AUTH_ERROR');
          return true;
        },
      );
    });
  });
});

describe('github gh-CLI adapter — rate-limit (real subprocess)', () => {
  it('write() maps a secondary-rate-limit stderr with an explicit wait to a typed RateLimitError carrying the parsed retryAfter', async () => {
    await withGhStub('rate-limit-with-seconds', async () => {
      await assert.rejects(
        () => provider.write({ type: 'issue', title: 'Bug', body: 'x' }),
        (err) => {
          assert.ok(err instanceof RateLimitError);
          assert.equal(err.provider, 'github');
          assert.equal(err.retryAfter, 30, 'retryAfter must be parsed from the stub\'s "retry after 30 seconds" text');
          return true;
        },
      );
    });
  });

  it('write() maps a secondary-rate-limit stderr with no explicit wait to the documented default retryAfter (60s)', async () => {
    await withGhStub('rate-limit-no-seconds', async () => {
      await assert.rejects(
        () => provider.write({ type: 'issue', title: 'Bug', body: 'x' }),
        (err) => {
          assert.ok(err instanceof RateLimitError);
          assert.equal(err.retryAfter, 60);
          return true;
        },
      );
    });
  });

  it('write() success path returns the created issue URL through the real stub subprocess', async () => {
    await withGhStub('success', async () => {
      const result = await provider.write({ type: 'issue', title: 'Bug', body: 'x' });
      assert.equal(result.type, 'issue-created');
      assert.equal(result.url, 'https://github.com/acme/widgets/issues/9');
    });
  });

  it('read() success path passes real stdout JSON through unmodified', async () => {
    await withGhStub('success', async () => {
      const result = await provider.read('prs');
      assert.deepEqual(result, [{ number: 1, title: 'Fix bug', state: 'OPEN' }]);
    });
  });
});
