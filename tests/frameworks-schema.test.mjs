/**
 * tests/frameworks-schema.test.mjs — ADR-0062 persona reasoning framework
 * schema, loader, and E1 pack-precedence tests (LMCP-F7).
 *
 * Pins: validateFrameworkFrontmatter() enforces required frontmatter, 3-6
 * step shape, unique emits tokens, cites enum, and known appliesToRole;
 * parseFrameworkFile() reads real files the same way; all 5 shipped core
 * frameworks (product-manager, operations, engineer, qa, architect) validate;
 * the core pack's loadCorePack() declares all 5 by frontmatter id; and
 * resolveFramework() honors tier precedence — a project-tier pack overrides
 * the core pack for the same framework id (ADR-0055/ADR-0062 §1).
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { validateFrameworkFrontmatter, parseFrameworkFile, knownRolesFromSpecialists } from '../lib/frameworks/schema.mjs';
import { resolveFramework, validatePackFrameworks, listPackFrameworks } from '../lib/frameworks/loader.mjs';
import { loadCorePack } from '../lib/packs/core-pack.mjs';
import { loadAllPacks } from '../lib/packs/loader.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PACKAGE_ROOT = path.resolve(__dirname, '..');

const CORE_FRAMEWORK_IDS = [
  'cx-pm-value-tradeoff',
  'cx-ops-dependency-sequencing',
  'engineer-feasibility-blast-radius',
  'qa-risk-based-coverage',
  'architect-constraint-option-failure',
];

const KNOWN_ROLES = new Set([
  'product-manager', 'operations', 'engineer', 'qa', 'architect',
]);

function validFrontmatter(overrides = {}) {
  return {
    id: 'cx-test-framework',
    version: 1,
    appliesToRole: 'product-manager',
    summary: 'A test framework.',
    steps: [
      { id: 'a', move: 'Move A', question: 'Q A?', emits: 'out-a', cites: 'source' },
      { id: 'b', move: 'Move B', question: 'Q B?', emits: 'out-b', cites: 'prior-step' },
      { id: 'c', move: 'Move C', question: 'Q C?', emits: 'out-c', cites: 'source' },
    ],
    ...overrides,
  };
}

const dirs = [];
function tmpRoot(prefix) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  dirs.push(dir);
  return dir;
}
test.after(() => { for (const d of dirs) { try { fs.rmSync(d, { recursive: true, force: true }); } catch {} } });

function writeFrameworkFile(root, relPath, frontmatterYaml, body = 'Body text.\n') {
  const abs = path.join(root, relPath);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, `---\n${frontmatterYaml}\n---\n\n${body}`);
}

test('validateFrameworkFrontmatter', async (t) => {
  await t.test('accepts a well-formed frontmatter object', () => {
    const result = validateFrameworkFrontmatter(validFrontmatter());
    assert.equal(result.valid, true);
    assert.deepEqual(result.errors, []);
  });

  await t.test('rejects missing id', () => {
    const fm = validFrontmatter();
    delete fm.id;
    const result = validateFrameworkFrontmatter(fm);
    assert.equal(result.valid, false);
    assert.ok(result.errors.some((e) => e.includes('id')));
  });

  await t.test('rejects missing version', () => {
    const fm = validFrontmatter();
    delete fm.version;
    const result = validateFrameworkFrontmatter(fm);
    assert.equal(result.valid, false);
    assert.ok(result.errors.some((e) => e.includes('version')));
  });

  await t.test('rejects missing appliesToRole', () => {
    const fm = validFrontmatter();
    delete fm.appliesToRole;
    const result = validateFrameworkFrontmatter(fm);
    assert.equal(result.valid, false);
    assert.ok(result.errors.some((e) => e.includes('appliesToRole')));
  });

  await t.test('rejects missing summary', () => {
    const fm = validFrontmatter();
    delete fm.summary;
    const result = validateFrameworkFrontmatter(fm);
    assert.equal(result.valid, false);
    assert.ok(result.errors.some((e) => e.includes('summary')));
  });

  await t.test('rejects empty steps array', () => {
    const fm = validFrontmatter({ steps: [] });
    const result = validateFrameworkFrontmatter(fm);
    assert.equal(result.valid, false);
    assert.ok(result.errors.some((e) => e.includes('steps must be a non-empty array')));
  });

  await t.test('rejects fewer than 3 steps', () => {
    const fm = validFrontmatter({
      steps: [
        { id: 'a', move: 'A', question: 'Qa?', emits: 'out-a', cites: 'source' },
        { id: 'b', move: 'B', question: 'Qb?', emits: 'out-b', cites: 'source' },
      ],
    });
    const result = validateFrameworkFrontmatter(fm);
    assert.equal(result.valid, false);
    assert.ok(result.errors.some((e) => e.includes('3-6 entries')));
  });

  await t.test('rejects more than 6 steps', () => {
    const steps = Array.from({ length: 7 }, (_, i) => ({
      id: `s${i}`, move: `Move ${i}`, question: `Q${i}?`, emits: `out-${i}`, cites: 'source',
    }));
    const result = validateFrameworkFrontmatter(validFrontmatter({ steps }));
    assert.equal(result.valid, false);
    assert.ok(result.errors.some((e) => e.includes('3-6 entries')));
  });

  await t.test('rejects a step missing a required field', () => {
    const fm = validFrontmatter({
      steps: [
        { id: 'a', move: 'A', question: 'Qa?', emits: 'out-a', cites: 'source' },
        { id: 'b', move: 'B', emits: 'out-b', cites: 'source' },
        { id: 'c', move: 'C', question: 'Qc?', emits: 'out-c', cites: 'source' },
      ],
    });
    const result = validateFrameworkFrontmatter(fm);
    assert.equal(result.valid, false);
    assert.ok(result.errors.some((e) => e.includes('steps[1]') && e.includes('question')));
  });

  await t.test('rejects duplicate emits tokens', () => {
    const fm = validFrontmatter({
      steps: [
        { id: 'a', move: 'A', question: 'Qa?', emits: 'dup', cites: 'source' },
        { id: 'b', move: 'B', question: 'Qb?', emits: 'dup', cites: 'source' },
        { id: 'c', move: 'C', question: 'Qc?', emits: 'out-c', cites: 'source' },
      ],
    });
    const result = validateFrameworkFrontmatter(fm);
    assert.equal(result.valid, false);
    assert.ok(result.errors.some((e) => e.includes("emits token 'dup' is not unique")));
  });

  await t.test('rejects a cites value outside {source, prior-step}', () => {
    const fm = validFrontmatter({
      steps: [
        { id: 'a', move: 'A', question: 'Qa?', emits: 'out-a', cites: 'vibes' },
        { id: 'b', move: 'B', question: 'Qb?', emits: 'out-b', cites: 'source' },
        { id: 'c', move: 'C', question: 'Qc?', emits: 'out-c', cites: 'source' },
      ],
    });
    const result = validateFrameworkFrontmatter(fm);
    assert.equal(result.valid, false);
    assert.ok(result.errors.some((e) => e.includes('cites must be one of')));
  });

  await t.test('rejects an unknown appliesToRole when knownRoles is supplied', () => {
    const fm = validFrontmatter({ appliesToRole: 'time-traveler' });
    const result = validateFrameworkFrontmatter(fm, { knownRoles: KNOWN_ROLES });
    assert.equal(result.valid, false);
    assert.ok(result.errors.some((e) => e.includes('not a known role')));
  });

  await t.test('accepts a known appliesToRole when knownRoles is supplied', () => {
    const fm = validFrontmatter({ appliesToRole: 'engineer' });
    const result = validateFrameworkFrontmatter(fm, { knownRoles: KNOWN_ROLES });
    assert.equal(result.valid, true);
  });

  await t.test('skips the appliesToRole check when knownRoles is omitted', () => {
    const fm = validFrontmatter({ appliesToRole: 'anything' });
    const result = validateFrameworkFrontmatter(fm);
    assert.equal(result.valid, true);
  });
});

test('parseFrameworkFile', async (t) => {
  await t.test('parses and validates a well-formed file on disk', () => {
    const root = tmpRoot('cx-fw-valid-');
    writeFrameworkFile(root, 'frameworks/cx-test.md', [
      'id: cx-test',
      'version: 1',
      'appliesToRole: engineer',
      'summary: Test summary.',
      'steps:',
      '  - id: a',
      '    move: Move A',
      '    question: Q A?',
      '    emits: out-a',
      '    cites: source',
      '  - id: b',
      '    move: Move B',
      '    question: Q B?',
      '    emits: out-b',
      '    cites: prior-step',
      '  - id: c',
      '    move: Move C',
      '    question: Q C?',
      '    emits: out-c',
      '    cites: source',
    ].join('\n'));
    const result = parseFrameworkFile(path.join(root, 'frameworks/cx-test.md'));
    assert.equal(result.valid, true, JSON.stringify(result.errors));
    assert.equal(result.frontmatter.id, 'cx-test');
    assert.match(result.body, /Body text/);
  });

  await t.test('names the file when frontmatter is missing', () => {
    const root = tmpRoot('cx-fw-nofm-');
    const abs = path.join(root, 'frameworks', 'cx-test.md');
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, 'Just prose.\n');
    const result = parseFrameworkFile(abs);
    assert.equal(result.valid, false);
    assert.ok(result.errors.some((e) => e.includes(abs) && e.includes('frontmatter')));
  });

  await t.test('reports a read failure for a missing file', () => {
    const result = parseFrameworkFile('/nonexistent/path/cx-test.md');
    assert.equal(result.valid, false);
    assert.ok(result.errors.some((e) => e.includes('failed to read file')));
  });
});

test('knownRolesFromSpecialists', async (t) => {
  await t.test('collects unique role fields', () => {
    const roles = knownRolesFromSpecialists([
      { role: 'engineer' }, { role: 'qa' }, { role: 'engineer' }, {},
    ]);
    assert.deepEqual([...roles].sort(), ['engineer', 'qa']);
  });
});

test('core pack frameworks (LMCP-F7)', async (t) => {
  await t.test('loadCorePack declares all 5 shipped frameworks by frontmatter id', () => {
    const pack = loadCorePack(PACKAGE_ROOT);
    for (const id of CORE_FRAMEWORK_IDS) {
      assert.ok(id in pack.frameworks, `expected core pack to declare framework '${id}'`);
    }
  });

  await t.test('every declared core framework file validates against the ADR-0062 schema', () => {
    const pack = loadCorePack(PACKAGE_ROOT);
    const specialistDir = path.join(PACKAGE_ROOT, 'specialists', 'org', 'specialists');
    const specialists = fs.readdirSync(specialistDir)
      .filter((f) => f.endsWith('.json'))
      .map((f) => JSON.parse(fs.readFileSync(path.join(specialistDir, f), 'utf8')));
    const knownRoles = knownRolesFromSpecialists(specialists);

    const result = validatePackFrameworks(pack, { packageRoot: PACKAGE_ROOT, knownRoles });
    assert.deepEqual(result.errors, []);
    assert.equal(result.valid, true);
  });

  await t.test('each of the 5 role frameworks parses individually with 3-6 unique-emits steps', () => {
    const pack = loadCorePack(PACKAGE_ROOT);
    for (const id of CORE_FRAMEWORK_IDS) {
      const relPath = pack.frameworks[id];
      const result = parseFrameworkFile(path.join(PACKAGE_ROOT, relPath));
      assert.equal(result.valid, true, `${id}: ${JSON.stringify(result.errors)}`);
      assert.ok(result.frontmatter.steps.length >= 3 && result.frontmatter.steps.length <= 6);
      const emits = result.frontmatter.steps.map((s) => s.emits);
      assert.equal(new Set(emits).size, emits.length, `${id}: emits tokens must be unique`);
    }
  });

  await t.test('resolveFramework finds each core framework through loadAllPacks', () => {
    const { packs } = loadAllPacks({ deploymentMode: 'solo', rootDir: tmpRoot('cx-fw-resolve-') });
    for (const id of CORE_FRAMEWORK_IDS) {
      const result = resolveFramework(id, { packs, packageRoot: PACKAGE_ROOT });
      assert.equal(result.found, true, `expected to resolve framework '${id}'`);
      assert.equal(result.packId, '@construct/core');
    }
  });
});

test('resolveFramework E1 pack precedence (ADR-0055/ADR-0062 §1)', async (t) => {
  await t.test('a project-tier pack framework overrides the core pack for the same id', () => {
    const projectDir = tmpRoot('cx-fw-override-');
    const packsDir = path.join(projectDir, '.construct', 'packs');
    const manifestDir = path.join(packsDir, 'override-pack');
    fs.mkdirSync(manifestDir, { recursive: true });
    fs.writeFileSync(path.join(manifestDir, 'pack.manifest.json'), JSON.stringify({
      id: '@project/override', version: '1.0.0', compatVersion: 1,
      frameworks: { 'cx-pm-value-tradeoff': 'frameworks/cx-pm-value-tradeoff.md' },
    }, null, 2));
    writeFrameworkFile(manifestDir, 'frameworks/cx-pm-value-tradeoff.md', [
      'id: cx-pm-value-tradeoff',
      'version: 2',
      'appliesToRole: product-manager',
      'summary: Project override summary.',
      'steps:',
      '  - id: a',
      '    move: Move A',
      '    question: Q A?',
      '    emits: out-a',
      '    cites: source',
      '  - id: b',
      '    move: Move B',
      '    question: Q B?',
      '    emits: out-b',
      '    cites: prior-step',
      '  - id: c',
      '    move: Move C',
      '    question: Q C?',
      '    emits: out-c',
      '    cites: source',
    ].join('\n'), 'Project override body.\n');

    const { packs } = loadAllPacks({ deploymentMode: 'solo', rootDir: projectDir });
    // Project tier must sort before builtin for resolveFramework's first-match walk
    // to reflect override precedence — mirror the ordering loadAllPacks callers use.
    const tierOrder = { project: 0, user: 1, builtin: 2, unknown: 3 };
    const ordered = [...packs].sort((a, b) => (tierOrder[a._tier] ?? 3) - (tierOrder[b._tier] ?? 3));

    const result = resolveFramework('cx-pm-value-tradeoff', { packs: ordered, packageRoot: PACKAGE_ROOT });
    assert.equal(result.found, true);
    assert.equal(result.packId, '@project/override', 'project-tier pack must win over the core pack for the same framework id');
    assert.equal(result.frontmatter.version, 2);
    assert.match(result.body, /Project override body/);
  });

  await t.test('listPackFrameworks lists ids without loading file contents', () => {
    const pack = loadCorePack(PACKAGE_ROOT);
    const ids = listPackFrameworks(pack);
    for (const id of CORE_FRAMEWORK_IDS) assert.ok(ids.includes(id));
  });

  await t.test('validatePackFrameworks names the missing file when a declared framework does not exist', () => {
    const root = tmpRoot('cx-fw-missing-');
    const pack = { id: '@test/pack', frameworks: { 'cx-missing': 'frameworks/cx-missing.md' } };
    const result = validatePackFrameworks(pack, { packageRoot: root });
    assert.equal(result.valid, false);
    assert.ok(result.errors.some((e) => e.includes('frameworks/cx-missing.md') && e.includes('cx-missing')));
  });

  await t.test('validatePackFrameworks rejects a framework file whose frontmatter id does not match its map key', () => {
    const root = tmpRoot('cx-fw-idmismatch-');
    writeFrameworkFile(root, 'frameworks/cx-a.md', [
      'id: cx-b',
      'version: 1',
      'appliesToRole: engineer',
      'summary: Mismatched id.',
      'steps:',
      '  - id: a',
      '    move: Move A',
      '    question: Q A?',
      '    emits: out-a',
      '    cites: source',
      '  - id: b',
      '    move: Move B',
      '    question: Q B?',
      '    emits: out-b',
      '    cites: source',
      '  - id: c',
      '    move: Move C',
      '    question: Q C?',
      '    emits: out-c',
      '    cites: source',
    ].join('\n'));
    const pack = { id: '@test/pack', frameworks: { 'cx-a': 'frameworks/cx-a.md' } };
    const result = validatePackFrameworks(pack, { packageRoot: root });
    assert.equal(result.valid, false);
    assert.ok(result.errors.some((e) => e.includes('mismatched frontmatter id')));
  });

  await t.test('resolveFramework returns found:false when no pack declares the id', () => {
    const result = resolveFramework('cx-nonexistent', { packs: [{ id: '@test/pack', frameworks: {} }], packageRoot: '/tmp' });
    assert.equal(result.found, false);
  });
});
