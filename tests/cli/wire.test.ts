/**
 * tests/cli/wire.test.ts — `construct wire` through its real surface: an
 * ambient environment in, a project MCP config out. Every case hands
 * `wire()` a fabricated env object rather than touching `process.env`, the
 * same discipline tests/hosts/ambient.test.ts uses, so nothing here depends
 * on what actually launched the test runner.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { wire } from '../../src/cli/wire.ts';

interface Capture {
  readonly code: number;
  readonly out: string;
  readonly err: string;
}

function withRepo<T>(fn: (cwd: string) => T): T {
  // Keep fixtures inside the workspace: some environments refuse creating
  // `.cursor/` under the system tmpdir.
  const cwd = mkdtempSync(join(process.cwd(), '.tmp-wire-'));
  try {
    return fn(cwd);
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
}

function capture(fn: () => number): Capture {
  const out: string[] = [];
  const err: string[] = [];
  const realOut = process.stdout.write.bind(process.stdout);
  const realErr = process.stderr.write.bind(process.stderr);
  (process.stdout as { write: unknown }).write = (chunk: string) => {
    out.push(String(chunk));
    return true;
  };
  (process.stderr as { write: unknown }).write = (chunk: string) => {
    err.push(String(chunk));
    return true;
  };
  let code: number;
  try {
    code = fn();
  } finally {
    (process.stdout as { write: unknown }).write = realOut;
    (process.stderr as { write: unknown }).write = realErr;
  }
  return { code, out: out.join(''), err: err.join('') };
}

test('bare wire (no --yes) previews the write and touches nothing on disk', () => {
  withRepo((cwd) => {
    const { code, out } = capture(() => wire([], cwd, { CLAUDECODE: '1' }));
    assert.equal(code, 0);
    assert.match(out, /would wire construct-mcp into \.mcp\.json for claude/);
    assert.match(out, /Pass --yes to write it/);
    assert.equal(existsSync(join(cwd, '.mcp.json')), false, 'a preview writes nothing');
  });
});

test('claude: wire --yes writes .mcp.json with the construct-mcp entry', () => {
  withRepo((cwd) => {
    const { code, out } = capture(() => wire(['--yes'], cwd, { CLAUDECODE: '1' }));
    assert.equal(code, 0);
    assert.match(out, /wired construct-mcp into \.mcp\.json for claude/);

    const configPath = join(cwd, '.mcp.json');
    assert.ok(existsSync(configPath));
    const config = JSON.parse(readFileSync(configPath, 'utf8')) as {
      mcpServers: Record<string, { command: string; args: string[] }>;
    };
    const entry = config.mcpServers['construct-mcp'];
    assert.ok(entry, 'the server is registered under the shared project id');
    assert.match(entry.command, /node/);
    assert.ok(entry.args.some((a) => a.endsWith('bin/construct.mjs')), 'points at this binary');
    assert.ok(entry.args.includes('serve'), 'the projection, never dispatch');
    assert.ok(entry.args.includes('--client=claude-code'), 'session-bound client');
    assert.ok(entry.args.some((a) => a.startsWith('--project=')), 'session-bound project');
  });
});

test('cursor: wire writes .cursor/mcp.json with the construct-mcp entry', () => {
  withRepo((cwd) => {
    const { code, out } = capture(() => wire(['--yes'], cwd, { CURSOR_AGENT: '1' }));
    assert.equal(code, 0);
    assert.match(out, /wired construct-mcp into \.cursor\/mcp\.json for cursor/);

    const configPath = join(cwd, '.cursor', 'mcp.json');
    assert.ok(existsSync(configPath));
    const config = JSON.parse(readFileSync(configPath, 'utf8')) as {
      mcpServers: Record<string, { command: string; args: string[] }>;
    };
    const entry = config.mcpServers['construct-mcp'];
    assert.ok(entry);
    assert.ok(entry.args.includes('serve'));
    assert.ok(entry.args.includes('--client=cursor'));
    assert.ok(entry.args.some((a) => a.startsWith('--project=')));
  });
});

test('wiring twice is idempotent: no duplicate entry, second run reports nothing changed', () => {
  withRepo((cwd) => {
    const first = capture(() => wire(['--yes'], cwd, { CLAUDECODE: '1' }));
    assert.equal(first.code, 0);
    const firstBody = readFileSync(join(cwd, '.mcp.json'), 'utf8');

    const second = capture(() => wire(['--yes'], cwd, { CLAUDECODE: '1' }));
    assert.equal(second.code, 0);
    assert.match(second.out, /already wired.*nothing to change/);

    const secondBody = readFileSync(join(cwd, '.mcp.json'), 'utf8');
    assert.equal(secondBody, firstBody, 're-wiring must not rewrite an already-correct file');

    const config = JSON.parse(secondBody) as { mcpServers: Record<string, unknown> };
    assert.equal(Object.keys(config.mcpServers).length, 1, 'no duplicate key from running twice');
  });
});

test('an existing .mcp.json with other servers keeps them; only construct-mcp is touched', () => {
  withRepo((cwd) => {
    mkdirSync(cwd, { recursive: true });
    const existing = { mcpServers: { context7: { command: 'npx', args: ['-y', 'context7'] } } };
    writeFileSync(join(cwd, '.mcp.json'), JSON.stringify(existing, null, 2));

    const { code } = capture(() => wire(['--yes'], cwd, { CLAUDECODE: '1' }));
    assert.equal(code, 0);

    const config = JSON.parse(readFileSync(join(cwd, '.mcp.json'), 'utf8')) as {
      mcpServers: Record<string, unknown>;
    };
    assert.ok(config.mcpServers.context7, 'a pre-existing, unrelated server survives');
    assert.ok(config.mcpServers['construct-mcp'], 'and the new one is added beside it');
    assert.equal(Object.keys(config.mcpServers).length, 2);
  });
});

test('the written file is 0600, umask-aware, mirroring the mcpconfig discipline', () => {
  withRepo((cwd) => {
    capture(() => wire(['--yes'], cwd, { CLAUDECODE: '1' }));
    const mode = statSync(join(cwd, '.mcp.json')).mode & 0o777;
    assert.equal(mode, 0o600);
  });
});

test('bob is detected but has no wired config writer: refuses cleanly, names the manual recipe', () => {
  withRepo((cwd) => {
    const { code, out, err } = capture(() =>
      wire([], cwd, { BOB_SHELL_CLI_IDE_SERVER_PORT: '42991' }),
    );
    assert.equal(code, 1);
    assert.equal(out, '', 'a refusal writes nothing to stdout');
    assert.match(err, /running inside bob/);
    assert.match(err, /no wired MCP config writer/);
    assert.match(err, /docs\/consumer-install\.md/);
    assert.equal(existsSync(join(cwd, '.mcp.json')), false, 'a refusal changes nothing on disk');
    assert.equal(existsSync(join(cwd, '.cursor')), false);
  });
});

test('an undetected ambient host refuses cleanly and names the manual recipe, guessing nothing', () => {
  withRepo((cwd) => {
    const { code, out, err } = capture(() => wire([], cwd, {}));
    assert.equal(code, 1);
    assert.equal(out, '');
    assert.match(err, /no ambient host detected/);
    assert.match(err, /docs\/consumer-install\.md/);
    assert.equal(existsSync(join(cwd, '.mcp.json')), false);
  });
});

test('a malformed existing .mcp.json is refused rather than clobbered', () => {
  withRepo((cwd) => {
    writeFileSync(join(cwd, '.mcp.json'), '{ not json');
    const { code, err } = capture(() => wire([], cwd, { CLAUDECODE: '1' }));
    assert.equal(code, 1);
    assert.match(err, /not valid JSON/);
    assert.match(err, /left untouched/);
    assert.equal(readFileSync(join(cwd, '.mcp.json'), 'utf8'), '{ not json', 'the bad file is not rewritten');
  });
});

test('construct wire is reachable through main() and listed in help', async () => {
  const { main } = await import('../../src/cli/index.ts');
  const cwd = mkdtempSync(join(process.cwd(), '.tmp-wire-main-'));
  const previousCwd = process.cwd();
  const previousMarker = process.env.CLAUDECODE;
  process.chdir(cwd);
  process.env.CLAUDECODE = '1';
  let code = -1;
  try {
    const out: string[] = [];
    const realOut = process.stdout.write.bind(process.stdout);
    (process.stdout as { write: unknown }).write = (chunk: string) => {
      out.push(String(chunk));
      return true;
    };
    try {
      code = await main(['wire', '--yes']);
    } finally {
      (process.stdout as { write: unknown }).write = realOut;
    }
  } finally {
    if (previousMarker === undefined) delete process.env.CLAUDECODE;
    else process.env.CLAUDECODE = previousMarker;
    process.chdir(previousCwd);
  }
  try {
    assert.equal(code, 0);
    assert.ok(existsSync(join(cwd, '.mcp.json')));
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }

  const helpOut: string[] = [];
  const realOut = process.stdout.write.bind(process.stdout);
  (process.stdout as { write: unknown }).write = (chunk: string) => {
    helpOut.push(String(chunk));
    return true;
  };
  let helpCode: number;
  try {
    helpCode = await main(['help']);
  } finally {
    (process.stdout as { write: unknown }).write = realOut;
  }
  assert.equal(helpCode, 0);
  assert.match(helpOut.join(''), /wire/);
});
