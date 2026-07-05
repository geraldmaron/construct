/**
 * tests/config/key-consumer-parity.test.mjs — every documented construct.config.json
 * key must have a real reader somewhere outside lib/config/schema.mjs itself.
 *
 * Walks FIELD_RULES recursively to a flat list of leaf key paths, then greps
 * lib/ and scripts/ (excluding the schema declaration and its own loader
 * plumbing) for a reference to each leaf — either the last two path segments
 * joined by a literal dot (the common `config?.deployment?.tenantId` /
 * `config.resources.disk.totalCxMaxMb` access shape, after normalizing away
 * optional-chaining `?.` to `.`) or the last segment alone as a property
 * access / object key. This is the regression guard for construct-9oi4.15.2
 * (LMCP-O2): DATABASE_URL was read and ignored, CONSTRUCT_TENANT_ID/tenantId
 * was schema-declared but dormant, and the postgres queue backend silently
 * aliased to git — a documented key must either do something or not exist.
 *
 * ALLOWLIST is a deliberate, tracked exception list — not a silent pass.
 * Each entry cites the bead that owns fixing it so this test cannot be used
 * to launder a newly-discovered dead key without a paper trail.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { FIELD_RULES, SURFACES } from '../../lib/config/schema.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '..', '..');

// Keys already known to lack a real consumer, discovered while building this
// test. Out of scope for construct-9oi4.15.2 (only DATABASE_URL,
// CONSTRUCT_TENANT_ID and the postgres->git alias were in that bead's
// evidence) and out of this agent's file allowlist (fixing them touches
// whatever module would own role selection / host filtering). Tracked by
// construct-9oi4.15.9.

const ALLOWLIST = new Set([
  'roleSelection.primary',
  'roleSelection.secondary',
  'roleSelection.perConversationOverride',
  ...SURFACES.map((s) => `hosts.${s}.enabled`),
  // deployment.mcpBroker: isBrokered() (lib/mcp/broker.mjs) reads only
  // CONSTRUCT_MCP_BROKER + deployment mode, never this config field.
  'deployment.mcpBroker',
  // autoEmbed: the real gate is the unrelated env var CX_AUTO_EMBED
  // (lib/embed/cli.mjs, lib/hooks/session-start.mjs); this config field
  // is never read.
  'autoEmbed',
]);

function collectLeafPaths(fields, prefix = []) {
  const paths = [];
  for (const [key, rule] of Object.entries(fields)) {
    const nextPrefix = [...prefix, key];
    if (rule && rule.type === 'object' && rule.fields) {
      paths.push(...collectLeafPaths(rule.fields, nextPrefix));
    } else {
      paths.push(nextPrefix);
    }
  }
  return paths;
}

function listSourceFiles(dir) {
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === 'node_modules' || entry.name.startsWith('.')) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      out.push(...listSourceFiles(full));
    } else if (entry.name.endsWith('.mjs') || entry.name.endsWith('.js')) {
      out.push(full);
    }
  }
  return out;
}

const EXCLUDED_FILES = new Set([
  path.join(REPO_ROOT, 'lib', 'config', 'schema.mjs'),
]);

function loadSourceCorpus() {
  const dirs = ['lib', 'scripts', 'bin'].map((d) => path.join(REPO_ROOT, d)).filter((d) => fs.existsSync(d));
  const files = dirs.flatMap(listSourceFiles).filter((f) => !EXCLUDED_FILES.has(f));
  return files.map((f) => fs.readFileSync(f, 'utf8').replace(/\?\./g, '.')).join('\n');
}

const CORPUS = loadSourceCorpus();

function hasConsumer(pathSegments) {
  const last = pathSegments[pathSegments.length - 1];
  if (pathSegments.length >= 2) {
    const pair = pathSegments.slice(-2).join('.');
    if (CORPUS.includes(pair)) return true;
  }
  const dotAccess = CORPUS.includes(`.${last}`);
  const bracketAccess = CORPUS.includes(`['${last}']`) || CORPUS.includes(`["${last}"]`);
  const quotedKeyRe = new RegExp(`['"\`]${last}['"\`]\\s*:`);
  return dotAccess || bracketAccess || quotedKeyRe.test(CORPUS);
}

test('every FIELD_RULES leaf key has a real consumer outside schema.mjs', () => {
  const leaves = collectLeafPaths(FIELD_RULES);
  const missing = [];
  for (const segments of leaves) {
    const dotted = segments.join('.');
    if (ALLOWLIST.has(dotted)) continue;
    if (!hasConsumer(segments)) missing.push(dotted);
  }
  assert.deepEqual(
    missing,
    [],
    `documented config key(s) with no detected consumer: ${missing.join(', ')}. ` +
    'Either wire the key up or remove it from FIELD_RULES/DEFAULT_PROJECT_CONFIG + docs. ' +
    'If genuinely dead and tracked, add it to ALLOWLIST with a bead reference.',
  );
});

test('ALLOWLIST entries are still real FIELD_RULES leaves (no stale exceptions)', () => {
  const leafSet = new Set(collectLeafPaths(FIELD_RULES).map((s) => s.join('.')));
  for (const entry of ALLOWLIST) {
    assert.ok(leafSet.has(entry), `ALLOWLIST entry "${entry}" no longer matches a FIELD_RULES leaf — remove it`);
  }
});

test('the three LMCP-O2 keys named in construct-9oi4.15.2 have real consumers', () => {
  const corpusRaw = CORPUS;
  assert.ok(/resolvePostgresUrl|DATABASE_URL/.test(corpusRaw), 'DATABASE_URL must be read by a real client constructor');
  assert.ok(hasConsumer(['deployment', 'tenantId']), 'deployment.tenantId must have a consumer');
  assert.ok(
    !/postgres.*alias.*git|aliasToGit/i.test(corpusRaw),
    'no silent postgres->git alias should remain in source',
  );
});
