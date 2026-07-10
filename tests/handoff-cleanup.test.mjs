/**
 * tests/handoff-cleanup.test.mjs — plan + execute handoff cleanup in a temp directory.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test, { after } from 'node:test';
import { planHandoffCleanup, executeHandoffCleanup } from '../lib/handoffs/cleanup.mjs';
import { formatHandoff } from '../lib/handoffs/contract.mjs';

const tmpDirs = [];
after(() => {
  for (const dir of tmpDirs) {
    try { fs.rmSync(dir, { recursive: true, force: true }); } catch {}
  }
});

function makeTmpProject() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'cx-cleanup-'));
  tmpDirs.push(root);
  const handoffsDir = path.join(root, '.construct', 'handoffs');
  const archiveDir = path.join(handoffsDir, 'archive');
  fs.mkdirSync(archiveDir, { recursive: true });
  fs.mkdirSync(path.join(root, '.construct'), { recursive: true });
  // .git dir stops findProjectConfigPath from walking up to the real repo
  fs.mkdirSync(path.join(root, '.git'), { recursive: true });
  fs.writeFileSync(path.join(root, 'construct.config.json'), JSON.stringify({ version: 1, resources: { disk: { handoffsMaxDays: 7, handoffsMaxItems: 5 } } }));
  return { root, handoffsDir, archiveDir };
}

function writeHandoff(dir, filename, overrides = {}) {
  const text = formatHandoff({ id: filename.replace('.md', ''), title: `Test ${filename}`, whatWasDone: 'Done.', whatsLeft: 'Nothing.', ...overrides });
  const full = path.join(dir, filename);
  fs.writeFileSync(full, text);
  return full;
}

function backdate(filePath, daysAgo) {
  const ms = Date.now() - daysAgo * 24 * 60 * 60 * 1000;
  fs.utimesSync(filePath, new Date(ms), new Date(ms));
}

test('planHandoffCleanup leaves open handoffs alone', () => {
  const { root, handoffsDir } = makeTmpProject();
  const f = writeHandoff(handoffsDir, 'open-work.md', { beads: ['construct-zzz'] });
  backdate(f, 30);
  const plan = planHandoffCleanup(root, process.env);
  assert.equal(plan.actions.length, 0, 'open handoffs with unknown beads should not be archived');
});

test('planHandoffCleanup marks archived files past 2x retention for deletion', () => {
  const { root, archiveDir } = makeTmpProject();
  const f = writeHandoff(archiveDir, 'ancient.md');
  backdate(f, 20);
  const plan = planHandoffCleanup(root, process.env);
  const deletes = plan.actions.filter((a) => a.kind === 'delete');
  assert.equal(deletes.length, 1);
  assert.ok(deletes[0].path.endsWith('ancient.md'));
});

test('executeHandoffCleanup deletes planned files', () => {
  const { root, archiveDir } = makeTmpProject();
  const f = writeHandoff(archiveDir, 'to-delete.md');
  backdate(f, 20);
  const plan = planHandoffCleanup(root, process.env);
  const result = executeHandoffCleanup(plan);
  assert.equal(result.deleted.length, 1);
  assert.ok(!fs.existsSync(f));
});

test('planHandoffCleanup warns when too many live handoffs', () => {
  const { root, handoffsDir } = makeTmpProject();
  for (let i = 0; i < 7; i++) writeHandoff(handoffsDir, `live-${i}.md`, { beads: [`construct-live${i}`] });
  const plan = planHandoffCleanup(root, process.env);
  assert.ok(plan.warnings.length > 0);
  assert.ok(plan.warnings[0].includes('exceeds maxItems'));
});
