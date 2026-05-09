/**
 * tests/embed-roadmap.test.mjs — roadmap generator unit tests.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, rmSync, existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { generateRoadmap, roadmapSlackSummary, parseRoadmap, reconcileEntries, renderRoadmap } from '../lib/embed/roadmap.mjs';

function makeTmpDir() {
  const dir = join(tmpdir(), `construct-roadmap-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  mkdirSync(dir, { recursive: true });
  return dir;
}

function makeSnapshot(sections = []) {
  return {
    generatedAt: new Date().toISOString(),
    completedAt: new Date().toISOString(),
    sections,
    errors: [],
    summary: { sourceCount: sections.length, totalItems: sections.reduce((n, s) => n + s.items.length, 0), errorCount: 0 },
  };
}

describe('generateRoadmap', () => {
  it('returns skipped=true when no snapshot is provided', async () => {
    const root = makeTmpDir();
    try {
      const result = await generateRoadmap({ targetPath: root, snapshot: null });
      assert.equal(result.skipped, true);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('writes docs/roadmap.md when snapshot has open items', async () => {
    const root = makeTmpDir();
    try {
      const snapshot = makeSnapshot([{
        provider: 'jira',
        items: [
          { type: 'issue', key: 'PROJ-1', summary: 'Fix login bug', status: 'Open', priority: 'High' },
          { type: 'issue', key: 'PROJ-2', summary: 'Add dark mode', status: 'In Progress', priority: 'Medium' },
        ],
      }]);

      const result = await generateRoadmap({ targetPath: root, snapshot });
      assert.ok(!result.skipped);
      assert.equal(result.itemCount, 2);
      assert.ok(existsSync(join(root, 'docs', 'roadmap.md')));

      const content = readFileSync(join(root, 'docs', 'roadmap.md'), 'utf8');
      assert.ok(content.includes('PROJ-1'));
      assert.ok(content.includes('PROJ-2'));
      assert.ok(content.includes('# Roadmap'));
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('includes all items (done items marked with [x])', async () => {
    const root = makeTmpDir();
    try {
      const snapshot = makeSnapshot([{
        provider: 'github',
        items: [
          { type: 'issue', key: 'gh-1', title: 'Open PR', status: 'open' },
          { type: 'issue', key: 'gh-2', title: 'Merged PR', status: 'merged' },
          { type: 'issue', key: 'gh-3', title: 'Closed issue', status: 'closed' },
        ],
      }]);

      const result = await generateRoadmap({ targetPath: root, snapshot });
      // All items are included in the living document
      assert.equal(result.itemCount, 3);

      const content = readFileSync(join(root, 'docs', 'roadmap.md'), 'utf8');
      assert.ok(content.includes('Open PR'));
      assert.ok(content.includes('Merged PR'));
      assert.ok(content.includes('[x]')); // done items checked
      assert.ok(content.includes('[ ]')); // open items unchecked
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('handles snapshot with only done items gracefully', async () => {
    const root = makeTmpDir();
    try {
      const snapshot = makeSnapshot([{
        provider: 'jira',
        items: [
          { type: 'issue', key: 'PROJ-99', summary: 'Done task', status: 'Done' },
        ],
      }]);

      const result = await generateRoadmap({ targetPath: root, snapshot });
      assert.equal(result.itemCount, 1);

      const content = readFileSync(join(root, 'docs', 'roadmap.md'), 'utf8');
      assert.ok(content.includes('[x]'));
      assert.ok(content.includes('Done task'));
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('returns path pointing inside targetPath', async () => {
    const root = makeTmpDir();
    try {
      const snapshot = makeSnapshot([{
        provider: 'linear',
        items: [{ type: 'issue', key: 'LIN-1', summary: 'Build feature', status: 'todo', priority: 'High' }],
      }]);

      const result = await generateRoadmap({ targetPath: root, snapshot });
      assert.ok(result.path.startsWith(root));
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('organizes items by current quarter', async () => {
    const root = makeTmpDir();
    try {
      const snapshot = makeSnapshot([{
        provider: 'jira',
        items: [
          { type: 'issue', key: 'PROJ-10', summary: 'Feature A', status: 'Open' },
        ],
      }]);

      await generateRoadmap({ targetPath: root, snapshot });
      const content = readFileSync(join(root, 'docs', 'roadmap.md'), 'utf8');

      const now = new Date();
      const year = now.getFullYear();
      const q = Math.ceil((now.getMonth() + 1) / 3);
      assert.ok(content.includes(`## ${year}`));
      assert.ok(content.includes(`### Q${q}`));
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('marks new roadmap as isNew=true', async () => {
    const root = makeTmpDir();
    try {
      const snapshot = makeSnapshot([{
        provider: 'jira',
        items: [{ type: 'issue', key: 'X-1', summary: 'Task', status: 'Open' }],
      }]);

      const result = await generateRoadmap({ targetPath: root, snapshot });
      assert.equal(result.isNew, true);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});

describe('roadmapSlackSummary', () => {
  it('returns null when no snapshot provided', async () => {
    const root = makeTmpDir();
    try {
      const result = await roadmapSlackSummary({ targetPath: root, snapshot: null });
      assert.equal(result, null);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('returns a string under 3000 chars with open items', async () => {
    const root = makeTmpDir();
    try {
      const snapshot = makeSnapshot([{
        provider: 'jira',
        items: [
          { type: 'issue', key: 'PROJ-1', summary: 'Fix login', status: 'In Progress', priority: 'High' },
          { type: 'issue', key: 'PROJ-2', summary: 'Add export', status: 'Open', priority: 'Medium' },
        ],
      }]);

      const text = await roadmapSlackSummary({ targetPath: root, snapshot });
      assert.ok(typeof text === 'string');
      assert.ok(text.length <= 3000);
      assert.ok(text.includes('Roadmap'));
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});

describe('parseRoadmap', () => {
  it('returns null for non-existent file', () => {
    const result = parseRoadmap('/tmp/does-not-exist-roadmap.md');
    assert.equal(result, null);
  });
});

describe('reconcileEntries', () => {
  it('adds new snapshot items to entries', () => {
    const entries = reconcileEntries([], [
      { key: 'PROJ-1', summary: 'New feature', status: 'Open' },
    ]);
    assert.equal(entries.length, 1);
    assert.equal(entries[0].title, 'New feature');
    assert.deepEqual(entries[0].refs, ['PROJ-1']);
  });

  it('updates status of existing entries when issue transitions', () => {
    const existing = [{
      title: 'Feature X',
      status: 'planned',
      refs: ['PROJ-5'],
      docs: [],
      theme: null,
      quarter: '2026-Q2',
    }];
    const entries = reconcileEntries(existing, [
      { key: 'PROJ-5', summary: 'Feature X', status: 'In Progress' },
    ]);
    assert.equal(entries[0].status, 'in-progress');
  });
});
