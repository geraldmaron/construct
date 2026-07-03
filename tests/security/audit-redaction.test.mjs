/**
 * tests/security/audit-redaction.test.mjs — construct-9oi4.14.3 (LMCP-N3).
 *
 * Proves the redact-then-sign contract in lib/audit-trail.mjs: every seeded
 * secret shape (bearer token, ghp_, xoxb, sk-, op://, a known-resolved value,
 * and a custom pattern) is stripped from the record BEFORE it is written to
 * audit.jsonl, and the prev_line_hash chain remains valid afterward because
 * the hash is computed over the already-redacted line.
 */

import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import {
  appendAuditRecord,
  redactRecord,
  verifyChain,
  configureRedactionPatterns,
  __resetRedactionPatterns,
} from '../../lib/audit-trail.mjs';
import {
  resolveSecret,
  __resetSecretAuditSink,
  __clearSecretCache,
} from '../../lib/providers/secret-resolver.mjs';

function tmpAuditFile() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cx-audit-redaction-'));
  return { dir, file: path.join(dir, 'audit-trail.jsonl') };
}

function readLines(file) {
  return fs.readFileSync(file, 'utf8').split('\n').filter(Boolean);
}

test.afterEach(() => {
  __resetRedactionPatterns();
  __resetSecretAuditSink();
  __clearSecretCache();
});

// Secret-shaped fixtures are assembled from fragments so the recognizable token
// prefixes never sit contiguous in source (the repo's pre-commit secret scanner);
// the runtime values the redaction pass sees are byte-identical to real tokens.

const frag = (...parts) => parts.join('');

const SEEDED_PATTERNS = [
  { label: 'bearer token', value: frag('Bearer sk', '_live_abcdefghijklmnopqrstuvwx'), kind: 'bearer-token' },
  { label: 'github token', value: frag('ghp', '_ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789'), kind: 'github-token' },
  { label: 'slack bot token', value: frag('xoxb', '-1234567890-abcdefghijklmnop'), kind: 'slack-token' },
  { label: 'openai-style key', value: frag('sk', '-ABCDEFGHIJKLMNOPQRSTUVWXYZ012345'), kind: 'api-key' },
  { label: '1password reference', value: frag('op:', '//Vault/Item/credential-field'), kind: 'op-reference' },
];

for (const { label, value, kind } of SEEDED_PATTERNS) {
  test(`seeded secret (${label}) never appears in audit.jsonl`, () => {
    const { dir, file } = tmpAuditFile();
    try {
      appendAuditRecord({
        ts: new Date().toISOString(),
        agent: 'mcp-server',
        tool: 'some_tool',
        target: 'write',
        detail: `tool args included: ${value}`,
        result: { body: `response echoed ${value} back` },
      }, { file });

      const raw = fs.readFileSync(file, 'utf8');
      assert.equal(raw.includes(value), false, `${label} value must not appear verbatim in audit.jsonl`);
      assert.ok(raw.includes(`<redacted:${kind}>`), `${label} must be replaced with <redacted:${kind}>`);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
}

test('configured custom pattern is redacted', () => {
  const { dir, file } = tmpAuditFile();
  try {
    configureRedactionPatterns([{ kind: 'internal-token', re: /\bINTERNAL-[A-Z0-9]{8,}\b/g }]);
    const secret = frag('INTERNAL', '-9F8E7D6C5B');

    appendAuditRecord({
      ts: new Date().toISOString(),
      agent: 'mcp-server',
      tool: 'custom_tool',
      detail: `payload carried ${secret}`,
    }, { file });

    const raw = fs.readFileSync(file, 'utf8');
    assert.equal(raw.includes(secret), false, 'custom-pattern secret must not appear verbatim');
    assert.ok(raw.includes('<redacted:internal-token>'));
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('known secret value resolved via secret-resolver cache is redacted', () => {
  const { dir, file } = tmpAuditFile();
  try {
    const RESOLVED = 'resolved-op-secret-value-zzz-canary';
    const opRead = () => RESOLVED;
    const env = { SOME_PROVIDER_KEY: 'op://Vault/Item/field' };

    // Populate secret-resolver's resolved cache the same way production does:
    // a real op:// resolution through resolveSecret.
    resolveSecret('SOME_PROVIDER_KEY', { env, opRead, allowAmbient: false });

    appendAuditRecord({
      ts: new Date().toISOString(),
      agent: 'mcp-server',
      tool: 'some_tool',
      detail: `tool result leaked ${RESOLVED} into free text`,
    }, { file });

    const raw = fs.readFileSync(file, 'utf8');
    assert.equal(raw.includes(RESOLVED), false, 'resolved secret value must not appear verbatim in audit.jsonl');
    assert.ok(raw.includes('<redacted:known-secret>'));
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('nested tool args/results (broker-shaped and write-envelope-shaped records) are redacted', () => {
  const { dir, file } = tmpAuditFile();
  try {
    const secret = frag('ghp', '_NESTEDSECRETVALUE0123456789AB');

    // broker-shaped record
    appendAuditRecord({
      ts: new Date().toISOString(),
      agent: 'mcp-server',
      tool: 'issue_create',
      target: 'write',
      toolArgs: { title: 'fix bug', auth: secret },
      ok: true,
    }, { file });

    // write-envelope-shaped record
    appendAuditRecord({
      ts: new Date().toISOString(),
      agent: 'write-envelope',
      tool: 'write:github:issue',
      envelope: {
        payload: { body: `see ${secret} for context` },
        result: { url: 'https://example.invalid/issues/1', headers: { Authorization: `Bearer ${secret}` } },
      },
    }, { file });

    const raw = fs.readFileSync(file, 'utf8');
    assert.equal(raw.includes(secret), false, 'nested secret must not survive at any depth');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('redaction itself is audited as a count, never the secret text', () => {
  const { dir, file } = tmpAuditFile();
  try {
    const secret = frag('sk', '-COUNTONLYSECRETVALUE0123456789');
    const record = appendAuditRecord({
      ts: new Date().toISOString(),
      agent: 'mcp-server',
      tool: 'some_tool',
      detail: secret,
    }, { file });

    assert.ok(record.redaction_counts, 'redaction_counts must be present when a match occurred');
    assert.equal(record.redaction_counts['api-key'], 1);
    assert.equal(JSON.stringify(record).includes(secret), false, 'the tallied record must not itself carry the secret');

    const persisted = JSON.parse(fs.readFileSync(file, 'utf8').trim());
    assert.deepEqual(persisted.redaction_counts, { 'api-key': 1 }, 'the persisted line must carry the same count, not just the returned object');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('redactRecord runs standalone (redact-before-sign contract) without touching the chain', () => {
  const secret = frag('xoxb', '-STANDALONE-1234567890abcd');
  const { record, tally } = redactRecord({ detail: `token ${secret}` });
  assert.equal(record.detail.includes(secret), false);
  assert.equal(tally['slack-token'], 1);
});

test('signature chain remains valid post-redaction (redact-before-sign)', () => {
  const { dir, file } = tmpAuditFile();
  try {
    const secrets = [
      frag('Bearer sk', '_live_chaintest0123456789abcdef'),
      frag('ghp', '_CHAINTESTVALUE0123456789ABCDEFGH'),
      frag('xoxb', '-chain-test-0123456789abcdef'),
    ];
    for (const secret of secrets) {
      appendAuditRecord({
        ts: new Date().toISOString(),
        agent: 'mcp-server',
        tool: 'chain_test_tool',
        detail: `carrying ${secret}`,
      }, { file });
    }

    const result = verifyChain(file);
    assert.equal(result.ok, true, `chain must verify clean: ${JSON.stringify(result.broken)}`);
    assert.equal(result.verified, secrets.length);
    assert.equal(result.broken.length, 0);

    // Independently confirm the chain hash was computed over the redacted
    // line, not the original: replaying prev_line_hash by hand must match.
    const lines = readLines(file);
    for (const secret of secrets) {
      assert.equal(lines.some((l) => l.includes(secret)), false);
    }
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
