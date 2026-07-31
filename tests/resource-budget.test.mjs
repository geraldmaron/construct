/**
 * tests/resource-budget.test.mjs — disk budget + prune contract.
 *
 * Pins the soft-warn vs hard-reject split, the per-category prune
 * actions (age cap, item cap), and that the planner is pure — actions
 * surface, executePrune applies. Total cap enforcement at 100% (hard for
 * traces / worker logs, soft for intake / task graphs).
 *
 * traces and worker-logs resolve through the machine-scoped state root
 * not project-local `.construct/`, so this suite pins CONSTRUCT_HOME_OVERRIDE
 * to an isolated tmp dir for the whole file — otherwise state-root writes
 * would land on the real developer machine's $HOME.
 */
import { describe, it, beforeEach, afterEach, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import {
  measureUsage,
  reserveOrReject,
  ensureDiskWrite,
  planPrune,
  planEmergencyReclaim,
  executePrune,
  HARD_REJECT_CATEGORIES,
  SOFT_WARN_CATEGORIES,
} from '../lib/resources/budget.mjs';
import { resolveStateDir } from '../lib/state-root.mjs';

const homeOverride = fs.mkdtempSync(path.join(os.tmpdir(), 'construct-budget-home-'));
const prevHomeOverride = process.env.CONSTRUCT_HOME_OVERRIDE;
process.env.CONSTRUCT_HOME_OVERRIDE = homeOverride;

let projectRoot;

beforeEach(() => {
  projectRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'construct-budget-'));
  fs.mkdirSync(path.join(projectRoot, '.git'));
});

afterEach(() => {
  fs.rmSync(projectRoot, { recursive: true, force: true });
});

after(() => {
  try { fs.rmSync(homeOverride, { recursive: true, force: true }); } catch {}
  if (prevHomeOverride === undefined) delete process.env.CONSTRUCT_HOME_OVERRIDE;
  else process.env.CONSTRUCT_HOME_OVERRIDE = prevHomeOverride;
});

// traces/.jsonl and runtime/worker/*.log now resolve through the state root;
// every other `.construct/...` fixture is still project-local. Route each `rel`
// through the same resolver production code uses, so a fixture path always
// matches where the code under test actually looks.

function resolveFixturePath(rel) {
  const normalized = rel.replace(/\\/g, '/');
  if (normalized.startsWith('.construct/traces/')) {
    return path.join(resolveStateDir(projectRoot, 'traces'), normalized.slice('.construct/traces/'.length));
  }
  if (normalized.startsWith('.construct/runtime/worker/')) {
    return path.join(resolveStateDir(projectRoot, 'runtime', 'worker'), normalized.slice('.construct/runtime/worker/'.length));
  }
  return path.join(projectRoot, rel);
}

function writeFile(rel, content, mtimeOffsetMs = 0) {
  const full = resolveFixturePath(rel);
  fs.mkdirSync(path.dirname(full), { recursive: true });
  fs.writeFileSync(full, content);
  if (mtimeOffsetMs) {
    const t = (Date.now() + mtimeOffsetMs) / 1000;
    fs.utimesSync(full, t, t);
  }
  return full;
}

function writeConfig(overrides) {
  fs.writeFileSync(
    path.join(projectRoot, 'construct.config.json'),
    JSON.stringify({ version: 1, ...overrides }),
  );
}

describe('measureUsage', () => {
  it('reports zero for an empty .construct tree', () => {
    const u = measureUsage(projectRoot);
    assert.equal(u.totalConstructBytes, 0);
    assert.equal(u.categories['traces'].bytes, 0);
  });

  it('sums file sizes per category', () => {
    writeFile('.construct/traces/2026-05-14.jsonl', 'x'.repeat(1024));
    writeFile('.construct/task-graphs/g1.json', '{}');
    const u = measureUsage(projectRoot);
    assert.equal(u.categories['traces'].bytes, 1024);
    assert.equal(u.categories['task-graphs'].bytes, 2);
    assert.ok(u.totalConstructBytes >= 1024 + 2);
  });

  it('reads totalConstructMaxMb cap from construct.config.json.resources.disk', () => {
    writeConfig({ resources: { disk: { totalConstructMaxMb: 1 } } });
    const u = measureUsage(projectRoot);
    assert.equal(u.totalConstructCap, 1 * 1024 * 1024);
  });
});

describe('reserveOrReject', () => {
  it('returns ok when usage is well under the cap', () => {
    writeConfig({ resources: { disk: { totalConstructMaxMb: 100 } } });
    const r = reserveOrReject(projectRoot, 'traces', 1024);
    assert.equal(r.ok, true);
    assert.equal(r.warn, undefined);
  });

  it('hard-rejects traces when the total cap is exceeded', () => {
    writeConfig({ resources: { disk: { totalConstructMaxMb: 1 } } });
    writeFile('.construct/traces/today.jsonl', 'x'.repeat(900_000));
    const r = reserveOrReject(projectRoot, 'traces', 200_000);
    assert.equal(r.ok, false);
    assert.equal(r.reason, 'budget-exceeded');
    assert.match(r.message, /construct prune/);
  });

  it('soft-warns intake-archive when over cap (load-bearing — never rejects)', () => {
    writeConfig({ resources: { disk: { totalConstructMaxMb: 1 } } });
    writeFile('.construct/intake/processed/p1.json', 'x'.repeat(900_000));
    const r = reserveOrReject(projectRoot, 'intake-archive', 200_000);
    assert.equal(r.ok, true);
    assert.equal(r.warn, true);
    assert.equal(r.reason, 'budget-warning');
  });

  it('warns at 80% even when not exceeded', () => {
    writeConfig({ resources: { disk: { totalConstructMaxMb: 1 } } });
    writeFile('.construct/traces/today.jsonl', 'x'.repeat(850_000));
    const r = reserveOrReject(projectRoot, 'traces', 1024);
    assert.equal(r.ok, true);
    assert.equal(r.warn, true);
  });

  it('returns ok for unknown categories without enforcing', () => {
    const r = reserveOrReject(projectRoot, 'some-other', 999_999_999);
    assert.equal(r.ok, true);
  });
});

describe('ensureDiskWrite + planEmergencyReclaim', () => {
  it('emergency-reclaims oldest hard-reject files to allow a trace write', () => {
    writeConfig({ resources: { disk: { totalConstructMaxMb: 1 } } });
    const oldTrace = writeFile('.construct/traces/old.jsonl', 'x'.repeat(520_000), -7 * 24 * 60 * 60 * 1000);
    writeFile('.construct/traces/new.jsonl', 'x'.repeat(520_000));
    const gate = ensureDiskWrite(projectRoot, 'traces', 200_000);
    assert.equal(gate.ok, true);
    assert.ok((gate.reclaimed?.bytesFreed ?? 0) > 0);
    assert.equal(fs.existsSync(oldTrace), false);
  });

  it('planEmergencyReclaim targets oldest traces and worker logs first', () => {
    writeConfig({ resources: { disk: { totalConstructMaxMb: 1 } } });
    writeFile('.construct/traces/a.jsonl', 'a'.repeat(300_000), -3 * 24 * 60 * 60 * 1000);
    writeFile('.construct/traces/b.jsonl', 'b'.repeat(300_000), -1 * 24 * 60 * 60 * 1000);
    writeFile('.construct/runtime/worker/job.stdout.log', 'c'.repeat(300_000), -2 * 24 * 60 * 60 * 1000);
    const actions = planEmergencyReclaim(projectRoot, 500_000);
    assert.ok(actions.length >= 2);
    assert.match(actions[0].path, /a\.jsonl$/);
  });

  it('still rejects when emergency reclaim cannot free enough space', () => {
    writeConfig({ resources: { disk: { totalConstructMaxMb: 1 } } });
    writeFile('.construct/intake/processed/p1.json', 'x'.repeat(950_000));
    const gate = ensureDiskWrite(projectRoot, 'traces', 200_000);
    assert.equal(gate.ok, false);
    assert.equal(gate.reason, 'budget-exceeded');
  });
});

describe('planPrune + executePrune', () => {
  it('plans removal of traces older than tracesMaxDays', () => {
    writeConfig({ resources: { disk: { tracesMaxDays: 7 } } });
    writeFile('.construct/traces/old.jsonl', 'old', -30 * 24 * 60 * 60 * 1000);
    writeFile('.construct/traces/new.jsonl', 'new');
    const actions = planPrune(projectRoot);
    const tracesActions = actions.filter((a) => a.category === 'traces');
    assert.equal(tracesActions.length, 1);
    assert.match(tracesActions[0].path, /old\.jsonl$/);
  });

  it('plans removal of intake archive items above the count cap (newest kept)', () => {
    writeConfig({ resources: { disk: { intakeArchiveMaxItems: 2, intakeArchiveMaxDays: 999 } } });
    for (let i = 0; i < 5; i++) {
      writeFile(`.construct/intake/processed/p${i}.json`, '{}', -i * 1000);
    }
    const actions = planPrune(projectRoot);
    const archiveActions = actions.filter((a) => a.category === 'intake-archive');
    assert.equal(archiveActions.length, 3);
  });

  it('plans removal of backups older than backupsMaxDays', () => {
    writeConfig({ resources: { disk: { backupsMaxDays: 30 } } });
    writeFile('.construct/backups/personas/construct.2025-01-01.md', 'old', -180 * 24 * 60 * 60 * 1000);
    writeFile('.construct/backups/personas/construct.now.md', 'new');
    const actions = planPrune(projectRoot);
    const backupActions = actions.filter((a) => a.category === 'backups');
    assert.equal(backupActions.length, 1);
    assert.match(backupActions[0].path, /2025-01-01\.md$/);
  });

  it('executePrune removes every planned file and returns bytesFreed', () => {
    writeConfig({ resources: { disk: { tracesMaxDays: 1 } } });
    const oldTrace = writeFile('.construct/traces/old.jsonl', 'x'.repeat(500), -7 * 24 * 60 * 60 * 1000);
    const actions = planPrune(projectRoot);
    const result = executePrune(actions);
    assert.equal(result.removed.length, 1);
    assert.equal(result.bytesFreed, 500);
    assert.equal(fs.existsSync(oldTrace), false);
  });

  it('is a no-op when no files are over caps', () => {
    writeFile('.construct/traces/fresh.jsonl', 'x');
    const actions = planPrune(projectRoot);
    assert.deepEqual(actions, []);
  });
});

describe('category enforcement classification', () => {
  it('classifies traces and worker-logs as hard-reject', () => {
    assert.ok(HARD_REJECT_CATEGORIES.has('traces'));
    assert.ok(HARD_REJECT_CATEGORIES.has('worker-logs'));
  });

  it('classifies load-bearing R&D state as soft-warn', () => {
    assert.ok(SOFT_WARN_CATEGORIES.has('intake-archive'));
    assert.ok(SOFT_WARN_CATEGORIES.has('task-graphs'));
    assert.ok(SOFT_WARN_CATEGORIES.has('backups'));
  });
});
