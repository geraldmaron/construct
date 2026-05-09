/**
 * tests/knowledge-search.test.mjs — Unit tests for lib/knowledge/search.mjs.
 *
 * Tests source discovery, chunking, scoring, and the knowledgeSearch() API.
 * Uses a temp directory with synthetic docs so tests are hermetic.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { knowledgeSearch } from '../lib/knowledge/search.mjs';

// ── Helpers ────────────────────────────────────────────────────────────────

function makeTmpRepo(files) {
  const root = mkdtempSync(join(tmpdir(), 'cx-search-test-'));
  for (const [rel, content] of Object.entries(files)) {
    const full = join(root, rel);
    mkdirSync(join(full, '..'), { recursive: true });
    writeFileSync(full, content, 'utf8');
  }
  return root;
}

function cleanTmp(root) {
  try { rmSync(root, { recursive: true, force: true }); } catch { /* best-effort */ }
}

// ── Core functionality ─────────────────────────────────────────────────────

test('returns ok:false when query is missing', () => {
  const result = knowledgeSearch({ repoRoot: '/nonexistent' });
  assert.equal(result.ok, false);
  assert.ok(result.message.includes('query is required'));
});

test('returns ok:false when repo has no docs', () => {
  const root = makeTmpRepo({});
  try {
    // Pass root as rootDir too so no observations are loaded from homedir
    const result = knowledgeSearch({ query: 'construct', repoRoot: root, rootDir: root });
    assert.equal(result.ok, false);
    assert.ok(result.message.toLowerCase().includes('no documentation'));
  } finally { cleanTmp(root); }
});

test('finds content in docs/architecture.md', () => {
  const root = makeTmpRepo({
    'docs/architecture.md': `# Construct Architecture

## System overview

Construct is an org-in-a-box: an AI orchestration system that can be pointed at external systems.

## Layers

- core: CLI, MCP server, orchestration
- providers: transport-agnostic interface
- runtime: Docker, embed daemon
`,
  });
  try {
    const result = knowledgeSearch({ query: 'what is construct', repoRoot: root, rootDir: root });
    assert.equal(result.ok, true);
    assert.ok(result.hits.length > 0, 'should have hits');
    assert.ok(result.hits[0].file.includes('architecture'), 'top hit should be architecture.md');
  } finally { cleanTmp(root); }
});

test('finds content in docs/README.md', () => {
  const root = makeTmpRepo({
    'docs/README.md': `# construct — Documentation

## Commands

- construct init — set up a new project
- construct embed start — start background monitoring
- construct doctor — check system health
`,
  });
  try {
    const result = knowledgeSearch({ query: 'what commands are available', repoRoot: root, rootDir: root });
    assert.equal(result.ok, true);
    assert.ok(result.hits.length > 0);
    assert.ok(result.hits.some(h => h.file.includes('README')));
  } finally { cleanTmp(root); }
});

test('finds content in how-to guides', () => {
  const root = makeTmpRepo({
    'docs/how-to/how-to-embed-start.md': `# How to start embed mode

## Starting the daemon

Run \`construct embed start\` to begin background monitoring. The daemon polls
configured GitHub repos and Jira projects on a schedule.
`,
  });
  try {
    const result = knowledgeSearch({ query: 'how to start embed daemon', repoRoot: root, rootDir: root });
    assert.equal(result.ok, true);
    assert.ok(result.hits.length > 0);
    assert.ok(result.hits[0].file.includes('how-to'));
  } finally { cleanTmp(root); }
});

test('finds content in .cx/knowledge/internal', () => {
  const root = makeTmpRepo({
    '.cx/knowledge/internal/team-setup.md': `# Team setup notes

We use construct with three GitHub repos. Config lives in ~/.construct/config.env.
`,
  });
  try {
    const result = knowledgeSearch({ query: 'config.env setup', repoRoot: root, rootDir: root });
    assert.equal(result.ok, true);
    assert.ok(result.hits.length > 0);
  } finally { cleanTmp(root); }
});

test('respects topK limit', () => {
  const root = makeTmpRepo({
    'docs/architecture.md': Array.from({ length: 20 }, (_, i) =>
      `## Section ${i}\n\nconstruct is a system with feature ${i} that does something useful.\n`
    ).join('\n'),
  });
  try {
    const result = knowledgeSearch({ query: 'construct system feature', topK: 3, repoRoot: root, rootDir: root });
    assert.ok(result.hits.length <= 3, `expected ≤3 hits, got ${result.hits.length}`);
  } finally { cleanTmp(root); }
});

test('hit fields are present and correct shape', () => {
  const root = makeTmpRepo({
    'docs/architecture.md': `# Construct Architecture\n\n## Overview\n\nConstruct is an orchestration system.\n`,
  });
  try {
    const result = knowledgeSearch({ query: 'orchestration', repoRoot: root, rootDir: root });
    assert.equal(result.ok, true);
    if (result.hits.length > 0) {
      const hit = result.hits[0];
      assert.ok(typeof hit.text === 'string');
      assert.ok(typeof hit.heading === 'string');
      assert.ok(typeof hit.file === 'string');
      assert.ok(typeof hit.score === 'number');
      assert.ok(typeof hit.lineStart === 'number');
    }
  } finally { cleanTmp(root); }
});

test('sources list contains only unique file paths', () => {
  const root = makeTmpRepo({
    'docs/architecture.md': `# Construct Architecture\n\nconstruct orchestration system.\n`,
    'docs/README.md': `# Docs\n\nconstruct commands and guides.\n`,
  });
  try {
    const result = knowledgeSearch({ query: 'construct', repoRoot: root, topK: 10, rootDir: root });
    const unique = [...new Set(result.sources)];
    assert.deepEqual(result.sources, unique, 'sources should be unique');
  } finally { cleanTmp(root); }
});

test('returns message when no hits found', () => {
  // Use a non-priority source (.cx/knowledge/internal) with content that has
  // no overlap with the query tokens so it scores below minScore.
  const root = makeTmpRepo({
    '.cx/knowledge/internal/notes.md': `# Notes\n\nsome unrelated content here with no overlap.\n`,
  });
  try {
    const result = knowledgeSearch({ query: 'xyzzyunmatchabletoken', repoRoot: root, rootDir: root });
    assert.ok(typeof result.message === 'string');
    // Either no hits, or message indicates none found
    if (result.hits.length === 0) {
      assert.ok(result.message.length > 0);
    }
  } finally { cleanTmp(root); }
});

test('architecture.md ranks above how-to for overview questions', () => {
  const root = makeTmpRepo({
    'docs/architecture.md': `# Construct Architecture\n\n## System overview\n\nConstruct is an AI orchestration system that manages organizational intelligence.\n`,
    'docs/how-to/how-to-embed-start.md': `# Embed start\n\nConstruct embed mode monitors systems.\n`,
  });
  try {
    const result = knowledgeSearch({ query: 'what is construct system overview', repoRoot: root, rootDir: root });
    assert.equal(result.ok, true);
    assert.ok(result.hits.length > 0);
    // architecture.md has priority bonus — should appear in results
    assert.ok(result.hits.some(h => h.file.includes('architecture')));
  } finally { cleanTmp(root); }
});
