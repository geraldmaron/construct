/**
 * tests/embed-snapshot.test.mjs — snapshot engine and markdown renderer tests.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { SnapshotEngine, renderMarkdown } from '../lib/embed/snapshot.mjs';
import { ProviderRegistry } from '../providers/lib/registry.mjs';
import { normalize, DEFAULT_OPERATING_PROFILE } from '../lib/embed/config.mjs';

function makeRegistry(providers = []) {
  const reg = new ProviderRegistry();
  for (const p of providers) reg.register(p);
  return reg;
}

describe('SnapshotEngine', () => {
  it('generates a snapshot with no sources', async () => {
    const engine = new SnapshotEngine(makeRegistry(), { sources: [], snapshot: { maxItems: 10 } });
    const snap = await engine.generate();
    assert.equal(snap.sections.length, 0);
    assert.equal(snap.errors.length, 0);
    assert.equal(snap.summary.totalItems, 0);
    assert.equal(snap.operatingProfile.mode, 'embed');
    assert.ok(snap.operatingGaps.some((gap) => gap.kind === 'missing-sources'));
  });

  it('includes operating profile and detects missing focal resources', async () => {
    const rootDir = mkdtempSync(join(tmpdir(), 'construct-snapshot-profile-'));
    mkdirSync(join(rootDir, '.cx', 'knowledge'), { recursive: true });
    writeFileSync(join(rootDir, 'plan.md'), '# Plan\n');
    const engine = new SnapshotEngine(makeRegistry(), {
      sources: [],
      outputs: [{ type: 'markdown', path: '.cx/snapshot.md' }],
      snapshot: { maxItems: 10 },
      operatingProfile: DEFAULT_OPERATING_PROFILE,
    }, { rootDir });

    const snap = await engine.generate();

    assert.equal(snap.operatingProfile.schemaVersion, 'embed-operating-profile/v1');
    assert.ok(snap.operatingGaps.some((gap) => gap.summary.includes('docs/architecture.md')));
  });

  it('collects items from a source', async () => {
    const fakeProvider = {
      name: 'fake',
      capabilities: ['read'],
      async init() {},
      async read() {
        return [
          { type: 'issue', key: 'FAKE-1', summary: 'Test issue', status: 'Open' },
          { type: 'issue', key: 'FAKE-2', summary: 'Another', status: 'Done' },
        ];
      },
    };
    const reg = makeRegistry([fakeProvider]);
    const config = {
      sources: [{ provider: 'fake', refs: ['issues'], intervalMs: 60_000 }],
      snapshot: { maxItems: 100 },
    };
    const engine = new SnapshotEngine(reg, config);
    const snap = await engine.generate();
    assert.equal(snap.sections.length, 1);
    assert.equal(snap.sections[0].items.length, 2);
    assert.equal(snap.summary.totalItems, 2);
    assert.equal(snap.errors.length, 0);
  });

  it('records errors for unregistered providers', async () => {
    const reg = makeRegistry();
    const config = {
      sources: [{ provider: 'missing', refs: ['status'], intervalMs: 60_000 }],
      snapshot: { maxItems: 10 },
    };
    const engine = new SnapshotEngine(reg, config);
    const snap = await engine.generate();
    assert.equal(snap.errors.length, 1);
    assert.ok(snap.errors[0].error.includes('not registered'));
  });

  it('records errors when a provider read throws', async () => {
    const badProvider = {
      name: 'bad',
      capabilities: ['read'],
      async init() {},
      async read() { throw new Error('network failure'); },
    };
    const reg = makeRegistry([badProvider]);
    const config = {
      sources: [{ provider: 'bad', refs: ['commits'], intervalMs: 60_000 }],
      snapshot: { maxItems: 10 },
    };
    const engine = new SnapshotEngine(reg, config);
    const snap = await engine.generate();
    assert.equal(snap.errors.length, 1);
    assert.ok(snap.errors[0].error.includes('network failure'));
  });

  it('respects maxItems per source', async () => {
    const bigProvider = {
      name: 'big',
      capabilities: ['read'],
      async init() {},
      async read() { return Array.from({ length: 200 }, (_, i) => ({ type: 'item', id: i })); },
    };
    const reg = makeRegistry([bigProvider]);
    const config = {
      sources: [{ provider: 'big', refs: ['all'], intervalMs: 60_000 }],
      snapshot: { maxItems: 5 },
    };
    const engine = new SnapshotEngine(reg, config);
    const snap = await engine.generate();
    assert.equal(snap.sections[0].items.length, 5);
  });
});

describe('renderMarkdown', () => {
  it('renders a snapshot to markdown', async () => {
    const fakeProvider = {
      name: 'fake',
      capabilities: ['read'],
      async init() {},
      async read() { return [{ type: 'commit', hash: 'a'.repeat(40), subject: 'fix bug', author: 'alice' }]; },
    };
    const reg = makeRegistry([fakeProvider]);
    const engine = new SnapshotEngine(reg, {
      sources: [{ provider: 'fake', refs: ['commits'], intervalMs: 60_000 }],
      snapshot: { maxItems: 10 },
    });
    const snap = await engine.generate();
    const md = renderMarkdown(snap);
    assert.ok(md.includes('# Construct Snapshot'));
    assert.ok(md.includes('## Operating Profile'));
    assert.ok(md.includes('fix bug'));
    assert.ok(md.includes('alice'));
  });

  it('includes error section when there are errors', () => {
    const snap = {
      generatedAt: new Date().toISOString(),
      completedAt: new Date().toISOString(),
      sections: [],
      errors: [{ source: 'github', ref: 'prs', error: 'timeout' }],
      summary: { sourceCount: 1, totalItems: 0, errorCount: 1 },
    };
    const md = renderMarkdown(snap);
    assert.ok(md.includes('⚠️ Errors'));
    assert.ok(md.includes('timeout'));
  });
});

describe('embed operating profile config', () => {
  it('normalizes operating profile overrides while preserving defaults', () => {
    const config = normalize({
      operatingProfile: {
        mission: 'Watch release readiness.',
        strategy: { autonomy: 'recommend-only' },
      },
    });

    assert.equal(config.operatingProfile.mission, 'Watch release readiness.');
    assert.equal(config.operatingProfile.strategy.autonomy, 'recommend-only');
    assert.equal(config.operatingProfile.strategy.writePolicy, 'approval-required-for-high-risk');
    assert.equal(config.operatingProfile.responsibilities.artifacts.wireframes, 'draft');
  });
});
