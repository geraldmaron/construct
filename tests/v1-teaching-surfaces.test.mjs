/**
 * tests/v1-teaching-surfaces.test.mjs — ratchet against Construct 1.0 teaching
 * strings on live skills/rules/registry/examples/templates/commands surfaces.
 *
 * Docs/, init/setup binaries, and diagram-export.mjs ownership are out of scope.
 * Anti-pattern fixtures under examples/internal/.../bad/ are exempt.
 */

import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';

const ROOT = path.resolve(import.meta.dirname, '..');

const TEACHING_ROOTS = [
  'skills',
  'rules',
  'registry',
  'examples',
  'templates',
  'commands',
  'packages/construct-ui/prototypes',
];

const EXTRA_FILES = [
  'lib/artifact-lifecycle.mjs',
  'lib/orchestration/guidance-capability-drift.mjs',
  'lib/host-capabilities.mjs',
  'lib/ingest/strategy.mjs',
  'lib/artifact-quality.mjs',
  'lib/document-ingest.mjs',
];

const SCAN_EXT = new Set(['.md', '.mdx', '.mjs', '.js', '.json', '.typ', '.tape', '.txt']);

const BANNED = Object.freeze([
  { id: 'cli-workflow-invoke', re: /construct\s+workflow\s+invoke/i },
  { id: 'mcp-workflow-invoke', re: /\bworkflow_invoke\b/ },
  { id: 'mcp-list-teams', re: /\blist_teams\b/ },
  { id: 'mermaid-handdrawn-theme', re: /look\s*:\s*handDrawn|handDrawn\s*:\s*true/ },
  { id: 'caveat-publish-font', re: /Caveat\.ttf|fontFamily\s*[:=]\s*['"]Caveat['"]/ },
  { id: 'persona-phase-owners', re: /Treat personas as phase owners/i },
  { id: 'dispatching-specialists', re: /dispatching specialists autonomously/i },
  { id: 'specialist-chain-teaching', re: /\bspecialist chain\b/i },
]);

function isExempt(relative) {
  if (relative.startsWith('examples/internal/') && relative.includes('/bad/')) return true;
  if (relative.includes('/obsolete/')) return true;
  return false;
}

function filesBelow(dir, out = []) {
  if (!fs.existsSync(dir)) return out;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === 'node_modules' || entry.name === '.git') continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) filesBelow(full, out);
    else if (entry.isFile() && SCAN_EXT.has(path.extname(entry.name))) out.push(full);
  }
  return out;
}

function collectTeachingFiles() {
  const files = [];
  for (const root of TEACHING_ROOTS) {
    filesBelow(path.join(ROOT, root), files);
  }
  for (const rel of EXTRA_FILES) {
    const full = path.join(ROOT, rel);
    if (fs.existsSync(full)) files.push(full);
  }
  return files;
}

test('teaching surfaces do not reintroduce Construct 1.0 CLI/MCP/identity patterns', () => {
  const hits = [];
  for (const file of collectTeachingFiles()) {
    const relative = path.relative(ROOT, file).split(path.sep).join('/');
    if (isExempt(relative)) continue;
    const lines = fs.readFileSync(file, 'utf8').split('\n');
    lines.forEach((line, index) => {
      for (const ban of BANNED) {
        if (ban.re.test(line)) {
          hits.push(`${relative}:${index + 1} [${ban.id}] ${line.trim()}`);
        }
        ban.re.lastIndex = 0;
      }
    });
  }
  assert.deepEqual(hits, [], `v1 teaching strings remain:\n${hits.join('\n')}`);
});

test('lifecycle plan-only handoff teaches procedure invoke, not workflow invoke', () => {
  const text = fs.readFileSync(path.join(ROOT, 'lib/artifact-lifecycle.mjs'), 'utf8');
  assert.match(text, /procedure invoke returns a plan only/);
  assert.doesNotMatch(text, /workflow invoke returns a plan only/);
});

test('front-door prompt routes plan preview through procedure_invoke', () => {
  const text = fs.readFileSync(
    path.join(ROOT, 'registry/worker-profiles/prompts/construct.md'),
    'utf8',
  );
  assert.match(text, /tool `procedure_invoke`/);
  assert.doesNotMatch(text, /workflow_invoke/);
});
