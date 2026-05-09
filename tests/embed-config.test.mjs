/**
 * tests/embed-config.test.mjs — embed config loader and YAML parser tests.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { parseEmbedYaml, normalize } from '../lib/embed/config.mjs';

describe('parseEmbedYaml', () => {
  it('parses a minimal embed config', () => {
    const yaml = `
sources:
  - provider: github
    refs:
      - prs
      - issues
    intervalMs: 30000

outputs:
  - type: markdown
    path: .cx/snapshot.md

snapshot:
  intervalMs: 120000
  maxItems: 50

approval:
  require:
    - pr.merge
    - issue.create
  timeout_ms: 1800000
  fallback: reject
`;
    const parsed = parseEmbedYaml(yaml);
    assert.ok(Array.isArray(parsed.sources));
    assert.equal(parsed.sources[0].provider, 'github');
    assert.ok(Array.isArray(parsed.sources[0].refs));
    assert.ok(parsed.sources[0].refs.includes('prs'));
    assert.equal(parsed.snapshot.intervalMs, 120000);
    assert.equal(parsed.approval.fallback, 'reject');
    assert.ok(Array.isArray(parsed.approval.require));
  });

  it('parses scalar types correctly', () => {
    const yaml = `
key1: true
key2: false
key3: 42
key4: hello
key5: "quoted string"
`;
    const parsed = parseEmbedYaml(yaml);
    assert.equal(parsed.key1, true);
    assert.equal(parsed.key2, false);
    assert.equal(parsed.key3, 42);
    assert.equal(parsed.key4, 'hello');
    assert.equal(parsed.key5, 'quoted string');
  });

  it('ignores comment lines', () => {
    const yaml = `
# This is a comment
key: value
# Another comment
`;
    const parsed = parseEmbedYaml(yaml);
    assert.equal(parsed.key, 'value');
  });
});

describe('normalize', () => {
  it('applies defaults for missing keys', () => {
    const config = normalize({ sources: [], outputs: [] });
    assert.equal(config.snapshot.intervalMs, 300_000);
    assert.equal(config.snapshot.maxItems, 100);
    assert.deepEqual(config.approval.require, []);
    assert.equal(config.approval.fallback, 'reject');
  });

  it('normalizes sources with default intervalMs', () => {
    const config = normalize({
      sources: [{ provider: 'git', refs: ['commits'] }],
    });
    assert.equal(config.sources[0].intervalMs, 60_000);
  });

  it('throws when source is missing provider', () => {
    assert.throws(
      () => normalize({ sources: [{ refs: ['commits'] }] }),
      /provider/,
    );
  });

  it('throws when output is missing type', () => {
    assert.throws(
      () => normalize({ sources: [], outputs: [{ path: 'foo.md' }] }),
      /type/,
    );
  });
});
