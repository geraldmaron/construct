/**
 * tests/hosts/wiring/merge-yaml.test.ts — one server block in a YAML file is
 * created, appended, or replaced while every other byte stays as it was, and
 * a form the writer does not fully read is refused with the file untouched.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { mergeYamlServerBlock, readYamlServerBlock } from '../../../src/hosts/wiring/merge-yaml.ts';

const ENTRY = { command: 'construct', args: ['serve', '--client=hermes', '--project=/p'], cwd: '/p', trust: 'untrusted', enabled: true } as const;
const BLOCK = [
  '  construct:',
  '    command: "construct"',
  '    args: ["serve","--client=hermes","--project=/p"]',
  '    cwd: "/p"',
  '    trust: "untrusted"',
  '    enabled: true',
].join('\n');

function inScratch(fn: (file: string) => void): void {
  const dir = mkdtempSync(join(tmpdir(), 'construct-yaml-'));
  try {
    fn(join(dir, '.hermes', 'config.yaml'));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

function write(file: string, text: string): void {
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, text, 'utf8');
}

test('an absent file gets one block, private to the person, and reads back as the entry', () => {
  inScratch((file) => {
    const r = mergeYamlServerBlock(file, 'construct', ENTRY);
    assert.deepEqual(r, { ok: true, created: true, path: file, replaced: [] });
    assert.equal(readFileSync(file, 'utf8'), `mcp_servers:\n${BLOCK}\n`);
    assert.equal(statSync(file).mode & 0o777, 0o600);
    assert.deepEqual(readYamlServerBlock(file, 'construct'), ENTRY);
    assert.equal(readYamlServerBlock(file, 'other'), null);
  });
});

test('a config without mcp_servers keeps its bytes and gains the block at the end', () => {
  inScratch((file) => {
    const before = '# Hermes\nmodel:\n  default: gpt\napprovals:\n  mode: manual   # ask\n';
    write(file, before);
    assert.equal(mergeYamlServerBlock(file, 'construct', ENTRY).ok, true);
    assert.equal(readFileSync(file, 'utf8'), `${before}mcp_servers:\n${BLOCK}\n`);
  });
});

test('other servers, comments, and later sections are untouched when the block is added', () => {
  inScratch((file) => {
    const head = 'mcp_servers:\n  # the person\'s own\n  github:\n    command: npx\n    args:\n      - -y\n      - "@modelcontextprotocol/server-github"\n    tools:\n      include: [list_issues]\n';
    const tail = '\nskills:\n  creation_nudge_interval: 0\n';
    write(file, head + tail);
    assert.equal(mergeYamlServerBlock(file, 'construct', ENTRY).ok, true);
    assert.equal(readFileSync(file, 'utf8'), `${head}${BLOCK}\n${tail}`);
  });
});

test('an unchanged entry leaves the file byte-identical, written in any form read here', () => {
  inScratch((file) => {
    const text = "mcp_servers:\n    construct:\n        command: construct   # from PATH\n        args:\n        - serve\n        - '--client=hermes'\n        - --project=/p\n        cwd: /p\n        trust: untrusted\n        enabled: true\n";
    write(file, text);
    const r = mergeYamlServerBlock(file, 'construct', ENTRY);
    assert.deepEqual(r, { ok: true, created: false, path: file, replaced: [] });
    assert.equal(readFileSync(file, 'utf8'), text);
  });
});

test('a stale entry is replaced in place at the file\'s own indentation, other servers kept', () => {
  inScratch((file) => {
    write(file, 'mcp_servers:\n    construct:\n        command: /old/node\n        args: [/old/construct.mjs, serve]\n    other:\n        command: x\ntop: 1\n');
    assert.equal(mergeYamlServerBlock(file, 'construct', ENTRY).ok, true);
    const text = readFileSync(file, 'utf8');
    assert.match(text, /^mcp_servers:\n {4}construct:\n {8}command: "construct"\n/);
    assert.match(text, / {4}other:\n {8}command: x\ntop: 1\n$/);
    assert.deepEqual(readYamlServerBlock(file, 'construct'), ENTRY);
  });
});

test('an inline empty mcp_servers becomes a block', () => {
  inScratch((file) => {
    write(file, 'mcp_servers: {}\nother: 2\n');
    assert.equal(mergeYamlServerBlock(file, 'construct', ENTRY).ok, true);
    assert.equal(readFileSync(file, 'utf8'), `mcp_servers:\n${BLOCK}\nother: 2\n`);
  });
});

test('CRLF line endings are kept on every line', () => {
  inScratch((file) => {
    write(file, 'a: 1\r\n');
    assert.equal(mergeYamlServerBlock(file, 'construct', ENTRY).ok, true);
    const text = readFileSync(file, 'utf8');
    assert.equal(text.replace(/\r\n/g, '').includes('\n'), false);
  });
});

test('a conflict leaves a different entry alone', () => {
  inScratch((file) => {
    write(file, 'mcp_servers:\n  construct:\n    command: construct\n    args: [serve, --client=hermes, --project=/elsewhere]\n');
    const before = readFileSync(file);
    const r = mergeYamlServerBlock(file, 'construct', ENTRY, { conflict: (existing) => (String(existing.args).includes('/elsewhere') ? 'bound elsewhere' : null) });
    assert.deepEqual(r, { ok: false, reason: 'bound elsewhere', path: file });
    assert.deepEqual(readFileSync(file), before);
  });
});

test('forms the writer does not read are refused and the bytes stay', () => {
  const cases: Record<string, string> = {
    'inline servers': 'mcp_servers: {construct: {command: x}}\n',
    'nested setting on the entry': 'mcp_servers:\n  construct:\n    command: x\n    env:\n      TOKEN: y\n',
    'inline entry': 'mcp_servers:\n  construct: {command: x}\n',
    'tabs': 'mcp_servers:\n\tconstruct:\n',
    'two documents': 'a: 1\n---\nmcp_servers:\n',
    'duplicate key': 'mcp_servers:\n  a:\n    command: x\nmcp_servers:\n',
    'anchor': 'mcp_servers:\n  construct:\n    args: *shared\n',
    'byte-order mark before the servers': '\uFEFFmcp_servers:\n  github:\n    command: github\n',
    'explicit key': '? mcp_servers\n: {}\n',
    'tab after the colon': 'mcp_servers:\t{}\n',
    'flow mapping document': '{mcp_servers: {github: {command: github}}}\n',
    'YAML-only escape in a value': 'mcp_servers:\n  construct:\n    command: "foo\\x20bar"\n',
    'YAML-only escape in a key': 'mcp_servers:\n  "con\\x73truct":\n    command: x\n',
  };
  for (const [name, text] of Object.entries(cases)) {
    inScratch((file) => {
      write(file, text);
      const r = mergeYamlServerBlock(file, 'construct', ENTRY);
      assert.equal(r.ok, false, name);
      assert.doesNotThrow(() => readYamlServerBlock(file, 'construct'), name);
      assert.equal(readFileSync(file, 'utf8'), text, name);
    });
  }
});
