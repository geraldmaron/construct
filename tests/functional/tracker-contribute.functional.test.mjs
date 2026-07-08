/**
 * tests/functional/tracker-contribute.functional.test.mjs —
 * Jira contribution workflow: analyze → propose → dedupe → apply (bead construct-760c.6).
 *
 * @capability tracker.contribution
 *
 * `sources add` runs the real binary (schema-valid config); the 5-stage pipeline
 * runs in-process with the Jira read/write seams stubbed — deterministic, zero
 * network. Asserts AC1–AC5:
 *   AC1  a proposal artifact is generated with an evidence citation on every issue.
 *   AC2  a planted near-duplicate proposal is suppressed and reported with its
 *        matching issue key.
 *   AC3  --apply without approval is dry-run only — the write seam sees zero
 *        non-dry-run writes.
 *   AC4  with approval, the write payload has the correct issue shape + idempotency
 *        key, and the audit links issue key ↔ proposal id.
 *   AC5  a second apply with the same keys is a no-op (no second create).
 */

import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

import { analyzeAndPropose, applyProposal } from '../../lib/tracker/contribute.mjs';
import { rmTmpDir } from '../helpers/cleanup.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const BIN = path.resolve(__dirname, '..', '..', 'bin', 'construct');

const dirs = [];
test.after(() => { for (const d of dirs) { try { rmTmpDir(d); } catch {} } });

function addSource(cwd, provider, id, selector) {
  const res = spawnSync(process.execPath, [BIN, 'sources', 'add', provider, id, JSON.stringify(selector)], {
    cwd, encoding: 'utf8', env: { ...process.env, HOME: cwd, USERPROFILE: cwd, JIRA_BASE_URL: '', JIRA_API_TOKEN: '' },
  });
  assert.equal(res.status, 0, `sources add ${provider} ${id} failed: ${res.stderr}`);
}

function project() {
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'cx-tracker-'));
  dirs.push(cwd);
  const app = path.join(cwd, 'app-docs');
  fs.mkdirSync(app, { recursive: true });
  fs.writeFileSync(path.join(app, 'auth-hardening.md'), '# Auth hardening plan\n\nRotate tokens and add MFA.\n');
  fs.writeFileSync(path.join(app, 'rate-limit.md'), '# Rate limiting\n\nAdd per-tenant rate limits.\n');
  addSource(cwd, 'directory', 'proj-app', { path: app });
  addSource(cwd, 'jira', 'jira-core', { project: 'CORE' });
  return { cwd };
}

test('AC1: proposal artifact carries an evidence citation on every proposed issue', async () => {
  const { cwd } = project();
  const fetchIssues = async () => [];
  const res = await analyzeAndPropose({ target: 'jira-core', against: 'proj-app', cwd, deps: { fetchIssues, now: () => '2026-07-08T00:00:00.000Z' } });
  assert.equal(res.ok, true, res.message);
  assert.ok(res.proposal.proposals.length >= 2, 'at least one proposal per source doc');
  for (const p of res.proposal.proposals) {
    assert.ok(p.evidence?.length, 'proposal has evidence');
    assert.match(p.description, /`proj-app:.+\.md`/, 'description cites origin project:path');
  }
  assert.ok(fs.existsSync(res.paths.json) && fs.existsSync(res.paths.md), 'proposal artifact persisted');
});

test('AC2: a near-duplicate proposal is suppressed and reported with its matching issue key', async () => {
  const { cwd } = project();
  const fetchIssues = async () => [{ key: 'CORE-42', summary: 'Track: Auth hardening plan (proj-app)' }];
  const res = await analyzeAndPropose({ target: 'jira-core', against: 'proj-app', cwd, deps: { fetchIssues, now: () => '2026-07-08T00:00:00.000Z' } });
  assert.equal(res.ok, true, res.message);
  const suppressed = res.proposal.suppressed.find((s) => s.matchedIssueKey === 'CORE-42');
  assert.ok(suppressed, 'the auth-hardening proposal is suppressed against CORE-42');
  assert.ok(!res.proposal.proposals.some((p) => /Auth hardening/.test(p.summary)), 'suppressed proposal not in the write set');
});

test('AC3: --apply without approval is dry-run only — zero non-dry writes', async () => {
  const { cwd } = project();
  await analyzeAndPropose({ target: 'jira-core', against: 'proj-app', cwd, deps: { fetchIssues: async () => [], now: () => '2026-07-08T00:00:00.000Z' } });
  const proposalId = fs.readdirSync(path.join(cwd, '.cx', 'tracker', 'proposals')).find((f) => f.endsWith('.json')).replace('.json', '');

  const writes = [];
  const providerWrite = async (args) => { writes.push(args); return { status: 'dry-run', dryRun: true }; };
  const res = await applyProposal({ proposalId, cwd, deps: { providerWrite } });
  assert.equal(res.dryRun, true);
  assert.ok(writes.length >= 2, 'each proposal rendered');
  assert.ok(writes.every((w) => w.dry_run === true), 'no non-dry-run write without approval');
});

test('AC4/AC5: approval writes the correct payload + idempotency, and re-apply is a no-op', async () => {
  const { cwd } = project();
  await analyzeAndPropose({ target: 'jira-core', against: 'proj-app', cwd, deps: { fetchIssues: async () => [], now: () => '2026-07-08T00:00:00.000Z' } });
  const proposalId = fs.readdirSync(path.join(cwd, '.cx', 'tracker', 'proposals')).find((f) => f.endsWith('.json')).replace('.json', '');

  let created = 0;
  const writes = [];
  const providerWrite = async (args) => {
    writes.push(args);
    if (args.dry_run === false) { created++; return { status: 'ok', envelope: { result: { key: `CORE-${100 + created}` } } }; }
    return { status: 'dry-run', dryRun: true };
  };

  const first = await applyProposal({ proposalId, approveToken: 'tok-abc', cwd, deps: { providerWrite, now: () => '2026-07-08T00:00:00.000Z' } });
  assert.equal(first.dryRun, false);
  const write = writes[0];
  assert.equal(write.item.type, 'issue');
  assert.equal(write.item.project, 'CORE');
  assert.ok(write.item.summary && write.item.description, 'issue payload has summary + description');
  assert.match(write.idempotency_key, new RegExp(`^${proposalId}:`), 'idempotency key namespaced to the proposal');
  assert.equal(write.approval_token, 'tok-abc');
  assert.ok(first.audit.length >= 2 && first.audit.every((a) => a.issueKey && a.proposalId === proposalId), 'audit links issue key ↔ proposal id');

  const createdAfterFirst = created;
  const second = await applyProposal({ proposalId, approveToken: 'tok-abc', cwd, deps: { providerWrite, now: () => '2026-07-08T00:00:00.000Z' } });
  assert.equal(created, createdAfterFirst, 're-apply creates nothing new (idempotent)');
  assert.ok(second.results.every((r) => r.status === 'skipped-idempotent'), 'every item skipped on re-apply');
});

test('R3/unknown: an unknown tracker target is a hard error', async () => {
  const { cwd } = project();
  await assert.rejects(
    () => analyzeAndPropose({ target: 'jira-nope', against: 'proj-app', cwd, deps: { fetchIssues: async () => [] } }),
    /unknown tracker target "jira-nope"/,
  );
});
