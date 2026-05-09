/**
 * tests/prompt-examples.test.mjs — validates shipped public persona and internal role example fixtures.
 *
 * Ensures the examples corpus stays structured enough for regression use.
 * Also checks that every fixture points at real prompt surfaces so examples do not
 * drift into an undocumented side channel.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const examplesRoot = path.join(root, 'examples');

function walk(dir) {
  const results = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      // seed-observations/ contains plain markdown input data, not structured fixtures
      if (entry.name === 'seed-observations') continue;
      results.push(...walk(fullPath));
      continue;
    }
    if (entry.isFile() && fullPath.endsWith('.md')) results.push(fullPath);
  }
  return results;
}

function parseFrontmatter(text) {
  const match = text.match(/^---\n([\s\S]*?)\n---\n/);
  if (!match) return { data: {}, body: text };
  const data = {};
  let currentKey = null;

  for (const rawLine of match[1].split('\n')) {
    if (!rawLine.trim()) continue;
    const keyMatch = rawLine.match(/^([A-Za-z0-9_-]+):\s*(.*)$/);
    if (keyMatch) {
      const [, key, value] = keyMatch;
      currentKey = key;
      if (!value) {
        data[key] = [];
      } else {
        data[key] = value;
      }
      continue;
    }
    const listMatch = rawLine.match(/^\s*-\s+(.*)$/);
    if (listMatch && currentKey) {
      if (!Array.isArray(data[currentKey])) data[currentKey] = [];
      data[currentKey].push(listMatch[1]);
    }
  }

  return { data, body: text.slice(match[0].length) };
}

function relative(filePath) {
  return path.relative(root, filePath).replaceAll(path.sep, '/');
}

test('prompt examples corpus exists and contains shipped fixtures', () => {
  assert.ok(fs.existsSync(examplesRoot), 'examples directory should exist');
  const files = walk(examplesRoot).filter((file) => !file.endsWith('README.md'));
  assert.ok(files.length >= 8, `expected at least 8 example fixtures, found ${files.length}`);
});

test('every example fixture has required frontmatter and body sections', () => {
  const files = walk(examplesRoot).filter((file) => !file.endsWith('README.md'));
  const allowedSurfaces = new Set(['persona', 'internal-role']);
  const allowedCategories = new Set(['golden', 'bad', 'boundary', 'adversarial']);
  const allowedVerdicts = new Set(['pass', 'fail']);

  for (const file of files) {
    const rel = relative(file);
    const text = fs.readFileSync(file, 'utf8');
    const { data, body } = parseFrontmatter(text);

    assert.ok(data.id, `${rel}: missing id`);
    assert.ok(allowedSurfaces.has(data.surface), `${rel}: invalid surface ${data.surface}`);
    assert.ok(data.name, `${rel}: missing name`);
    assert.ok(allowedCategories.has(data.category), `${rel}: invalid category ${data.category}`);
    assert.ok(allowedVerdicts.has(data.verdict), `${rel}: invalid verdict ${data.verdict}`);
    assert.ok(data.summary, `${rel}: missing summary`);
    assert.match(body, /^## User\n/m, `${rel}: missing ## User section`);
    assert.match(body, /^## Expected\n/m, `${rel}: missing ## Expected section`);

    if (data.category === 'bad' || data.verdict === 'fail') {
      assert.match(body, /^## Why This Fails\n/m, `${rel}: bad/fail fixture missing ## Why This Fails`);
    }
  }
});

test('example categories align with fixture path and target real repo surfaces', () => {
  const files = walk(examplesRoot).filter((file) => !file.endsWith('README.md'));

  for (const file of files) {
    const rel = relative(file);
    const text = fs.readFileSync(file, 'utf8');
    const { data } = parseFrontmatter(text);
    const parts = rel.split('/');

    if (data.surface === 'persona') {
      assert.equal(parts[1], 'personas', `${rel}: persona fixtures must live under examples/personas`);
      assert.equal(parts[2], data.name, `${rel}: persona directory should match fixture name`);
      assert.equal(parts[3], data.category, `${rel}: persona category directory should match category`);
    }

    if (data.surface === 'internal-role') {
      assert.equal(parts[1], 'internal', `${rel}: internal fixtures must live under examples/internal`);
      assert.equal(parts[2], 'roles', `${rel}: internal role fixtures must live under examples/internal/roles`);
      assert.equal(parts[3], data.name, `${rel}: internal role directory should match fixture name`);
      assert.equal(parts[4], data.category, `${rel}: internal role category directory should match category`);
    }

    const references = Array.isArray(data.references) ? data.references : [];
    assert.ok(references.length > 0, `${rel}: references should list at least one target file`);
    for (const reference of references) {
      assert.ok(fs.existsSync(path.join(root, reference)), `${rel}: missing referenced file ${reference}`);
    }
  }
});

test('examples README states the public-vs-internal fixture split and lean-prompt rule', () => {
  const readme = fs.readFileSync(path.join(examplesRoot, 'README.md'), 'utf8');
  assert.match(readme, /public persona and internal role layers/);
  assert.match(readme, /keep the public persona and internal specialist prompts lean and rule-based/);
  assert.match(readme, /keep most examples here as regression fixtures, not embedded into prompt bodies/);
});

test('Construct remains the sole public persona surface in docs and fixtures', () => {
  const promptSurfaces = fs.readFileSync(path.join(root, 'docs', 'prompt-surfaces.md'), 'utf8');
  assert.match(promptSurfaces, /sole public persona/);
  assert.match(promptSurfaces, /personas\/construct\.md/);

  const personaDirs = fs.readdirSync(path.join(examplesRoot, 'personas')).filter((entry) => fs.statSync(path.join(examplesRoot, 'personas', entry)).isDirectory());
  assert.deepEqual(personaDirs, ['construct']);
});

test('required fixture coverage exists for public and high-leverage internal surfaces', () => {
  const files = walk(examplesRoot).filter((file) => !file.endsWith('README.md'));
  const index = new Map();

  for (const file of files) {
    const { data } = parseFrontmatter(fs.readFileSync(file, 'utf8'));
    const key = `${data.surface}:${data.name}`;
    const categories = index.get(key) || new Set();
    categories.add(data.category);
    index.set(key, categories);
  }

  assert.deepEqual(index.get('persona:construct'), new Set(['golden', 'bad', 'boundary', 'adversarial']));

  for (const role of ['architect', 'engineer', 'reviewer', 'qa', 'orchestrator']) {
    assert.deepEqual(index.get(`internal-role:${role}`), new Set(['golden', 'bad']), `${role}: required internal coverage missing`);
  }
});
