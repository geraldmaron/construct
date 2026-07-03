/**
 * tests/packs/prompt-validation.test.mjs — pack prompt-file validation (LMCP-E2).
 *
 * Pins: validatePackPrompts() names the missing file and rejects a manifest
 * with an unparseable or role-less frontmatter; resolvePersonaPrompt() reads
 * ONLY through the supplied pack list and returns {found:false} for an
 * undeclared role; loadPacksFromDir()/loadAllPacks() hard-fail a team/enterprise
 * pack whose declared prompt is missing (naming the file) while a solo-mode
 * load with the same broken pack succeeds — validation is deferred to the
 * worker's degraded-fallback path, not silently skipped.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { validatePackPrompts, resolvePersonaPrompt } from '../../lib/packs/prompts.mjs';
import { loadPacksFromDir, loadAllPacks } from '../../lib/packs/loader.mjs';

const dirs = [];
function tmpRoot(prefix) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  dirs.push(dir);
  return dir;
}
test.after(() => { for (const d of dirs) { try { fs.rmSync(d, { recursive: true, force: true }); } catch {} } });

function writePromptFile(root, relPath, frontmatter) {
  const abs = path.join(root, relPath);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, `---\n${frontmatter}\n---\n\nBody text.\n`);
}

function writeManifest(packDir, manifest) {
  fs.mkdirSync(packDir, { recursive: true });
  fs.writeFileSync(path.join(packDir, 'pack.manifest.json'), JSON.stringify(manifest, null, 2));
}

test('validatePackPrompts', async (t) => {
  await t.test('valid pack with an existing, well-formed prompt passes', () => {
    const root = tmpRoot('cx-prompt-valid-');
    writePromptFile(root, 'prompts/cx-widget.md', 'name: cx-widget\nrole: widget');
    const pack = { id: '@test/pack', prompts: { 'cx-widget': 'prompts/cx-widget.md' } };
    const result = validatePackPrompts(pack, { packageRoot: root });
    assert.equal(result.valid, true);
    assert.deepEqual(result.errors, []);
  });

  await t.test('names the missing file when a declared prompt does not exist', () => {
    const root = tmpRoot('cx-prompt-missing-');
    const pack = { id: '@test/pack', prompts: { 'cx-widget': 'prompts/cx-widget.md' } };
    const result = validatePackPrompts(pack, { packageRoot: root });
    assert.equal(result.valid, false);
    assert.ok(
      result.errors.some((e) => e.includes('prompts/cx-widget.md') && e.includes('cx-widget')),
      `error should name the missing file, got: ${JSON.stringify(result.errors)}`,
    );
  });

  await t.test('rejects a prompt file with no frontmatter', () => {
    const root = tmpRoot('cx-prompt-nofm-');
    fs.mkdirSync(path.join(root, 'prompts'), { recursive: true });
    fs.writeFileSync(path.join(root, 'prompts', 'cx-widget.md'), 'Just prose, no frontmatter.\n');
    const pack = { id: '@test/pack', prompts: { 'cx-widget': 'prompts/cx-widget.md' } };
    const result = validatePackPrompts(pack, { packageRoot: root });
    assert.equal(result.valid, false);
    assert.ok(result.errors.some((e) => e.includes('frontmatter')));
  });

  await t.test('rejects frontmatter missing the role field', () => {
    const root = tmpRoot('cx-prompt-norole-');
    writePromptFile(root, 'prompts/cx-widget.md', 'name: cx-widget');
    const pack = { id: '@test/pack', prompts: { 'cx-widget': 'prompts/cx-widget.md' } };
    const result = validatePackPrompts(pack, { packageRoot: root });
    assert.equal(result.valid, false);
    assert.ok(result.errors.some((e) => e.includes("missing 'role'")));
  });

  await t.test('empty prompts map is valid', () => {
    const result = validatePackPrompts({ id: '@test/pack', prompts: {} }, { packageRoot: '/tmp' });
    assert.equal(result.valid, true);
  });
});

test('resolvePersonaPrompt', async (t) => {
  await t.test('finds the prompt declared by a pack in the list', () => {
    const root = tmpRoot('cx-resolve-found-');
    writePromptFile(root, 'prompts/cx-widget.md', 'name: cx-widget\nrole: widget');
    const packs = [{ id: '@test/pack', prompts: { 'cx-widget': 'prompts/cx-widget.md' } }];
    const result = resolvePersonaPrompt('cx-widget', { packs, packageRoot: root });
    assert.equal(result.found, true);
    assert.match(result.content, /role: widget/);
    assert.equal(result.packId, '@test/pack');
  });

  await t.test('accepts a bare role (no cx- prefix)', () => {
    const root = tmpRoot('cx-resolve-bare-');
    writePromptFile(root, 'prompts/cx-widget.md', 'name: cx-widget\nrole: widget');
    const packs = [{ id: '@test/pack', prompts: { 'cx-widget': 'prompts/cx-widget.md' } }];
    const result = resolvePersonaPrompt('widget', { packs, packageRoot: root });
    assert.equal(result.found, true);
  });

  await t.test('returns found:false when no pack declares the role', () => {
    const result = resolvePersonaPrompt('cx-nonexistent', { packs: [{ id: '@test/pack', prompts: {} }], packageRoot: '/tmp' });
    assert.equal(result.found, false);
  });

  await t.test('returns found:false when the declared file does not exist on disk', () => {
    const root = tmpRoot('cx-resolve-dangling-');
    const packs = [{ id: '@test/pack', prompts: { 'cx-widget': 'prompts/cx-widget.md' } }];
    const result = resolvePersonaPrompt('cx-widget', { packs, packageRoot: root });
    assert.equal(result.found, false);
  });
});

test('loadPacksFromDir team/enterprise hard-fail', async (t) => {
  await t.test('team mode rejects a pack with a missing declared prompt, naming the file', () => {
    const root = tmpRoot('cx-load-team-');
    const packsDir = path.join(root, 'packs');
    writeManifest(path.join(packsDir, 'broken-pack'), {
      id: '@test/broken', version: '1.0.0', compatVersion: 1,
      prompts: { 'cx-widget': 'prompts/cx-widget.md' },
    });
    const result = loadPacksFromDir(packsDir, { tier: 'project', deploymentMode: 'team', packageRoot: root });
    assert.equal(result.packs.length, 0, 'the broken pack must not load');
    assert.ok(
      result.errors.some((e) => e.includes('prompts/cx-widget.md')),
      `error should name the missing prompt file, got: ${JSON.stringify(result.errors)}`,
    );
  });

  await t.test('enterprise mode rejects the same broken pack', () => {
    const root = tmpRoot('cx-load-enterprise-');
    const packsDir = path.join(root, 'packs');
    writeManifest(path.join(packsDir, 'broken-pack'), {
      id: '@test/broken', version: '1.0.0', compatVersion: 1,
      prompts: { 'cx-widget': 'prompts/cx-widget.md' },
    });
    const result = loadPacksFromDir(packsDir, { tier: 'project', deploymentMode: 'enterprise', packageRoot: root });
    assert.equal(result.packs.length, 0);
    assert.ok(result.errors.some((e) => e.includes('prompts/cx-widget.md')));
  });

  await t.test('solo mode loads the same broken pack without a load-time error', () => {
    const root = tmpRoot('cx-load-solo-');
    const packsDir = path.join(root, 'packs');
    writeManifest(path.join(packsDir, 'broken-pack'), {
      id: '@test/broken', version: '1.0.0', compatVersion: 1,
      prompts: { 'cx-widget': 'prompts/cx-widget.md' },
    });
    const result = loadPacksFromDir(packsDir, { tier: 'project', deploymentMode: 'solo', packageRoot: root });
    assert.equal(result.packs.length, 1, 'solo mode defers prompt-miss handling to the worker, not pack load');
    assert.deepEqual(result.errors, []);
  });

  await t.test('team mode accepts a pack whose declared prompt exists and is well-formed', () => {
    const root = tmpRoot('cx-load-team-ok-');
    const packsDir = path.join(root, 'packs');
    writeManifest(path.join(packsDir, 'good-pack'), {
      id: '@test/good', version: '1.0.0', compatVersion: 1,
      prompts: { 'cx-widget': 'prompts/cx-widget.md' },
    });
    // Prompt paths are relative to the pack's OWN directory (_packDir), not
    // the packsDir root — a project pack ships its prompt alongside its manifest.
    writePromptFile(path.join(packsDir, 'good-pack'), 'prompts/cx-widget.md', 'name: cx-widget\nrole: widget');
    const result = loadPacksFromDir(packsDir, { tier: 'project', deploymentMode: 'team', packageRoot: root });
    assert.equal(result.packs.length, 1);
    assert.deepEqual(result.errors, []);
  });
});

test('loadAllPacks core pack prompt validation', async (t) => {
  await t.test('solo mode includes the core pack regardless of prompt state', () => {
    const result = loadAllPacks({ deploymentMode: 'solo', rootDir: tmpRoot('cx-all-solo-') });
    const core = result.packs.find((p) => p.id === '@construct/core');
    assert.ok(core, 'core pack should load in solo mode');
  });

  await t.test('team mode with the real repo core pack (well-formed) still includes it', () => {
    const result = loadAllPacks({ deploymentMode: 'team', rootDir: tmpRoot('cx-all-team-') });
    const core = result.packs.find((p) => p.id === '@construct/core');
    assert.ok(core, 'the repo-shipped core pack prompts are well-formed and should pass team-mode validation');
  });

  await t.test('rootDir (project cwd) is independent of the core pack source: an unrelated project rootDir still resolves the real core pack specialists/prompts', () => {
    // rootDir here is a scratch project directory with no specialists/org of its own —
    // the core pack must still resolve from packageRoot, not from rootDir, or a worker
    // running in any project other than the Construct repo itself would see an empty
    // core pack (zero specialists, zero prompts) and every role would degrade.
    const projectDir = tmpRoot('cx-all-project-unrelated-');
    const result = loadAllPacks({ deploymentMode: 'solo', rootDir: projectDir });
    const core = result.packs.find((p) => p.id === '@construct/core');
    assert.ok(core.specialists.length > 0, 'core pack specialists must resolve from packageRoot, not the caller rootDir');
    assert.ok(Object.keys(core.prompts).length > 0, 'core pack prompts must resolve from packageRoot, not the caller rootDir');
  });
});

test('loadAllPacks project-tier pack precedence (ADR-0055)', async (t) => {
  await t.test('a project pack prompt for an existing specialist id takes precedence in the merged list ordering by tier', () => {
    const projectDir = tmpRoot('cx-project-override-');
    const packsDir = path.join(projectDir, '.cx', 'packs');
    writeManifest(path.join(packsDir, 'override-pack'), {
      id: '@project/override', version: '1.0.0', compatVersion: 1,
      prompts: { 'cx-engineer': 'prompts/cx-engineer.md' },
    });
    writePromptFile(projectDir, '.cx/packs/override-pack/prompts/cx-engineer.md', 'name: cx-engineer\nrole: engineer');

    const result = loadAllPacks({ deploymentMode: 'solo', rootDir: projectDir });
    const projectPack = result.packs.find((p) => p.id === '@project/override');
    assert.ok(projectPack, 'the project-tier pack should load');
    assert.equal(projectPack._tier, 'project');
  });
});
