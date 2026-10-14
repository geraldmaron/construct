import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { inProject } from '../../cli/support.ts';
const launcher = fileURLToPath(new URL('../../../bin/construct.mjs', import.meta.url));

test('actual launcher refuses proposed completion and restores an unchanged later-parented snapshot', async () => {
  await inProject(async (ctx, box) => {
    const cli = (args: string[]) => {
      const result = spawnSync(process.execPath, [launcher, ...args], { cwd: ctx.cwd, env: ctx.env, encoding: 'utf8', timeout: 20_000 });
      if (result.error) throw result.error;
      return result;
    };
    const json = (args: string[]) => {
      const result = cli([...args, '--json']);
      assert.equal(result.status, 0, result.stderr);
      return JSON.parse(result.stdout);
    };
    const blocker = json(['work', 'add', 'Unfinished prerequisite']).id;
    const child = json(['work', 'add', 'Older child', `--blocked-by=${blocker}`]).id;
    const completion = cli(['work', 'complete', child, '--json']);
    assert.equal(completion.status, 1);
    assert.match(completion.stderr, /not admitted.*blocked by/);
    assert.equal(json(['work', 'show', child]).status, 'proposed');
    const parent = json(['work', 'add', 'Newer parent', '--kind=outcome']).id;
    json(['work', 'link', child, `--parent=${parent}`]);
    const snapshot = join(box.cwd, 'snapshot.json');
    json(['work', 'export', snapshot]);
    // The fixture has a sterile PATH and no live sessions; force explicitly
    // acknowledges the unavailable holder inspector for this scratch reset.
    json(['reset', '--confirm', '--force']);
    const restored = json(['work', 'restore', snapshot]);
    assert.equal(restored.imported, 3);
    const shown = json(['work', 'show', child]);
    assert.equal(shown.parentId, parent);
    assert.equal(shown.structure.blockedBy[0].id, blocker);
  });
});
