/**
 * tests/hosts/elicitation-hooks.test.ts — finding what could answer a
 * question the host shows the person, in their place.
 *
 * A hook on Claude Code's Elicitation or ElicitationResult event, in project,
 * user, or plugin configuration, can supply the answer without the person;
 * any other hook cannot. A file is read as JSON, the way the host reads it,
 * so an escaped event name still counts; a file that cannot be read or
 * parsed, or a plugin tree too large to walk, counts too.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { UNCHECKED_PLUGIN_TREE, elicitationAnswerers, pluginHookFiles, projectHookFiles } from '../../src/hosts/elicitation-hooks.ts';

test('only hooks on the elicitation events count as answering for the person', () => {
  const root = mkdtempSync(join(tmpdir(), 'construct-elicit-'));
  try {
    const project = join(root, 'project');
    const claude = join(root, 'home', '.claude');
    mkdirSync(join(project, '.claude'), { recursive: true });
    mkdirSync(join(claude, 'plugins', 'cache', 'vendor', 'tool', '1.0.0', 'hooks'), { recursive: true });
    writeFileSync(join(project, '.claude', 'settings.json'), JSON.stringify({ hooks: { PostToolUse: [{ hooks: [{ type: 'command', command: 'true' }] }] } }));
    assert.deepEqual(elicitationAnswerers(projectHookFiles(project)), [], 'other hooks do not answer questions');

    const plugin = join(claude, 'plugins', 'cache', 'vendor', 'tool', '1.0.0', 'hooks', 'hooks.json');
    writeFileSync(plugin, JSON.stringify({ hooks: { ElicitationResult: [{ matcher: 'construct', hooks: [{ type: 'command', command: 'auto' }] }] } }));
    assert.deepEqual(pluginHookFiles(claude), [plugin]);
    assert.deepEqual(elicitationAnswerers(pluginHookFiles(claude)), [plugin]);

    writeFileSync(join(project, '.claude', 'settings.local.json'), '{ "hooks": { "Elicitation": [ { "hooks": [ ] } ] }, // trailing comment\n}');
    assert.deepEqual(elicitationAnswerers(projectHookFiles(project)), [join(project, '.claude', 'settings.local.json')]);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('an escaped event name, an unreadable or unparsable file, and a tree too large to walk all count as able to answer', () => {
  const root = mkdtempSync(join(tmpdir(), 'construct-elicit-'));
  try {
    const escaped = join(root, 'escaped.json');
    writeFileSync(escaped, '{ "hooks": { "\\u0045licitation": [ { "hooks": [ { "type": "command", "command": "auto" } ] } ] } }');
    assert.equal(JSON.stringify(Object.keys((JSON.parse(readFileSync(escaped, 'utf8')) as { hooks: object }).hooks)), '["Elicitation"]', 'the fixture really parses to the event name');
    assert.deepEqual(elicitationAnswerers([escaped]), [escaped]);

    const broken = join(root, 'broken.json');
    writeFileSync(broken, '{ "hooks": ');
    assert.deepEqual(elicitationAnswerers([broken]), [broken], 'not knowing is never the person');

    const unreadable = join(root, 'unreadable.json');
    writeFileSync(unreadable, '{}');
    chmodSync(unreadable, 0o000);
    try {
      assert.deepEqual(elicitationAnswerers([unreadable]), [unreadable]);
    } finally {
      chmodSync(unreadable, 0o600);
    }

    const quiet = join(root, 'quiet.json');
    writeFileSync(quiet, JSON.stringify({ hooks: { PostToolUse: [] }, note: 'Elicitation is mentioned only as text' }));
    assert.deepEqual(elicitationAnswerers([quiet]), [], 'a value that merely mentions the word is not a hook');

    const claude = join(root, 'home', '.claude');
    let dir = join(claude, 'plugins');
    for (let i = 0; i < 9; i += 1) dir = join(dir, `d${String(i)}`);
    mkdirSync(dir, { recursive: true });
    assert.deepEqual(elicitationAnswerers(pluginHookFiles(claude)), [UNCHECKED_PLUGIN_TREE]);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
