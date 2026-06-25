/**
 * tests/agents-schema.test.mjs — pin the registry validation contract.
 *
 * The check that matters most: an unknown tool name in claudeTools must
 * error. Host platforms silently drop unknown tools, so a typo here is
 * the difference between an agent that works and one that doesn't, with
 * no runtime error to catch it.
 */

import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, it, beforeEach, afterEach } from 'node:test';

import {
  ALLOWED_TOOLS,
  validateAgentRecord,
  validateRegistry,
  validateRegistryFile,
} from '../lib/specialists/schema.mjs';

const ROOT_DIR = path.resolve(import.meta.dirname, '..');

function valid(overrides = {}) {
  return {
    name: 'cx-test',
    description: 'A test agent used in the registry validation suite — long enough.',
    promptFile: 'specialists/prompts/cx-engineer.md',
    claudeTools: 'Read,Write,Edit',
    modelTier: 'standard',
    ...overrides,
  };
}

describe('validateAgentRecord', () => {
  it('accepts a well-formed record', () => {
    assert.deepEqual(validateAgentRecord(valid(), { rootDir: ROOT_DIR }), []);
  });

  it('requires name, description, promptFile', () => {
    const errors = validateAgentRecord({ claudeTools: 'Read' });
    assert.ok(errors.some((e) => e.includes('"name"')));
    assert.ok(errors.some((e) => e.includes('"description"')));
    assert.ok(errors.some((e) => e.includes('"promptFile"')));
  });

  it('rejects a too-short description', () => {
    const errors = validateAgentRecord(valid({ description: 'short' }), { rootDir: ROOT_DIR });
    assert.ok(errors.some((e) => e.includes('too short')));
  });

  it('rejects an unknown tool — the failure mode platforms silently swallow', () => {
    const errors = validateAgentRecord(valid({ claudeTools: 'Read,FakeTool,Edit' }), { rootDir: ROOT_DIR });
    assert.ok(errors.some((e) => e.includes('FakeTool')));
  });

  it('rejects a missing promptFile when rootDir is provided', () => {
    const errors = validateAgentRecord(valid({ promptFile: 'specialists/prompts/does-not-exist.md' }), { rootDir: ROOT_DIR });
    assert.ok(errors.some((e) => e.includes('does not exist')));
  });

  it('rejects an unknown modelTier', () => {
    const errors = validateAgentRecord(valid({ modelTier: 'turbo' }), { rootDir: ROOT_DIR });
    assert.ok(errors.some((e) => e.includes('modelTier')));
  });

  it('accepts null tools (no claudeTools is fine)', () => {
    const errors = validateAgentRecord(valid({ claudeTools: null }), { rootDir: ROOT_DIR });
    assert.deepEqual(errors, []);
  });

  it('accepts an optional when_to_use field of reasonable length', () => {
    const errors = validateAgentRecord(
      valid({ when_to_use: 'Use when the user needs cross-functional perspective routing across multiple specialist domains.' }),
      { rootDir: ROOT_DIR },
    );
    assert.deepEqual(errors, []);
  });

  it('rejects a too-short when_to_use', () => {
    const errors = validateAgentRecord(valid({ when_to_use: 'too short' }), { rootDir: ROOT_DIR });
    assert.ok(errors.some((e) => e.includes('when_to_use')));
  });
});

describe('validateRegistry', () => {
  it('flags duplicate agent names', () => {
    const result = validateRegistry({
      specialists: [valid({ name: 'cx-dup' }), valid({ name: 'cx-dup' })],
    }, { rootDir: ROOT_DIR });
    assert.ok(result.errors.some((e) => e.includes('duplicate agent name')));
  });

  it('reports a clean registry as 0 errors', () => {
    const result = validateRegistry({ specialists: [valid()] }, { rootDir: ROOT_DIR });
    assert.deepEqual(result.errors, []);
    assert.equal(result.agentCount, 1);
  });
});

describe('validateRegistryFile against the live registry', () => {
  it('the shipped registry is valid (no drift)', () => {
    const result = validateRegistryFile({
      registryPath: path.join(ROOT_DIR, 'specialists', 'unified-registry.json'),
      rootDir: ROOT_DIR,
    });
    assert.equal(result.errors.length, 0, `shipped registry has drift: ${result.errors.join('; ')}`);
    assert.ok(result.agentCount >= 25, 'sanity: registry should have the full persona set');
  });

  it('returns a clear error when the registry file is missing', () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'cx-schema-'));
    const result = validateRegistryFile({ registryPath: path.join(tmp, 'missing.json'), rootDir: ROOT_DIR });
    assert.ok(result.errors[0].includes('registry not found'));
    fs.rmSync(tmp, { recursive: true, force: true });
  });
});

describe('ALLOWED_TOOLS coverage', () => {
  it('includes the construct-mcp built-ins agents rely on', () => {
    for (const tool of ['get_skill', 'list_skills', 'orchestration_policy', 'cx_trace']) {
      assert.ok(ALLOWED_TOOLS.has(tool), `${tool} should be in the allowlist`);
    }
  });
});
