/**
 * tests/tool-invisibility.test.mjs — the tool-invisibility guardrail
 * (rules/common/tool-invisibility.md): deliverable artifacts are about the user's
 * project, never about Construct or its internal cx-* roles.
 *
 * Covers the deterministic backstop in lib/comment-lint.mjs (flags internal cx-* role
 * ids in a consuming project's deliverable, skipped on the Construct repo) and the
 * prevention wiring (rule file, shared guidance, persona, policy inventory) so the
 * guardrail cannot be silently dropped.
 */

import { describe, it, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';

import { lintFile, KNOWN_CX_ROLE_IDS } from '../lib/comment-lint.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const tmpDirs = [];

after(() => {
  for (const dir of tmpDirs) fs.rmSync(dir, { recursive: true, force: true });
});

function fixture(pkgName, rel, content) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cx-invis-'));
  tmpDirs.push(dir);
  fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify({ name: pkgName }));
  const fp = path.join(dir, rel);
  fs.mkdirSync(path.dirname(fp), { recursive: true });
  fs.writeFileSync(fp, content);
  return { dir, fp };
}

const artifactWarnings = (res) => res.warnings.filter((w) => w.kind === 'artifact');

describe('comment-lint flags tool-identity leaks in consuming-project deliverables', () => {
  it('flags an internal cx-* role id in deliverable prose', () => {
    const { dir, fp } = fixture('my-app', 'docs/strategy.md', '# S\n\nOwner: cx-product-manager runs this.\n');
    assert.ok(artifactWarnings(lintFile(fp, { rootDir: dir })).length >= 1);
  });

  it('flags a cx-* role id inside a markdown table cell (where the real leak occurred)', () => {
    const { dir, fp } = fixture('my-app', 'docs/x.md', '# S\n\n| Metric | Owner |\n|---|---|\n| North star | cx-business-strategist |\n');
    assert.ok(artifactWarnings(lintFile(fp, { rootDir: dir })).length >= 1);
  });

  it('does NOT flag the Construct repo itself (package @geraldmaron/construct)', () => {
    const { dir, fp } = fixture('@geraldmaron/construct', 'docs/strategy.md', '# S\n\nOwner: cx-product-manager.\n');
    assert.equal(artifactWarnings(lintFile(fp, { rootDir: dir })).length, 0);
  });

  it('does NOT flag a cx-* id inside an HTML comment (provenance is allowed)', () => {
    const { dir, fp } = fixture('my-app', 'docs/strategy.md', '# S\n\n<!-- provenance: via cx-business-strategist -->\nClean prose only.\n');
    assert.equal(artifactWarnings(lintFile(fp, { rootDir: dir })).length, 0);
  });

  it('does not flag a clean deliverable', () => {
    const { dir, fp } = fixture('my-app', 'docs/strategy.md', '# Strategy\n\nOur bets are sound; the platform wins on reliability.\n');
    assert.equal(artifactWarnings(lintFile(fp, { rootDir: dir })).length, 0);
  });

  it('does not scan non-deliverable paths (e.g. README)', () => {
    const { dir, fp } = fixture('my-app', 'README.md', 'Owner cx-researcher.\n');
    assert.equal(artifactWarnings(lintFile(fp, { rootDir: dir })).length, 0);
  });

  it('does NOT flag unrelated cx-* npm packages (cx-oracle, cx-ray, cx-pro)', () => {
    const { dir, fp } = fixture('my-app', 'docs/strategy.md', '# S\n\nThe driver is cx-oracle; tracing via cx-ray; cx-pro handles the rest.\n');
    assert.equal(artifactWarnings(lintFile(fp, { rootDir: dir })).length, 0);
  });

  it('still flags a real role id when a lookalike package is on the same line', () => {
    const { dir, fp } = fixture('my-app', 'docs/strategy.md', '# S\n\nUses cx-oracle. Owner: cx-product-manager.\n');
    assert.ok(artifactWarnings(lintFile(fp, { rootDir: dir })).length >= 1);
  });

  it('does NOT flag a role id inside a ~~~ tilde fence', () => {
    const { dir, fp } = fixture('my-app', 'docs/strategy.md', '# S\n\n~~~\nrun cx-researcher here\n~~~\nClean prose.\n');
    assert.equal(artifactWarnings(lintFile(fp, { rootDir: dir })).length, 0);
  });

  it('fails closed: a role id after an UNCLOSED fence is still flagged', () => {
    const { dir, fp } = fixture('my-app', 'docs/strategy.md', '# S\n\n```\nopen fence never closed\n\nOwner: cx-product-manager runs this.\n');
    assert.ok(artifactWarnings(lintFile(fp, { rootDir: dir })).length >= 1);
  });

  it('routes leaks to errors[] under block mode', () => {
    const prev = process.env.CONSTRUCT_ARTIFACT_LINT_MODE;
    process.env.CONSTRUCT_ARTIFACT_LINT_MODE = 'block';
    try {
      const { dir, fp } = fixture('my-app', 'docs/strategy.md', '# S\n\nDispatched cx-researcher to gather evidence.\n');
      assert.ok(lintFile(fp, { rootDir: dir }).errors.filter((w) => w.kind === 'artifact').length >= 1);
    } finally {
      if (prev === undefined) delete process.env.CONSTRUCT_ARTIFACT_LINT_MODE;
      else process.env.CONSTRUCT_ARTIFACT_LINT_MODE = prev;
    }
  });
});

describe('tool-invisibility prevention is wired so it cannot be silently dropped', () => {
  it('the canonical rule file exists', () => {
    assert.ok(fs.existsSync(path.join(ROOT, 'rules/common/tool-invisibility.md')));
  });

  it('shared guidance carries the invisibility directive (reaches every specialist)', () => {
    const registry = JSON.parse(fs.readFileSync(path.join(ROOT, 'specialists/registry.json'), 'utf8'));
    const joined = (registry.sharedGuidance || []).join('\n');
    assert.match(joined, /Tool invisibility/);
    assert.match(joined, /tool-invisibility\.md/);
  });

  it('the persona references the rule', () => {
    const persona = fs.readFileSync(path.join(ROOT, 'personas/construct.md'), 'utf8');
    assert.match(persona, /tool-invisibility\.md/);
  });

  it('the policy inventory registers the rule', () => {
    const inv = JSON.parse(fs.readFileSync(path.join(ROOT, 'specialists/policy-inventory.json'), 'utf8'));
    assert.ok(inv.policies.some((p) => p.id === 'tool-invisibility' && p.source === 'rules/common/tool-invisibility.md'));
  });

  it('KNOWN_CX_ROLE_IDS matches specialists/registry.json (drift guard for the anchored regex)', () => {
    const registry = JSON.parse(fs.readFileSync(path.join(ROOT, 'specialists/registry.json'), 'utf8'));
    const expected = registry.specialists.map((s) => s.name).sort();
    assert.deepEqual([...KNOWN_CX_ROLE_IDS].sort(), expected);
  });
});
