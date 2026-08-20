/**
 * tests/kernel/cleanup/litter.test.ts — fixture-tree coverage for
 * projectTreeLitter, the project-only view of the predecessor-trace catalog
 * that `doctor` reports from. Markers mirror the shapes construct-legacy's
 * `construct init` actually wrote (same fixture shape as
 * tests/kernel/cleanup/catalog.test.ts's seedProject), rooted in a tmpdir so
 * nothing touches a real project.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { execFileSync } from 'node:child_process';
import { projectTreeLitter } from '../../../src/kernel/cleanup/catalog.ts';

function mkFixtureDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'construct-litter-proj-'));
}

/** The predecessor's traces in a project checkout — same shapes construct-legacy's `construct init` wrote. */
function seedPredecessorLitter(cwd: string): void {
  fs.mkdirSync(path.join(cwd, '.construct', 'launcher', 'cache'), { recursive: true });
  fs.writeFileSync(path.join(cwd, '.construct', 'launcher', 'run.mjs'), '// launcher shim\n');

  fs.mkdirSync(path.join(cwd, '.claude', 'agents'), { recursive: true });
  fs.writeFileSync(path.join(cwd, '.claude', 'agents', 'construct.md'), '# construct persona\n');
  fs.writeFileSync(path.join(cwd, '.claude', 'agents', '.construct-manifest'), 'construct.md\n');

  fs.mkdirSync(path.join(cwd, '.claude', 'commands'), { recursive: true });
  fs.writeFileSync(path.join(cwd, '.claude', 'commands', 'reset.md'), '# reset\n');
  fs.writeFileSync(path.join(cwd, '.claude', 'commands', '.construct-manifest'), 'reset.md\n');

  fs.writeFileSync(
    path.join(cwd, '.claude', 'settings.json'),
    JSON.stringify(
      {
        hooks: { 'pre:session': [{ command: 'node .construct/launcher/run.mjs hook pre-session' }] },
        mcpServers: { 'construct-mcp': { command: 'node' } },
      },
      null,
      2,
    ),
  );

  fs.writeFileSync(path.join(cwd, 'AGENTS.md'), '# scaffolded\n');
  fs.writeFileSync(path.join(cwd, 'plan.md'), '# plan\n');

  execFileSync('git', ['init', '-q'], { cwd });
  execFileSync('git', ['config', 'core.hooksPath', '.beads/hooks'], { cwd });
}

test('projectTreeLitter reports every predecessor marker seeded in a project tree', () => {
  const cwd = mkFixtureDir();
  try {
    seedPredecessorLitter(cwd);
    const findings = projectTreeLitter(cwd);
    const ids = findings.map((f) => f.id).sort();
    assert.deepEqual(ids, [
      'project-agents',
      'project-commands',
      'project-git-hookspath',
      'project-launcher',
      'project-scaffold',
      'project-settings',
      'project-state',
    ]);
    // Every finding names what it is and points at the cleanup surface with
    // the project scope — the whole point of doctor reporting it.
    for (const finding of findings) {
      assert.match(finding.detail, /construct cleanup --scope=project/);
    }
  } finally {
    fs.rmSync(cwd, { recursive: true, force: true });
  }
});

test('projectTreeLitter reports nothing for a clean project tree', () => {
  const cwd = mkFixtureDir();
  try {
    fs.writeFileSync(path.join(cwd, 'package.json'), '{"name":"clean"}\n');
    assert.deepEqual(projectTreeLitter(cwd), []);
  } finally {
    fs.rmSync(cwd, { recursive: true, force: true });
  }
});

test('projectTreeLitter never removes what it finds', () => {
  const cwd = mkFixtureDir();
  try {
    seedPredecessorLitter(cwd);
    projectTreeLitter(cwd);
    assert.ok(fs.existsSync(path.join(cwd, '.construct', 'launcher', 'run.mjs')));
    assert.ok(fs.existsSync(path.join(cwd, 'AGENTS.md')));
  } finally {
    fs.rmSync(cwd, { recursive: true, force: true });
  }
});
