/**
 * tests/functional/agent-instructions-injection.functional.test.mjs —
 * non-destructive marker-block injection into agent-instruction files (ADR-0027 §2,
 * construct-7e2o).
 *
 * Asserts the injector preserves user content byte-for-byte outside its markers,
 * is idempotent on the same version+hash, replaces (never appends) on a body
 * change, dedups against a sibling Beads Integration block, and creates a missing
 * file from a header.
 */

import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { rmTmpDir } from '../helpers/cleanup.mjs';

import {
  injectConstructBlock,
  injectIntoAgentFile,
  buildConstructIntegrationBody,
  variantForFile,
  CONSTRUCT_INTEGRATION_VERSION,
} from '../../lib/agent-instructions/inject.mjs';

const tmpDirs = [];

after(() => {
  for (const dir of tmpDirs) rmTmpDir(dir);
});

function tmpDir(prefix) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  tmpDirs.push(dir);
  return dir;
}

function tmpFile(name, content) {
  const file = path.join(tmpDir('cx-inject-'), name);
  if (content !== undefined) fs.writeFileSync(file, content, 'utf8');
  return file;
}

test('appends a block while preserving user content verbatim', () => {
  const user = '# My Project\n\nMy own notes.\n';
  const body = buildConstructIntegrationBody();
  const { content, action } = injectConstructBlock(user, body);
  assert.equal(action, 'created');
  assert.ok(content.startsWith(user), 'user content preserved at the top');
  assert.match(content, new RegExp(`<!-- BEGIN CONSTRUCT INTEGRATION v:${CONSTRUCT_INTEGRATION_VERSION} hash:[0-9a-f]{12} -->`));
  assert.match(content, /<!-- END CONSTRUCT INTEGRATION -->\n$/);
});

test('is idempotent on the same body', () => {
  const body = buildConstructIntegrationBody();
  const once = injectConstructBlock('# x\n', body).content;
  const twice = injectConstructBlock(once, body);
  assert.equal(twice.action, 'unchanged');
  assert.equal(twice.content, once);
});

test('replaces the block in place on a body change (no duplicate blocks)', () => {
  const first = injectConstructBlock('# x\n', 'OLD BODY').content;
  const second = injectConstructBlock(first, 'NEW BODY');
  assert.equal(second.action, 'updated');
  assert.equal((second.content.match(/BEGIN CONSTRUCT INTEGRATION/g) || []).length, 1);
  assert.match(second.content, /NEW BODY/);
  assert.doesNotMatch(second.content, /OLD BODY/);
});

test('dedups against a sibling Beads Integration block', () => {
  const withBeads = buildConstructIntegrationBody({ hasBeadsBlock: true });
  const without = buildConstructIntegrationBody({ hasBeadsBlock: false });
  assert.match(withBeads, /see the Beads Integration block below/);
  assert.match(without, /run `bd prime`/);
  assert.doesNotMatch(without, /use Beads \(`bd`\) for all task tracking/i);
  assert.match(without, /File signals \(opt-in\)/);
});

test('injectIntoAgentFile preserves an existing file with a beads block', () => {
  const file = tmpFile('AGENTS.md', '# Existing\n\nuser line\n\n<!-- BEGIN BEADS INTEGRATION v:1 -->\nbd stuff\n<!-- END BEADS INTEGRATION -->\n');
  const res = injectIntoAgentFile(file, { version: CONSTRUCT_INTEGRATION_VERSION });
  assert.equal(res.existed, true);
  assert.equal(res.action, 'created');
  const out = fs.readFileSync(file, 'utf8');
  assert.match(out, /# Existing/);
  assert.match(out, /<!-- BEGIN BEADS INTEGRATION/, 'beads block preserved');
  assert.match(out, /see the Beads Integration block below/, 'construct block dedups to beads');

  const again = injectIntoAgentFile(file, { version: CONSTRUCT_INTEGRATION_VERSION });
  assert.equal(again.action, 'unchanged');
});

test('injectIntoAgentFile creates a missing file from a header', () => {
  const dir = tmpDir('cx-inject-new-');
  const file = path.join(dir, 'CLAUDE.md');
  const res = injectIntoAgentFile(file, { version: CONSTRUCT_INTEGRATION_VERSION, header: '# Proj\n' });
  assert.equal(res.existed, false);
  const out = fs.readFileSync(file, 'utf8');
  assert.match(out, /^# Proj\n/);
  assert.match(out, /BEGIN CONSTRUCT INTEGRATION/);
});

test('CLAUDE.md receives the pointer variant importing AGENTS.md (single source)', () => {
  const claude = tmpFile('CLAUDE.md', '# Proj\n\nuser prose\n');
  const agents = tmpFile('AGENTS.md', '# Proj\n');
  const resClaude = injectIntoAgentFile(claude, { version: CONSTRUCT_INTEGRATION_VERSION });
  const resAgents = injectIntoAgentFile(agents, { version: CONSTRUCT_INTEGRATION_VERSION });
  const claudeContent = fs.readFileSync(claude, 'utf8');
  const agentsContent = fs.readFileSync(agents, 'utf8');
  assert.ok(resClaude.changed && resAgents.changed);
  assert.match(claudeContent, /@AGENTS\.md/, 'CLAUDE.md imports AGENTS.md');
  assert.ok(!claudeContent.includes('Durable state'), 'CLAUDE.md does not carry the full body');
  assert.ok(agentsContent.includes('Durable state'), 'AGENTS.md carries the full body');
  assert.ok(claudeContent.startsWith('# Proj\n\nuser prose\n'), 'user prose preserved');
});

test('variantForFile maps CLAUDE.md to pointer and everything else to full', () => {
  assert.equal(variantForFile('/x/CLAUDE.md'), 'pointer');
  assert.equal(variantForFile('/x/AGENTS.md'), 'full');
  assert.equal(variantForFile('AGENTS.md'), 'full');
});
