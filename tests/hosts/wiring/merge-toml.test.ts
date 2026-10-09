/**
 * tests/hosts/wiring/merge-toml.test.ts — one server table in a TOML file is
 * created, appended, or replaced while every other byte stays as it was, and
 * a form the writer does not fully read is refused with the file untouched.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { mergeTomlServerTable, readTomlServerTable } from '../../../src/hosts/wiring/merge-toml.ts';

const ENTRY = { command: 'construct', args: ['serve', '--client=codex'], tool_timeout_sec: 120 } as const;
const BLOCK = '[mcp_servers.construct]\ncommand = "construct"\nargs = ["serve", "--client=codex"]\ntool_timeout_sec = 120\n';

function inScratch(fn: (file: string) => void): void {
  const dir = mkdtempSync(join(tmpdir(), 'construct-toml-'));
  try {
    fn(join(dir, '.codex', 'config.toml'));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

function write(file: string, text: string): void {
  mergeTomlServerTable(file, 'seed', { command: 'x' });
  writeFileSync(file, text, 'utf8');
}

test('an absent file gets one block, and reads back as the entry', () => {
  inScratch((file) => {
    const r = mergeTomlServerTable(file, 'construct', ENTRY);
    assert.deepEqual(r, { ok: true, created: true, path: file, replaced: [] });
    assert.equal(readFileSync(file, 'utf8'), BLOCK);
    assert.deepEqual(readTomlServerTable(file, 'construct'), ENTRY);
    assert.equal(readTomlServerTable(file, 'other'), null);
  });
});

test('the block is appended after one blank line, beside other servers and comments', () => {
  inScratch((file) => {
    const before = '# my codex settings\nmodel = "gpt-5"\n\n[mcp_servers.linear]\ncommand = "npx"\nargs = [\n  "-y", # the runner\n  "linear-mcp",\n]\nenv = { TOKEN = "t" }\n\n\n';
    write(file, before);
    const r = mergeTomlServerTable(file, 'construct', ENTRY);
    assert.equal(r.ok, true);
    assert.equal(readFileSync(file, 'utf8'), `${before.replace(/\n+$/, '')}\n\n${BLOCK}`);
    assert.deepEqual(readTomlServerTable(file, 'linear'), { command: 'npx', args: ['-y', 'linear-mcp'] });
    assert.deepEqual(readTomlServerTable(file, 'construct'), ENTRY);
  });
});

test('an existing block and its subtables are replaced in place, and what follows keeps its comment', () => {
  inScratch((file) => {
    const before = [
      'model = "gpt-5"',
      '',
      '[mcp_servers."construct"] # wired by hand',
      'command = "/old/node"',
      'args = ["/old/bin/construct.mjs", "serve"]',
      '',
      '[mcp_servers.construct.env]',
      'DEBUG = "1"',
      '',
      '# the tracker',
      '[mcp_servers.linear]',
      'command = "npx"',
      '',
    ].join('\n');
    write(file, before);
    assert.deepEqual(readTomlServerTable(file, 'construct'), { command: '/old/node', args: ['/old/bin/construct.mjs', 'serve'] });
    const r = mergeTomlServerTable(file, 'construct', ENTRY);
    assert.equal(r.ok, true);
    assert.equal(readFileSync(file, 'utf8'), ['model = "gpt-5"', '', ...BLOCK.trimEnd().split('\n'), '', '# the tracker', '[mcp_servers.linear]', 'command = "npx"', ''].join('\n'));
    assert.deepEqual(readTomlServerTable(file, 'construct'), ENTRY);
  });
});

test('a subtable apart from its table, at the end of a file with no final line break, never glues the next line onto the block', () => {
  inScratch((file) => {
    write(file, '[mcp_servers.construct]\ncommand = "x"\n[other]\na = 1\n[mcp_servers.construct.env]\nA = "b"');
    assert.equal(mergeTomlServerTable(file, 'construct', ENTRY).ok, true);
    assert.equal(readFileSync(file, 'utf8'), `${BLOCK}[other]\na = 1\n`);
    assert.deepEqual(readTomlServerTable(file, 'construct'), ENTRY);
    // The table alone at the end of such a file keeps the file's missing final line break.
    write(file, 'model = "m"\n\n[mcp_servers.construct]\ncommand = "x"');
    assert.equal(mergeTomlServerTable(file, 'construct', ENTRY).ok, true);
    assert.equal(readFileSync(file, 'utf8'), `model = "m"\n\n${BLOCK.trimEnd()}`);
  });
});

test('CRLF line endings are kept, in the lines it keeps and the lines it writes', () => {
  inScratch((file) => {
    const before = '# settings\r\n[mcp_servers.linear]\r\ncommand = "npx"\r\n';
    write(file, before);
    assert.equal(mergeTomlServerTable(file, 'construct', ENTRY).ok, true);
    const after = readFileSync(file, 'utf8');
    assert.equal(after, `${before}\r\n${BLOCK.replaceAll('\n', '\r\n')}`);
    assert.doesNotMatch(after.replaceAll('\r\n', ''), /\n/);
    assert.equal(mergeTomlServerTable(file, 'construct', { ...ENTRY, tool_timeout_sec: 90 }).ok, true);
    assert.equal(readFileSync(file, 'utf8'), after.replace('tool_timeout_sec = 120', 'tool_timeout_sec = 90'));
  });
});

test('an unchanged entry is a no-op: same bytes, same modification time', () => {
  inScratch((file) => {
    const text = `# keep me\n\n${BLOCK.replace('[mcp_servers.construct]', '[mcp_servers.construct]   # mine')}`;
    write(file, text);
    const before = statSync(file).mtimeMs;
    const r = mergeTomlServerTable(file, 'construct', ENTRY);
    assert.deepEqual(r, { ok: true, created: false, path: file, replaced: [] });
    assert.equal(readFileSync(file, 'utf8'), text);
    assert.equal(statSync(file).mtimeMs, before);
  });
});

test('forms it does not fully read are refused and the bytes are left as they were', () => {
  const forms: Record<string, string> = {
    'multi-line basic string': '[mcp_servers.other]\ncommand = """\nx\n"""\n',
    'multi-line literal string': "description = '''\nx\n'''\n",
    'dotted key at the top': 'mcp_servers.construct.command = "construct"\n',
    'dotted key in the servers table': '[mcp_servers]\nconstruct.command = "construct"\n',
    'inline server table': '[mcp_servers]\nconstruct = { command = "construct" }\n',
    'inline servers table': 'mcp_servers = { construct = { command = "construct" } }\n',
    'array of tables': '[[mcp_servers.construct]]\ncommand = "construct"\n',
    'unreadable header': '[mcp_servers.construct\ncommand = "construct"\n',
  };
  for (const [name, text] of Object.entries(forms)) {
    inScratch((file) => {
      write(file, text);
      const r = mergeTomlServerTable(file, 'construct', ENTRY);
      assert.equal(r.ok, false, `${name} is refused`);
      if (!r.ok) assert.ok(r.reason.length > 10, `${name} says why: ${r.reason}`);
      assert.equal(readFileSync(file, 'utf8'), text, `${name} is untouched`);
    });
  }
});

test('values are written as escaped basic strings, and read back exactly', () => {
  inScratch((file) => {
    const entry = { command: 'C:\\tools\\construct "beta"', args: ['tab\there', 'quote\'s', '#not a comment'], enabled: true, tool_timeout_sec: 120 };
    assert.equal(mergeTomlServerTable(file, 'construct', entry).ok, true);
    assert.match(readFileSync(file, 'utf8'), /^command = "C:\\\\tools\\\\construct \\"beta\\""$/m);
    assert.deepEqual(readTomlServerTable(file, 'construct'), entry);
    assert.deepEqual(mergeTomlServerTable(file, 'construct', entry), { ok: true, created: false, path: file, replaced: [] });
  });
});

test('a line inside a multi-line value is never taken for a header', () => {
  inScratch((file) => {
    const before = '[mcp_servers.other]\ncommand = "x"\nmatrix = [\n  ["mcp_servers.construct"]\n]\n';
    write(file, before);
    assert.equal(readTomlServerTable(file, 'construct'), null);
    assert.equal(mergeTomlServerTable(file, 'construct', ENTRY).ok, true);
    assert.equal(readFileSync(file, 'utf8'), `${before}\n${BLOCK}`);
  });
});
