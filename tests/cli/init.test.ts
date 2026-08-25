/**
 * tests/cli/init.test.ts — `construct init` through its real surface: an
 * ambient environment in, the confirmation-plus-spine screen out. Every case
 * hands `init()` a fabricated env object rather than touching `process.env`,
 * the same discipline tests/cli/wire.test.ts uses.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { init } from '../../src/cli/init.ts';

interface Capture {
  readonly code: number;
  readonly out: string;
}

function withRepo<T>(fn: (cwd: string) => T): T {
  const cwd = mkdtempSync(join(tmpdir(), 'construct-init-'));
  try {
    return fn(cwd);
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
}

function capture(fn: () => number): Capture {
  const out: string[] = [];
  const realOut = process.stdout.write.bind(process.stdout);
  (process.stdout as { write: unknown }).write = (chunk: string) => {
    out.push(String(chunk));
    return true;
  };
  let code: number;
  try {
    code = fn();
  } finally {
    (process.stdout as { write: unknown }).write = realOut;
  }
  return { code, out: out.join('') };
}

test('bare init confirms the ambient host, prints the spine, and writes nothing', () => {
  withRepo((cwd) => {
    const { code, out } = capture(() => init([], cwd, { CLAUDECODE: '1' }));
    assert.equal(code, 0);
    assert.match(out, /Detected host: claude \(via CLAUDECODE\)/);
    assert.match(out, /outcome -> work -> show -> inbox -> verdict/);
    assert.match(out, /construct wire --yes/);
    assert.equal(existsSync(join(cwd, '.mcp.json')), false, 'init never writes the MCP entry on its own');
  });
});

test('init with no ambient host says so plainly and still prints the spine', () => {
  withRepo((cwd) => {
    const { code, out } = capture(() => init([], cwd, {}));
    assert.equal(code, 0);
    assert.match(out, /No ambient host detected/);
    assert.match(out, /outcome -> work -> show -> inbox -> verdict/);
    assert.equal(existsSync(join(cwd, '.mcp.json')), false);
  });
});

test('init --yes forwards to wire’s own confirmed path and writes the entry', () => {
  withRepo((cwd) => {
    const { code, out } = capture(() => init(['--yes'], cwd, { CLAUDECODE: '1' }));
    assert.equal(code, 0);
    assert.match(out, /wired construct-mcp into \.mcp\.json for claude/);
    assert.ok(existsSync(join(cwd, '.mcp.json')), 'explicit consent writes through wire');
  });
});
