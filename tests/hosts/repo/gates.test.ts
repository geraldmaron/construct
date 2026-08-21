/**
 * tests/hosts/repo/gates.test.ts — the manifest reader, asked its question of
 * real consumer repositories built for the occasion.
 *
 * Never this checkout. What a script name means is judged in kernel/plan/gates
 * and tested against hand-built manifests there; what is left to prove here is
 * that a directory on disk is read correctly, that a directory with no manifest
 * is a different answer from one whose manifest declares nothing, and that an
 * outcome filed against each renders the obligation the right way round.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { readRepoManifest, readRepoManifests } from '../../../src/hosts/repo/gates.ts';
import { gateObligation, gatesDeclared } from '../../../src/kernel/plan/gates.ts';
import { assignmentFor } from '../../../src/kernel/run/coordinator.ts';
import type { Brief } from '../../../src/kernel/brief/schema.ts';

/** A consumer repository on disk, rooted in a tmpdir and never near a real home. */
function consumerRepo(manifest: unknown | null): { root: string; cleanup(): void } {
  const root = mkdtempSync(join(tmpdir(), 'construct-consumer-'));
  mkdirSync(join(root, 'src'), { recursive: true });
  writeFileSync(join(root, 'src', 'app.ts'), 'export const app = true;\n');
  if (manifest !== null) {
    writeFileSync(join(root, 'package.json'), `${JSON.stringify(manifest, null, 2)}\n`);
  }
  return { root, cleanup: () => rmSync(root, { recursive: true, force: true }) };
}

const brief = (role: string): Brief => ({
  id: `t-${role}`,
  outcome: 'ship the new checkout screen',
  role,
  inputs: [],
  capabilities: [],
  postconditions: [],
});

const GATED_MANIFEST = {
  name: 'consumer-app',
  scripts: {
    build: 'tsc -p .',
    lint: 'eslint . --max-warnings 0',
    'test:a11y': 'playwright test accessibility',
    'test:security': 'node scripts/check-security.mjs',
    'test:perf': 'node scripts/measure-perf.mjs',
  },
};

const UNGATED_MANIFEST = {
  name: 'plain-app',
  scripts: { build: 'tsc -p .', test: 'node --test' },
};

test('a consumer repository declaring its own gates is read, in the order it wrote them', () => {
  const repo = consumerRepo(GATED_MANIFEST);
  try {
    const manifest = readRepoManifest(repo.root);
    assert.ok(manifest, 'the manifest is readable');
    assert.equal(manifest.root, repo.root);
    assert.deepEqual(
      manifest.scripts.map((s) => s.name),
      ['build', 'lint', 'test:a11y', 'test:security', 'test:perf'],
    );
    assert.deepEqual(
      gatesDeclared([manifest]).map((g) => [g.concern, g.script]),
      [
        ['accessibility', 'test:a11y'],
        ['security', 'test:security'],
        ['performance', 'test:perf'],
      ],
    );
  } finally {
    repo.cleanup();
  }
});

test('an outcome filed against a gated repository renders obligations naming those exact gates', () => {
  const repo = consumerRepo(GATED_MANIFEST);
  try {
    const ground = { groundRoots: [repo.root], manifests: readRepoManifests([repo.root]) };
    const design = assignmentFor(brief('accessibility'), undefined, ground);
    assert.match(
      design,
      /this repo has a gate for accessibility — test:a11y — and the work must pass it/,
    );
    assert.match(design, new RegExp(`It is a script in ${repo.root}`));

    const security = assignmentFor(brief('security'), undefined, ground);
    assert.match(
      security,
      /this repo has a gate for security — test:security — and the work must pass it/,
    );

    const operations = assignmentFor(brief('operations'), undefined, ground);
    assert.match(
      operations,
      /this repo has a gate for performance — test:perf — and the work must pass it/,
    );
  } finally {
    repo.cleanup();
  }
});

test('an outcome filed against a repository with no such scripts renders the standard-only fallback', () => {
  const repo = consumerRepo(UNGATED_MANIFEST);
  try {
    const ground = { groundRoots: [repo.root], manifests: readRepoManifests([repo.root]) };
    const design = assignmentFor(brief('accessibility'), undefined, ground);
    assert.match(design, /declares no accessibility gate/);
    assert.match(design, /the obligation is the standard itself: Web Content Accessibility Guidelines/);
    assert.ok(!design.includes('has a gate for accessibility'));

    const security = assignmentFor(brief('security'), undefined, ground);
    assert.match(security, /declares no security gate/);
    assert.match(security, /Application Security Verification Standard/);
  } finally {
    repo.cleanup();
  }
});

test('a root with no manifest reads as none; a manifest with no scripts reads as declaring none', () => {
  const bare = consumerRepo(null);
  const scriptless = consumerRepo({ name: 'scriptless' });
  try {
    assert.equal(readRepoManifest(bare.root), null, 'no manifest is not an empty manifest');
    assert.deepEqual(readRepoManifests([bare.root]), []);

    const manifest = readRepoManifest(scriptless.root);
    assert.deepEqual(manifest, { root: scriptless.root, scripts: [] });

    // Both land the role on the standard, which is the point: the obligation
    // does not vary with how a repository failed to declare a gate.
    const line = gateObligation('design', {
      roots: [bare.root, scriptless.root],
      manifests: readRepoManifests([bare.root, scriptless.root]),
    });
    assert.match(line, /declares no accessibility gate/);
  } finally {
    bare.cleanup();
    scriptless.cleanup();
  }
});

test('a manifest nobody can parse declares nothing, rather than throwing into the dispatch', () => {
  const repo = consumerRepo(null);
  try {
    writeFileSync(join(repo.root, 'package.json'), '{ this is not json\n');
    assert.equal(readRepoManifest(repo.root), null);
  } finally {
    repo.cleanup();
  }
});

test('a non-string script body is skipped rather than read as a command', () => {
  const repo = consumerRepo({ scripts: { build: 'tsc', broken: { nested: true }, 'test:a11y': 'axe' } });
  try {
    const manifest = readRepoManifest(repo.root);
    assert.deepEqual(manifest?.scripts.map((s) => s.name), ['build', 'test:a11y']);
  } finally {
    repo.cleanup();
  }
});
