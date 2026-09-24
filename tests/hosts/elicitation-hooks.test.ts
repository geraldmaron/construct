/**
 * tests/hosts/elicitation-hooks.test.ts — finding what could answer a
 * question the host shows the person, in their place.
 *
 * A hook on Claude Code's Elicitation or ElicitationResult event, in project,
 * user, or plugin configuration, can supply the answer without the person;
 * any other hook cannot. A file that is not valid JSON but names the event
 * still counts.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { elicitationAnswerers, pluginHookFiles, projectHookFiles } from '../../src/hosts/elicitation-hooks.ts';

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
