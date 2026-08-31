/**
 * tests/architecture/interactive-isolation.test.ts — negative architecture tests.
 *
 * Interactive execution must not import resource selection / census.
 * Kernel services must not import host config writers.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = join(import.meta.dirname, '../..');

function read(rel: string): string {
  return readFileSync(join(ROOT, rel), 'utf8');
}

function listTs(dir: string): string[] {
  return readdirSync(join(ROOT, dir), { withFileTypes: true })
    .filter((d) => d.isFile() && d.name.endsWith('.ts'))
    .map((d) => join(dir, d.name));
}

test('InteractiveRunService source cannot import resource selection or census', () => {
  const src = read('src/kernel/services/interactive-run.ts');
  const imports = src
    .split('\n')
    .filter((line) => /^\s*import\b/.test(line))
    .join('\n');
  assert.doesNotMatch(imports, /chooseResource/);
  assert.doesNotMatch(imports, /surveyResources/);
  assert.doesNotMatch(imports, /census/);
  assert.doesNotMatch(imports, /selection/);
});

test('no interactive service module imports selection or census', () => {
  for (const file of listTs('src/kernel/services')) {
    if (file.endsWith('headless-run.ts')) continue;
    const imports = read(file)
      .split('\n')
      .filter((line) => /^\s*import\b/.test(line))
      .join('\n');
    assert.doesNotMatch(
      imports,
      /chooseResource|surveyResources|\/census|\/selection/,
      `${file} must stay off the resource-selection graph`,
    );
  }
});

test('interactive MCP module does not import resource selection or census', () => {
  const src = readFileSync(join(ROOT, 'src/hosts/mcp/interactive.ts'), 'utf8');
  assert.doesNotMatch(src, /resource\/selection|resource\/census|hosts\/compose/);
  assert.match(src, /InteractiveRunService|createInteractiveRunService/);
});

test('kernel state modules do not import host config writers', () => {
  for (const file of listTs('src/kernel/state')) {
    const src = read(file);
    assert.doesNotMatch(src, /mcpconfig|writeMcpConfig|writeOpenCodeConfig/);
  }
});

test('interactive effectiveExecutor uses session unless explicit override', async () => {
  const { mkdtempSync, rmSync } = await import('node:fs');
  const { tmpdir } = await import('node:os');
  const { join: pathJoin } = await import('node:path');
  const { openStateStore } = await import('../../src/kernel/state/open.ts');
  const { createInteractiveRunService } = await import(
    '../../src/kernel/services/interactive-run.ts'
  );

  const root = mkdtempSync(pathJoin(tmpdir(), 'construct-iso-'));
  try {
    const store = openStateStore(pathJoin(root, 'db.sqlite'));
    const interactive = createInteractiveRunService(store, {
      client: 'cursor',
      host: 'cursor-agent',
      owner: 'session:cursor',
    });
    assert.deepEqual(interactive.effectiveExecutor(), {
      executor: 'cursor',
      source: 'active-interactive-session',
    });

    const overridden = createInteractiveRunService(store, {
      client: 'cursor',
      host: 'cursor-agent',
      owner: 'session:cursor',
      executorOverride: 'claude',
      overrideSource: 'explicit-user-request',
    });
    assert.deepEqual(overridden.effectiveExecutor(), {
      executor: 'claude',
      source: 'explicit-user-request',
    });
    store.close();
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
