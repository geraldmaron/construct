/**
 * tests/audit/prompts-skills-audit.test.mjs — four-check prompts/skills drift audit.
 */

import assert from 'node:assert/strict';
import fs from 'node:fs';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import {
  auditPromptsSkills,
  remediateMcpCatalog,
  RETIRED_CX_SPECIALIST_IDS,
} from '../../lib/audit-prompts-skills.mjs';
import { rmTmpDir } from '../helpers/cleanup.mjs';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

test('auditPromptsSkills passes on the real corpus after catalog remediation', () => {
  const result = auditPromptsSkills({ silent: true });
  assert.equal(result.composition.pass, true, 'skill composition must stay green');
  assert.equal(result.liveWorkerProfileCount, 12);
  assert.equal(result.blocking.length, 0, `blocking: ${JSON.stringify(result.blocking)}`);
  assert.equal(result.pass, true);
  const catalogStale = result.manifest.filter((entry) => entry.kind === 'mcp-catalog-stale-usedBy');
  assert.equal(catalogStale.length, 0);
});

test('mcp catalog usedBy lists only live Worker Profile ids', () => {
  const catalog = JSON.parse(fs.readFileSync(path.join(REPO, 'lib', 'mcp-catalog.json'), 'utf8'));
  const registry = JSON.parse(fs.readFileSync(path.join(REPO, 'registry', 'worker-profiles', 'architect.json'), 'utf8'));
  assert.ok(registry.id);
  const live = new Set(
    fs.readdirSync(path.join(REPO, 'registry', 'worker-profiles'))
      .filter((name) => name.endsWith('.json'))
      .map((name) => name.replace(/\.json$/, '')),
  );
  live.add('construct');
  for (const mcp of catalog.mcps) {
    for (const usedBy of mcp.usedBy) {
      assert.ok(live.has(usedBy), `${mcp.id} usedBy ${usedBy} is not a live Worker Profile id`);
      assert.equal(/^cx-/.test(usedBy), false, `${mcp.id} still carries retired cx id ${usedBy}`);
    }
  }
});

test('routing.json cx tokens are retained with backward-compat citation', () => {
  const result = auditPromptsSkills({ silent: true });
  const routingEntries = result.manifest.filter((entry) => entry.kind === 'routing-stale-cx-token');
  assert.ok(routingEntries.length > 0, 'expected derived routing keywords to pin legacy cx tokens');
  for (const entry of routingEntries) {
    assert.equal(entry.action, 'retain');
    assert.ok(entry.evaluation.passing.includes('backwardCompat'), `${entry.ref} must cite backwardCompat`);
  }
});

test('remediateMcpCatalog replaces retired cx ids in a fixture catalog', () => {
  const root = mkdtempSync(path.join(tmpdir(), 'prompts-skills-audit-'));
  const w = (rel, body) => {
    fs.mkdirSync(path.dirname(path.join(root, rel)), { recursive: true });
    fs.writeFileSync(path.join(root, rel), body);
  };

  for (const catalog of ['workspace-presets', 'worker-profiles', 'procedures', 'policies']) {
    fs.mkdirSync(path.join(root, 'registry', catalog), { recursive: true });
  }
  w('registry/workspace-presets/test.json', JSON.stringify({ id: 'test', displayName: 'Test', skills: [], procedures: [] }));
  w('registry/worker-profiles/operations.json', JSON.stringify({ id: 'operations', displayName: 'Ops', skillEmphasis: [] }));
  w('registry/capabilities.json', JSON.stringify({ schemaVersion: 1, capabilities: [] }));
  w('skills/routing.json', JSON.stringify({ routes: [] }));
  w('registry/worker-profile-audit-enrichments.json', JSON.stringify({ version: 2, workerProfiles: {} }));
  w('lib/mcp-catalog.json', JSON.stringify({
    version: 1,
    mcps: [{
      id: 'memory',
      usedBy: ['construct', 'cx-docs-keeper', 'cx-release-manager', 'operations'],
      env: {},
      requiredEnv: [],
    }],
  }));

  try {
    const { changes } = remediateMcpCatalog({ rootDir: root });
    assert.equal(changes.length, 2);
    const catalog = JSON.parse(fs.readFileSync(path.join(root, 'lib', 'mcp-catalog.json'), 'utf8'));
    assert.deepEqual(catalog.mcps[0].usedBy, ['construct', 'operations']);
    const audit = auditPromptsSkills({ rootDir: root, silent: true });
    assert.equal(audit.pass, true);
  } finally {
    rmTmpDir(root);
  }
});

test('retired cx specialist set covers ADR-0065 folded ids', () => {
  for (const id of ['cx-oracle', 'cx-devil-advocate', 'cx-docs-keeper', 'cx-explorer']) {
    assert.ok(RETIRED_CX_SPECIALIST_IDS.has(id), `${id} must be classified retired`);
  }
});
