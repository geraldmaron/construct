/**
 * tests/worker-profile-prompt-format.test.mjs — Worker Profile prompt format.
 *
 * Pins three guarantees: the frontmatter schema + perspective validation
 * (lib/worker-profiles/prompt-schema.mjs).
 * not change the body the sync pipeline reads, checked against committed golden
 * fixtures via the real strip path.
 */
import test from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { validatePromptContent, validatePromptFiles } from '../lib/worker-profiles/prompt-schema.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const ARCHITECT_PERSPECTIVE = {
  bias: 'Designs that emerged from code, missing ADRs, data models that encode assumptions that will change',
  tension: 'engineer',
  openingQuestion: "What are the invariants, and what breaks if they're violated?",
  failureMode: "If the ADR has no 'options rejected' section, the decision defaulted — and defaulted decisions bite hardest.",
};

function frontmatter(extra = {}) {
  return ['---',
    'workerProfileId: architect',
    'version: 1',
    'perspective:',
    `  bias: ${JSON.stringify(ARCHITECT_PERSPECTIVE.bias)}`,
    `  tension: ${JSON.stringify(ARCHITECT_PERSPECTIVE.tension)}`,
    `  openingQuestion: ${JSON.stringify(ARCHITECT_PERSPECTIVE.openingQuestion)}`,
    `  failureMode: ${JSON.stringify(ARCHITECT_PERSPECTIVE.failureMode)}`,
    ...Object.entries(extra).map(([k, v]) => `${k}: ${v}`),
    '---', '', '## Anti-fabrication contract', 'x', '', '## Output format', 'y', ''].join('\n');
}

test('a valid converted file passes with no errors', () => {
  const r = validatePromptContent({ content: frontmatter(), id: 'architect', registryEntry: { id: 'architect' } });
  assert.equal(r.converted, true);
  assert.deepEqual(r.errors, []);
});

test('a prompt without frontmatter is reported', () => {
  const r = validatePromptContent({ content: 'You are an engineer.\n', id: 'engineer' });
  assert.equal(r.converted, false);
  assert.deepEqual(r.errors, []);
  assert.match(r.warnings.join(' '), /no Worker Profile frontmatter/);
});

test('missing required frontmatter is an error', () => {
  const r = validatePromptContent({ content: '---\nworkerProfileId: architect\n---\nbody\n', id: 'architect' });
  assert.ok(r.errors.some((e) => /missing required frontmatter field "version"/.test(e)));
});

test('incomplete perspective fields are errors', () => {
  const bad = frontmatter().replace(`  tension: ${JSON.stringify(ARCHITECT_PERSPECTIVE.tension)}`, '  tension: ""');
  const r = validatePromptContent({ content: bad, id: 'architect' });
  assert.ok(r.errors.some((e) => /perspective\.tension/.test(e)), 'empty tension is an error');
});

test('invalid YAML frontmatter is an error, not a crash', () => {
  const r = validatePromptContent({ content: '---\nworkerProfileId: "unterminated\n---\nbody\n', id: 'x' });
  assert.equal(r.converted, true);
  assert.ok(r.errors.some((e) => /not valid YAML/.test(e)));
});

test('the live registry validates with zero errors', () => {
  const r = validatePromptFiles({ rootDir: ROOT });
  assert.deepEqual(r.errors, [], r.errors.join('\n'));
  assert.equal(r.converted, r.total, `expected all ${r.total} prompts converted, got ${r.converted}`);
  assert.ok(r.total >= 12, `expected >= 12 prompts, got ${r.total}`);
});
