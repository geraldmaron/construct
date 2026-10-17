import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { userDefaultsPath } from '../../src/kernel/project/config.ts';
import { inProject, sandbox } from './support.ts';

const launcher = fileURLToPath(new URL('../../bin/construct.mjs', import.meta.url));

function validate(box: ReturnType<typeof sandbox>, json = true) {
  return spawnSync(process.execPath, [launcher, 'config', 'validate', ...(json ? ['--json'] : [])], {
    cwd: box.cwd,
    env: box.ctx.env,
    encoding: 'utf8',
  });
}

test('config validation reports malformed project and user files in structured output without mutation', async () => {
  await inProject((_ctx, box) => {
    const project = join(box.cwd, '.construct/project.json');
    const user = userDefaultsPath(box.ctx.paths);
    writeFileSync(project, 'not json');
    mkdirSync(dirname(user), { recursive: true });
    writeFileSync(user, 'also not json');
    const result = validate(box);
    assert.equal(result.status, 1, result.stderr);
    assert.equal(result.stderr, '');
    const record = JSON.parse(result.stdout);
    assert.equal(record.ok, false);
    assert.equal(record.problems.length, 2);
    assert.ok(record.problems.some((p: string) => p.includes(project)));
    assert.ok(record.problems.some((p: string) => p.includes(user)));
    assert.equal(readFileSync(project, 'utf8'), 'not json');
    assert.equal(readFileSync(user, 'utf8'), 'also not json');
    const prose = validate(box, false);
    assert.equal(prose.status, 1);
    assert.match(prose.stdout, /problem: .*is not valid JSON/);
  });
});

test('config validation preserves the valid and projectless output contracts', async () => {
  await inProject((_ctx, box) => {
    const result = validate(box);
    assert.equal(result.status, 0, result.stderr);
    assert.deepEqual(JSON.parse(result.stdout), { ok: true, problems: [] });
  });
  const box = sandbox();
  try {
    const result = validate(box);
    assert.equal(result.status, 0, result.stderr);
    assert.deepEqual(JSON.parse(result.stdout), { ok: true, problems: [] });
  } finally {
    box.cleanup();
  }
});
