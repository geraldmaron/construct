/**
 * tests/validator-caps.test.mjs — registry validator length-cap tests.
 *
 * Verifies the validator rejects:
 *   - agent / persona descriptions over 240 chars
 *   - persona displayName over 60 chars
 *   - inline prompts (or promptFile contents) over 4000 words, unless an
 *     entry explicitly bumps the cap via `wordCapOverride`.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, it, before, after } from 'node:test';
import { validateRegistry } from '../lib/validator.mjs';

let tmpRoot;

before(() => {
  tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'construct-validator-caps-'));
  fs.mkdirSync(path.join(tmpRoot, 'personas'), { recursive: true });
});

after(() => {
  fs.rmSync(tmpRoot, { recursive: true, force: true });
});

function baseRegistry() {
  return {
    version: 1,
    system: 'cx',
    prefix: 'cx',
    models: {
      reasoning: { primary: 'anthropic/claude-opus-4-7', fallback: [] },
      standard: { primary: 'anthropic/claude-sonnet-4-6', fallback: [] },
      fast: { primary: 'anthropic/claude-haiku-4-5', fallback: [] },
    },
    specialists: [{ name: 'a', description: 'short', prompt: 'hello world', model: 'anthropic/claude-sonnet-4-6' }],
    orchestrator: {
      name: 'construct', displayName: 'Construct', description: 'short', role: 'r',
      promptFile: 'personas/construct.md', model: 'anthropic/claude-opus-4-7',
    },
  };
}

describe('validator length caps', () => {
  it('rejects a specialist description over 240 chars', () => {
    fs.writeFileSync(path.join(tmpRoot, 'personas', 'construct.md'), '# stub\n');
    const reg = baseRegistry();
    reg.specialists[0].description = 'x'.repeat(300);
    const r = validateRegistry(reg, { rootDir: tmpRoot });
    assert.equal(r.valid, false);
    assert.ok(r.errors.some((e) => /description exceeds 240 chars/.test(e)));
  });

  it('rejects an orchestrator displayName over 60 chars', () => {
    fs.writeFileSync(path.join(tmpRoot, 'personas', 'construct.md'), '# stub\n');
    const reg = baseRegistry();
    reg.orchestrator.displayName = 'X'.repeat(80);
    const r = validateRegistry(reg, { rootDir: tmpRoot });
    assert.equal(r.valid, false);
    assert.ok(r.errors.some((e) => /displayName exceeds 60 chars/.test(e)));
  });

  it('rejects an inline specialist prompt over 4000 words by default', () => {
    fs.writeFileSync(path.join(tmpRoot, 'personas', 'construct.md'), '# stub\n');
    const reg = baseRegistry();
    reg.specialists[0].prompt = 'word '.repeat(5000).trim();
    const r = validateRegistry(reg, { rootDir: tmpRoot });
    assert.equal(r.valid, false);
    assert.ok(r.errors.some((e) => /exceeds cap of 4000/.test(e)), JSON.stringify(r.errors));
  });

  it('respects wordCapOverride to lift the limit for a specific specialist', () => {
    fs.writeFileSync(path.join(tmpRoot, 'personas', 'construct.md'), '# stub\n');
    const reg = baseRegistry();
    reg.specialists[0].prompt = 'word '.repeat(5000).trim();
    reg.specialists[0].wordCapOverride = 6000;
    const r = validateRegistry(reg, { rootDir: tmpRoot });
    assert.equal(r.valid, true, JSON.stringify(r.errors));
  });

  it('rejects when orchestrator promptFile contents exceed the cap', () => {
    const longPrompt = 'word '.repeat(5000).trim();
    fs.writeFileSync(path.join(tmpRoot, 'personas', 'construct.md'), longPrompt);
    const reg = baseRegistry();
    const r = validateRegistry(reg, { rootDir: tmpRoot });
    assert.equal(r.valid, false);
    assert.ok(r.errors.some((e) => /exceeds cap of 4000/.test(e)));
  });
});
