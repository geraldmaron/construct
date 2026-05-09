/**
 * tests/embed-docs-lifecycle.test.mjs — docs lifecycle job tests.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { tmpdir } from 'node:os';
import { mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { detectDocGaps, runDocsLifecycle } from '../lib/embed/docs-lifecycle.mjs';

function makeTmpTarget() {
  const dir = join(tmpdir(), `construct-test-docs-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  mkdirSync(join(dir, 'docs', 'adrs'), { recursive: true });
  mkdirSync(join(dir, 'docs', 'notes'), { recursive: true });
  return { type: 'repo', path: dir, access: 'local', docs: null };
}

describe('detectDocGaps', () => {
  it('detects missing roadmap when snapshot has sections', () => {
    const target = makeTmpTarget();
    try {
      const gaps = detectDocGaps(target, { snapshot: { sections: [{ title: 'Open' }] } });
      const roadmapGap = gaps.find((g) => g.type === 'missing-roadmap');
      assert.ok(roadmapGap, 'should detect missing roadmap');
    } finally {
      rmSync(target.path, { recursive: true, force: true });
    }
  });

  it('detects empty docs lanes', () => {
    const target = makeTmpTarget();
    try {
      const gaps = detectDocGaps(target, {});
      // adrs is empty, should be flagged
      const adrGap = gaps.find((g) => g.lane === 'adrs');
      assert.ok(adrGap, 'empty adrs lane should produce a gap');
    } finally {
      rmSync(target.path, { recursive: true, force: true });
    }
  });

  it('no gap for populated docs lane', () => {
    const target = makeTmpTarget();
    writeFileSync(join(target.path, 'docs', 'adrs', '001-init.md'), '# ADR 001\nAccepted.');
    try {
      const gaps = detectDocGaps(target, {});
      const adrGap = gaps.find((g) => g.lane === 'adrs');
      assert.equal(adrGap, undefined, 'populated adrs should not produce a gap');
    } finally {
      rmSync(target.path, { recursive: true, force: true });
    }
  });
});

describe('runDocsLifecycle', () => {
  it('runs without error on minimal config', async () => {
    const result = await runDocsLifecycle({
      config: { targets: [{ type: 'workspace' }] },
      providerRegistry: null,
      snapshot: null,
      authorityGuard: null,
      signals: {},
    });
    assert.ok(result.targets >= 1);
    assert.ok(Array.isArray(result.gaps));
    assert.ok(Array.isArray(result.actions));
  });

  it('queues high-risk gaps when authorityGuard denies', async () => {
    const guard = {
      async check() { return { allowed: false, queueId: 'q-123' }; },
    };
    const target = makeTmpTarget();
    try {
      const result = await runDocsLifecycle({
        config: { targets: [{ type: 'repo', path: target.path }] },
        providerRegistry: null,
        snapshot: null,
        authorityGuard: guard,
        signals: {},
      });
      const queued = result.actions.filter((a) => a.action === 'queued');
      // adrs lane is empty → high risk → queued
      assert.ok(queued.length > 0, 'should have queued actions for high-risk gaps');
    } finally {
      rmSync(target.path, { recursive: true, force: true });
    }
  });
});
