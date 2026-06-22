/**
 * tests/specialist-prompt-format.test.mjs — hybrid specialist prompt format (ADR-0037).
 *
 * Pins three guarantees: the frontmatter schema + perspective drift gate
 * (lib/specialists/prompt-schema.mjs); emit-neutrality — adding frontmatter does
 * not change the body the sync pipeline reads, checked against committed golden
 * fixtures via the real strip path; and the scaffold/edit CLI surface
 * (lib/specialists/scaffold.mjs) producing files that pass the linter.
 */
import test from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { validatePromptContent, validatePromptFiles, splitFrontmatter } from '../lib/specialists/prompt-schema.mjs';
import { renderSkeleton, createSpecialistDraft, editSpecialistFrontmatter } from '../lib/specialists/scaffold.mjs';
import { readPromptBody } from '../lib/prompt-composer.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const ARCHITECT_PERSPECTIVE = {
  bias: 'Designs that emerged from code, missing ADRs, data models that encode assumptions that will change',
  tension: 'cx-engineer',
  openingQuestion: "What are the invariants, and what breaks if they're violated?",
  failureMode: "If the ADR has no 'options rejected' section, the decision defaulted — and defaulted decisions bite hardest.",
};

function frontmatter(extra = {}) {
  return ['---',
    'name: cx-architect',
    'role: architect',
    'version: 1',
    'perspective:',
    `  bias: ${JSON.stringify(ARCHITECT_PERSPECTIVE.bias)}`,
    `  tension: ${JSON.stringify(ARCHITECT_PERSPECTIVE.tension)}`,
    `  openingQuestion: ${JSON.stringify(ARCHITECT_PERSPECTIVE.openingQuestion)}`,
    `  failureMode: ${JSON.stringify(ARCHITECT_PERSPECTIVE.failureMode)}`,
    ...Object.entries(extra).map(([k, v]) => `${k}: ${v}`),
    '---', '', '## Anti-fabrication contract', 'x', '', '## Output format', 'y', ''].join('\n');
}

const registryEntry = { name: 'architect', perspective: ARCHITECT_PERSPECTIVE };

test('a valid converted file passes with no errors', () => {
  const r = validatePromptContent({ content: frontmatter(), id: 'cx-architect', registryEntry });
  assert.equal(r.converted, true);
  assert.deepEqual(r.errors, []);
});

test('an unconverted file is reported, never an error', () => {
  const r = validatePromptContent({ content: 'You are an engineer.\n', id: 'cx-engineer' });
  assert.equal(r.converted, false);
  assert.deepEqual(r.errors, []);
  assert.match(r.warnings.join(' '), /not yet converted/);
});

test('missing required frontmatter is an error', () => {
  const r = validatePromptContent({ content: '---\nname: cx-architect\n---\nbody\n', id: 'cx-architect' });
  assert.ok(r.errors.some((e) => /missing required frontmatter field "role"/.test(e)));
  assert.ok(r.errors.some((e) => /missing required frontmatter field "version"/.test(e)));
});

test('the perspective drift gate fires when frontmatter disagrees with the registry', () => {
  const drifted = { ...registryEntry, perspective: { ...ARCHITECT_PERSPECTIVE, tension: 'cx-someone-else' } };
  const r = validatePromptContent({ content: frontmatter(), id: 'cx-architect', registryEntry: drifted });
  assert.ok(r.errors.some((e) => /drifts from registry/.test(e)), 'drift is an error');
});

test('invalid YAML frontmatter is an error, not a crash', () => {
  const r = validatePromptContent({ content: '---\nname: "unterminated\n---\nbody\n', id: 'cx-x' });
  assert.equal(r.converted, true);
  assert.ok(r.errors.some((e) => /not valid YAML/.test(e)));
});

test('the live registry validates with zero errors (all specialist prompts converted)', () => {
  const r = validatePromptFiles({ rootDir: ROOT });
  assert.deepEqual(r.errors, [], r.errors.join('\n'));
  assert.equal(r.converted, r.total, `expected all ${r.total} prompts converted, got ${r.converted}`);
  assert.ok(r.total >= 29, `expected >= 29 prompts, got ${r.total}`);
});

test('emit-neutral: stripping frontmatter yields the golden body byte-for-byte', () => {
  const goldenDir = path.join(ROOT, 'tests/fixtures/specialist-prompt-emit');
  const names = fs.readdirSync(goldenDir).filter((f) => f.endsWith('.body.txt')).map((f) => f.replace(/\.body\.txt$/, ''));
  assert.ok(names.length >= 29, `expected >= 29 golden bodies, got ${names.length}`);
  for (const name of names) {
    const golden = fs.readFileSync(path.join(goldenDir, `${name}.body.txt`), 'utf8');
    const body = readPromptBody(`specialists/prompts/${name}.md`, ROOT);
    assert.equal(body, golden.trim(), `${name}: body changed by frontmatter addition`);
    assert.ok(!body.startsWith('---'), `${name}: frontmatter leaked into the body`);
    const { frontmatter: fm } = splitFrontmatter(fs.readFileSync(path.join(ROOT, `specialists/prompts/${name}.md`), 'utf8'));
    assert.ok(fm && fm.perspective && fm.perspective.tension, `${name}: frontmatter perspective missing`);
  }
});

test('scaffold renders a skeleton that passes its own validation', () => {
  const content = renderSkeleton({ role: 'performance-auditor' });
  const r = validatePromptContent({ content, id: 'cx-performance-auditor' });
  assert.deepEqual(r.errors, [], r.errors.join('\n'));
});

test('create writes a draft and refuses to overwrite; edit mutates frontmatter only', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'cx-scaffold-'));
  try {
    const { path: file } = createSpecialistDraft({ rootDir: tmp, role: 'perf-auditor' });
    assert.ok(fs.existsSync(file));
    assert.throws(() => createSpecialistDraft({ rootDir: tmp, role: 'perf-auditor' }), /refusing to overwrite/);

    const bodyBefore = splitFrontmatter(fs.readFileSync(file, 'utf8')).body;
    editSpecialistFrontmatter({ rootDir: tmp, role: 'perf-auditor', setPerspective: { bias: 'flaky perf numbers' }, bumpVersion: true });
    const after = splitFrontmatter(fs.readFileSync(file, 'utf8'));
    assert.equal(after.frontmatter.version, 2, 'version bumped');
    assert.equal(after.frontmatter.perspective.bias, 'flaky perf numbers', 'bias set');
    assert.equal(after.body, bodyBefore, 'prose body is untouched by a frontmatter edit');
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});
