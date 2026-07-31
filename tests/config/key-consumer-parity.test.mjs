/**
 * tests/config/key-consumer-parity.test.mjs — every documented construct.config.json
 * key must have a real reader somewhere outside lib/config/schema.mjs itself.
 *
 * Walks FIELD_RULES recursively to a flat list of leaf key paths, then greps
 * lib/ and scripts/ (excluding the schema declaration and its own loader
 * plumbing) for a reference to each leaf — either the last two path segments
 * joined by a literal dot (the common `config?.deployment?.tenantId` /
 * `config.resources.disk.totalConstructMaxMb` access shape, after normalizing away
 * optional-chaining `?.` to `.`) or the last segment alone as a property
 * access / object key. This is the regression guard for that drift:
 * DATABASE_URL was read and ignored, CONSTRUCT_TENANT_ID/tenantId
 * was schema-declared but dormant, and the postgres queue backend silently
 * aliased to git — a documented key must either do something or not exist.
 *
 * ALLOWLIST is a deliberate, tracked exception list — not a silent pass.
 * Each entry cites the bead that owns fixing it so this test cannot be used
 * to launder a newly-discovered dead key without a paper trail. Empty as of
 * roleSelection.* and hosts.<surface>.enabled were
 * removed from the schema (each was already superseded by a separate live
 * mechanism — CONSTRUCT_ROLE_PRIMARY/SECONDARY via `roles:set`, and
 * --hosts=/CONSTRUCT_SYNC_HOSTS — so the config-file keys
 * were never going to be read); deployment.mcpBroker and autoEmbed were
 * wired into isBrokered() (lib/mcp/broker.mjs) and
 * autoStartEmbedIfNeeded() (lib/embed/cli.mjs) respectively, following the
 * same env > project-config > default precedence as deployment.mode.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { FIELD_RULES } from '../../lib/config/schema.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '..', '..');

const ALLOWLIST = new Set([]);

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
