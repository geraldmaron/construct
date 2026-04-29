/**
 * distill.test.mjs — Unit tests for lib/distill.mjs query-focused document distillation.
 *
 * Covers: chunk scoring, top-k selection, citation formatting, context
 * assembly, truncation metadata, and domain overlay injection.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { distill } from '../lib/distill.mjs';

function tempDir(prefix) {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

test('distill produces query-focused structured JSON with citations', async () => {
  const root = tempDir('construct-distill-');
  fs.writeFileSync(path.join(root, 'a.md'), '# Setup\nConstruct setup now replaces installer scripts.\n\n## Release\nPublish tagged releases from GitHub.\n');
  fs.writeFileSync(path.join(root, 'b.md'), '# Telemetry\nPhoenix runtime plugin is wired through sync.\n');

  const result = await distill(root, {
    format: 'extract',
    query: 'What changed in setup?',
    mode: 'json',
  });

  assert.equal(result.format, 'extract');
  assert.equal(result.query, 'What changed in setup?');
  assert.ok(result.chunkCount >= 1);
  assert.equal(result.sufficiency.status, 'partial');
  assert.ok(result.evidence.every((item) => item.citation.includes('[source:')));
  assert.ok(result.prompt.includes('Query: What changed in setup?'));
});

test('distill preserves contextual metadata for selected chunks', async () => {
  const root = tempDir('construct-distill-');
  fs.writeFileSync(path.join(root, 'guide.md'), '# Guide\n\n## Install\nUse construct setup after install.\n\n## Verify\nRun construct doctor.\n');

  const result = await distill(root, {
    format: 'summary',
    mode: 'json',
  });

  assert.equal(result.files.length, 1);
  assert.equal(result.files[0].title, 'Guide');
  assert.ok(result.files[0].sections.includes('Guide'));
  assert.ok(result.evidence[0].id.includes('guide.md#'));
});

test('distill bounds reads for very large files and reports truncation metadata', async () => {
  const root = tempDir('construct-distill-large-');
  const largeBody = ['# Large Doc', '## Setup', 'construct setup replaces installer scripts.', ''].concat(
    Array.from({ length: 12000 }, (_, i) => `Filler line ${i} for a very large file.`),
  ).concat(['', '## Release', 'Publish tagged releases from GitHub.']).join('\n');
  fs.writeFileSync(path.join(root, 'large.md'), largeBody);

  const result = await distill(root, {
    format: 'extract',
    query: 'What changed in setup and release flow?',
    mode: 'json',
  });

  assert.equal(result.files.length, 1);
  assert.equal(result.files[0].truncated, true);
  assert.ok(result.files[0].originalBytes > result.files[0].sampledBytes);
  assert.ok(result.evidence.some((item) => item.truncated === true));
  assert.ok(result.prompt.includes('What changed in setup and release flow?'));
});

test('distill includes active domain overlays in structured output', async () => {
  const root = tempDir('construct-distill-overlay-');
  fs.mkdirSync(path.join(root, '.cx', 'domain-overlays'), { recursive: true });
  fs.writeFileSync(path.join(root, '.cx', 'domain-overlays', 'terraform.json'), `${JSON.stringify({
    id: 'terraform',
    type: 'domain-overlay',
    domain: 'terraform',
    objective: 'design infra patterns',
    scope: 'aws',
    attachTo: ['cx-architect'],
    focus: 'architecture',
    status: 'active',
  }, null, 2)}\n`);
  fs.writeFileSync(path.join(root, 'guide.md'), '# Guide\nTerraform module patterns live here.\n');

  const result = await distill(root, {
    format: 'extract',
    query: 'terraform patterns',
    mode: 'json',
  });

  assert.equal(result.overlays.length, 1);
  assert.equal(result.overlays[0].domain, 'terraform');
  assert.ok(result.prompt.includes('Active domain overlays:'));
});
