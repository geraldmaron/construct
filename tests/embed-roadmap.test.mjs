/**
 * tests/embed-roadmap.test.mjs — roadmap generator unit tests.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, rmSync, existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { generateRoadmap, roadmapSlackSummary } from '../lib/embed/roadmap.mjs';
import { DEFAULT_OPERATING_PROFILE } from '../lib/embed/config.mjs';

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
      const result = await generateRoadmap({ rootDir: root, snapshot: null });
      assert.equal(result.skipped, true);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('writes .cx/roadmap.md when snapshot has open items', async () => {
    const root = makeTmpDir();
    try {
      const snapshot = makeSnapshot([{
        provider: 'jira',
        items: [
          { type: 'issue', key: 'PROJ-1', summary: 'Fix login bug', status: 'Open', priority: 'High' },
          { type: 'issue', key: 'PROJ-2', summary: 'Add dark mode', status: 'In Progress', priority: 'Medium' },
        ],
      }]);

      const result = await generateRoadmap({ rootDir: root, snapshot });
      assert.ok(!result.skipped);
      assert.equal(result.itemCount, 2);
      assert.ok(existsSync(join(root, '.cx', 'roadmap.md')));

      const content = readFileSync(join(root, '.cx', 'roadmap.md'), 'utf8');
      assert.ok(content.includes('PROJ-1'));
      assert.ok(content.includes('PROJ-2'));
      assert.ok(content.includes('# Construct Roadmap'));
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('excludes done/closed items from roadmap', async () => {
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

      const result = await generateRoadmap({ rootDir: root, snapshot });
      assert.equal(result.itemCount, 1);

      const content = readFileSync(join(root, '.cx', 'roadmap.md'), 'utf8');
      assert.ok(content.includes('Open PR'));
      assert.ok(!content.includes('Merged PR'));
      assert.ok(!content.includes('Closed issue'));
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('sorts high priority items before low priority', async () => {
    const root = makeTmpDir();
    try {
      const snapshot = makeSnapshot([{
        provider: 'jira',
        items: [
          { type: 'issue', key: 'PROJ-10', summary: 'Low task', status: 'Open', priority: 'Low' },
          { type: 'issue', key: 'PROJ-11', summary: 'Critical task', status: 'Open', priority: 'Critical' },
          { type: 'issue', key: 'PROJ-12', summary: 'Medium task', status: 'Open', priority: 'Medium' },
        ],
      }]);

      await generateRoadmap({ rootDir: root, snapshot });
      const content = readFileSync(join(root, '.cx', 'roadmap.md'), 'utf8');

      const critIdx = content.indexOf('PROJ-11');
      const medIdx = content.indexOf('PROJ-12');
      const lowIdx = content.indexOf('PROJ-10');

      assert.ok(critIdx < medIdx, 'Critical should appear before Medium');
      assert.ok(medIdx < lowIdx, 'Medium should appear before Low');
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('handles snapshot with no open items gracefully', async () => {
    const root = makeTmpDir();
    try {
      const snapshot = makeSnapshot([{
        provider: 'jira',
        items: [
          { type: 'issue', key: 'PROJ-99', summary: 'Done task', status: 'Done' },
        ],
      }]);

      const result = await generateRoadmap({ rootDir: root, snapshot });
      assert.equal(result.itemCount, 0);

      const content = readFileSync(join(root, '.cx', 'roadmap.md'), 'utf8');
      assert.ok(content.includes('No open items'));
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('returns path pointing inside rootDir', async () => {
    const root = makeTmpDir();
    try {
      const snapshot = makeSnapshot([{
        provider: 'linear',
        items: [{ type: 'issue', key: 'LIN-1', summary: 'Build feature', status: 'todo', priority: 'High' }],
      }]);

      const result = await generateRoadmap({ rootDir: root, snapshot });
      assert.ok(result.path.startsWith(root));
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('includes operating profile obligations when present', async () => {
    const root = makeTmpDir();
    try {
      const snapshot = {
        ...makeSnapshot([]),
        operatingProfile: DEFAULT_OPERATING_PROFILE,
        operatingGaps: [{ severity: 'attention', summary: 'No snapshot outputs are configured.' }],
      };

      await generateRoadmap({ rootDir: root, snapshot });
      const content = readFileSync(join(root, '.cx', 'roadmap.md'), 'utf8');
      assert.ok(content.includes('## Operating Profile'));
      assert.ok(content.includes('## Operating Gaps'));
      assert.ok(content.includes('wireframes (draft)'));
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});

describe('roadmapSlackSummary', () => {
  it('returns null when no snapshot provided', async () => {
    const root = makeTmpDir();
    try {
      const result = await roadmapSlackSummary({ rootDir: root, snapshot: null });
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
          { type: 'issue', key: 'PROJ-1', summary: 'Fix login', status: 'Open', priority: 'High' },
          { type: 'issue', key: 'PROJ-2', summary: 'Add export', status: 'Open', priority: 'Medium' },
        ],
      }]);

      const text = await roadmapSlackSummary({ rootDir: root, snapshot });
      assert.ok(typeof text === 'string');
      assert.ok(text.length <= 3000);
      assert.ok(text.includes('Roadmap'));
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
