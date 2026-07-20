/**
 * Verifies the tool-invisibility guardrail for deliverable artifacts.
 *
 * Covers deterministic detection of internal cx-* Worker Profile ids in
 * consuming projects and the canonical rule, prompt, policy, and registry
 * wiring that prevents the guardrail from being silently dropped.
 */

import { describe, it, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';

import { lintFile, KNOWN_WORKER_PROFILE_IDS } from '../lib/comment-lint.mjs';
import { getRegistry } from './test-registry-fixtures.mjs';

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
  it('flags an internal cx-* Worker Profile id in deliverable prose', () => {
    const { dir, fp } = fixture('my-app', 'docs/strategy.md', '# S\n\nOwner: cx-product-manager runs this.\n');
    assert.ok(artifactWarnings(lintFile(fp, { rootDir: dir })).length >= 1);
  });

  it('flags a cx-* Worker Profile id inside a markdown table cell', () => {
    const { dir, fp } = fixture('my-app', 'docs/x.md', '# S\n\n| Metric | Owner |\n|---|---|\n| North star | cx-data-analyst |\n');
    assert.ok(artifactWarnings(lintFile(fp, { rootDir: dir })).length >= 1);
  });

  it('does NOT flag the Construct repo itself (package @geraldmaron/construct)', () => {
    const { dir, fp } = fixture('@geraldmaron/construct', 'docs/strategy.md', '# S\n\nOwner: cx-product-manager.\n');
    assert.equal(artifactWarnings(lintFile(fp, { rootDir: dir })).length, 0);
  });

  it('does NOT flag a cx-* Worker Profile id inside an HTML comment', () => {
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

  it('does NOT flag unrelated cx-* npm packages (cx-ray, cx-pro, cx-widget)', () => {
    const { dir, fp } = fixture('my-app', 'docs/strategy.md', '# S\n\nThe driver is cx-widget; tracing via cx-ray; cx-pro handles the rest.\n');
    assert.equal(artifactWarnings(lintFile(fp, { rootDir: dir })).length, 0);
  });

  it('still flags a real Worker Profile id when a lookalike package is on the same line', () => {
    const { dir, fp } = fixture('my-app', 'docs/strategy.md', '# S\n\nUses cx-ray. Owner: cx-product-manager.\n');
    assert.ok(artifactWarnings(lintFile(fp, { rootDir: dir })).length >= 1);
  });

  it('does NOT flag a Worker Profile id inside a ~~~ tilde fence', () => {
    const { dir, fp } = fixture('my-app', 'docs/strategy.md', '# S\n\n~~~\nrun cx-researcher here\n~~~\nClean prose.\n');
    assert.equal(artifactWarnings(lintFile(fp, { rootDir: dir })).length, 0);
  });

  it('fails closed when a Worker Profile id follows an unclosed fence', () => {
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

  it('org policy carries the invisibility directive', () => {
    const registry = getRegistry();
    const policy = registry.policies?.['tool-invisibility'];
    assert.match(`${policy?.id}\n${policy?.description}\n${policy?.enforcement}`, /tool-invisibility|invisibility/i);
    assert.equal(policy?.ownerWorkerProfile, 'orchestrator');
    assert.match(policy?.enforcement || '', /comment-lint\.mjs/);
  });

  it('the Construct Worker Profile prompt references the rule', () => {
    const prompt = fs.readFileSync(path.join(ROOT, 'registry/worker-profiles/prompts/construct.md'), 'utf8');
    assert.match(prompt, /tool-invisibility\.md/);
  });

  it('the policy inventory registers the canonical guardrail', () => {
    const registry = getRegistry();
    const policies = Object.values(registry.policies || {});
    assert.ok(policies.some((policy) => policy.id === 'tool-invisibility'
      && policy.ownerWorkerProfile === 'orchestrator'
      && /worker-profile prompt/i.test(policy.enforcement || '')));
  });

  it('KNOWN_WORKER_PROFILE_IDS matches registry (drift guard for the anchored regex)', () => {
    const registry = getRegistry();
    const expected = Object.values(registry.workerProfiles || {}).map((profile) => profile.id).sort();
    assert.deepEqual([...KNOWN_WORKER_PROFILE_IDS].sort(), expected);
  });
});
