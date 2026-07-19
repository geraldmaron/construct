/**
 * Canonical Worker Profile prompt surface checks.
 *
 * The registry owns prompt identity and prompt files; this suite prevents
 * missing or oversized prompts from re-entering the active package.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { loadRegistry } from '../lib/registry/loader.mjs';

const root = path.resolve(import.meta.dirname, '..');

test('canonical Worker Profile prompts are present and bounded', () => {
  const registry = loadRegistry({ rootDir: root });
  for (const profile of Object.values(registry.workerProfiles)) {
    const prompt = path.join(root, 'registry', 'worker-profiles', 'prompts', `${profile.id}.md`);
    assert.ok(fs.existsSync(prompt), `${profile.id} prompt must exist in the canonical registry`);
    assert.ok(fs.readFileSync(prompt, 'utf8').trim().split(/\s+/).length <= 1200, `${profile.id} prompt exceeds the 1200-word limit`);
  }
});

test('canonical orchestrator prompt delegates routing policy to code', () => {
  const text = fs.readFileSync(path.join(root, 'registry', 'worker-profiles', 'prompts', 'orchestrator.md'), 'utf8');
  assert.match(text, /code-backed orchestration policy|routing\/handoff rules/i);
});
