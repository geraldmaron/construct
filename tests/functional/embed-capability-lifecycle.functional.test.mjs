/**
 * tests/functional/embed-capability-lifecycle.functional.test.mjs
 *
 * Drives `construct embed list|enable|disable|status|dry-run` against the
 * real binary in an isolated tmpdir cwd, proving the ADR-0061 (LMCP-P2)
 * lifecycle end to end: an invalid Procedure fails enable with a JSON-schema
 * path and writes nothing; enable/disable round-trips through the durable
 * `.construct/procedures/<id>.manifest.json` project-tier file; status and dry-run
 * surface the resolved Worker Profile binding chain; the EmbedDaemon registers
 * exactly the enabled set of capabilities as scheduled jobs.
 */

import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import test, { after } from 'node:test';
import { rmTmpDir } from '../helpers/cleanup.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const BIN = path.resolve(__dirname, '..', '..', 'bin', 'construct');

const tmpDirs = [];
function freshCwd() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cx-embed-cap-fn-'));
  fs.mkdirSync(path.join(dir, '.construct'), { recursive: true });
  fs.writeFileSync(path.join(dir, '.construct', 'context.md'), '# test project\n');
  tmpDirs.push(dir);
  return dir;
}
after(() => {
  for (const dir of tmpDirs) {
    try { rmTmpDir(dir); } catch { /* best-effort cleanup */ }
  }
});

function validManifest(id = 'operations') {
  return {
    id,
    type: 'embed',
    version: '1.0.0',
    workerProfiles: [],
    approvalMode: 'proposal-only',
    modelTier: 'standard',
    state: 'active',
    embed: {
      workerProfileId: 'operations',
      providerBindings: ['atlassian-jira'],
      framework: 'operations-dependency-sequencing',
      outputContract: 'operations-tpm-briefing',
      proposalAuthority: 'propose-only',
      cadence: { every: 'PT15M' },
      runtime: 'auto',
    },
  };
}

function writeProjectManifest(cwd, id, manifest) {
  const dir = path.join(cwd, '.construct', 'procedures');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, `${id}.manifest.json`), JSON.stringify(manifest));
}

function runCli(args, cwd) {
  return spawnSync('node', [BIN, 'embed', ...args], { cwd, encoding: 'utf8', timeout: 30_000 });
}

test('embed list --json reports all shipped builtin capabilities in a project with no project-tier manifests', () => {
  const cwd = freshCwd();
  const res = runCli(['list', '--json'], cwd);
  assert.equal(res.status, 0, `exit 0 — stderr: ${res.stderr}`);
  const out = JSON.parse(res.stdout);
  // The core pack ships four builtin embed capabilities (the operations TPM
  // preset, operations-triage, pm-feedback, and pm-repos), each
  // available-but-not-enabled in a project that has enabled none. Sort first
  // — discovery order is not a contract.
  assert.deepEqual(out.capabilities.map((c) => c.id).sort(), ['operations', 'operations-triage', 'pm-feedback', 'pm-repos']);
  for (const cap of out.capabilities) {
    assert.equal(cap.enabled, false);
  }
  assert.deepEqual(out.errors, []);
});

test('embed enable fails closed on an invalid manifest with a JSON-schema path, and writes nothing', () => {
  const cwd = freshCwd();
  const bad = validManifest('broken');
  bad.embed.runtime = 'bogus-runtime';
  writeProjectManifest(cwd, 'broken', bad);

  const res = runCli(['enable', 'broken'], cwd);
  assert.notEqual(res.status, 0, 'enable must fail for an invalid manifest');
  assert.match(res.stderr, /embed\.runtime: must be one of/);

  // The pre-existing project-tier file is untouched (still the invalid one,
  // not overwritten with an "enabled: true" stamp) — enable failed closed.
  const onDisk = JSON.parse(fs.readFileSync(path.join(cwd, '.construct', 'procedures', 'broken.manifest.json'), 'utf8'));
  assert.equal(onDisk.embed.enabled, undefined, 'invalid manifest must not be stamped enabled');
});

test('enable/disable round-trips through .construct/procedures/<id>.manifest.json', () => {
  const cwd = freshCwd();
  writeProjectManifest(cwd, 'operations', validManifest('operations'));

  const enableRes = runCli(['enable', 'operations'], cwd);
  assert.equal(enableRes.status, 0, `enable exit 0 — stderr: ${enableRes.stderr}`);

  const manifestPath = path.join(cwd, '.construct', 'procedures', 'operations.manifest.json');
  assert.ok(fs.existsSync(manifestPath), 'project-tier manifest exists after enable');
  let onDisk = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  assert.equal(onDisk.embed.enabled, true);

  const listRes = runCli(['list', '--json'], cwd);
  const listed = JSON.parse(listRes.stdout);
  // The operations-triage builtin is also discoverable here — look up the
  // capability this test enabled by id rather than assuming array position.
  const ops = listed.capabilities.find((c) => c.id === 'operations');
  assert.ok(ops, 'operations capability is listed');
  assert.equal(ops.enabled, true);

  const disableRes = runCli(['disable', 'operations'], cwd);
  assert.equal(disableRes.status, 0, `disable exit 0 — stderr: ${disableRes.stderr}`);

  onDisk = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  assert.equal(onDisk.embed.enabled, false);

  const listAfterDisable = JSON.parse(runCli(['list', '--json'], cwd).stdout);
  const opsAfterDisable = listAfterDisable.capabilities.find((c) => c.id === 'operations');
  assert.equal(opsAfterDisable.enabled, false);
});

test('embed status <id> --json surfaces bindings, filter, runtime, and last-tick', () => {
  const cwd = freshCwd();
  const manifest = validManifest('operations');
  manifest.embed.filter = { scope: { projects: ['PLATFORM'] } };
  manifest.embed.providerBindings = ['atlassian-jira'];
  writeProjectManifest(cwd, 'operations', manifest);
  runCli(['enable', 'operations'], cwd);

  const res = runCli(['status', 'operations', '--json'], cwd);
  assert.equal(res.status, 0, `exit 0 — stderr: ${res.stderr}`);
  const status = JSON.parse(res.stdout);
  assert.equal(status.ok, true);
  assert.equal(status.enabled, true);
  assert.deepEqual(status.chain.providerBindings, ['atlassian-jira']);
  assert.deepEqual(status.chain.filter, { scope: { projects: ['PLATFORM'] } });
  assert.equal(status.chain.framework, 'operations-dependency-sequencing');
  assert.equal(status.chain.proposalAuthority, 'propose-only');
  assert.ok(['in-process', 'external', 'none'].includes(status.chain.runtime.resolved));
  assert.equal(status.lastTick, null, 'no daemon has ticked yet in this project');
});

test('embed dry-run <id> --json resolves the full chain without writing a last-tick record or the daemon state file', () => {
  const cwd = freshCwd();
  writeProjectManifest(cwd, 'operations', validManifest('operations'));
  runCli(['enable', 'operations'], cwd);
  const manifestPath = path.join(cwd, '.construct', 'procedures', 'operations.manifest.json');
  const manifestBefore = fs.readFileSync(manifestPath, 'utf8');

  const res = runCli(['dry-run', 'operations', '--json'], cwd);
  assert.equal(res.status, 0, `exit 0 — stderr: ${res.stderr}`);
  const result = JSON.parse(res.stdout);
  assert.equal(result.ok, true);
  assert.equal(result.chain.workerProfileId, 'operations');
  assert.deepEqual(result.chain.providerBindings, ['atlassian-jira']);
  assert.equal(result.chain.framework, 'operations-dependency-sequencing');
  assert.equal(result.chain.outputContract, 'operations-tpm-briefing');
  assert.equal(result.chain.proposalAuthority, 'propose-only');
  assert.ok(result.chain.runtime.declared === 'auto');

  const tickPath = path.join(cwd, '.construct', 'runtime', 'embed-capabilities', 'operations.json');
  assert.equal(fs.existsSync(tickPath), false, 'dry-run must not write a last-tick record');
  assert.equal(fs.readFileSync(manifestPath, 'utf8'), manifestBefore, 'dry-run must not modify the enabled Procedure');
  assert.equal(
    fs.existsSync(path.join(cwd, '.construct', 'runtime', 'embed-daemon.json')),
    false,
    'dry-run must not write daemon state',
  );
});

test('EmbedDaemon registers exactly the enabled set of capabilities as scheduled jobs', async () => {
  const cwd = freshCwd();
  writeProjectManifest(cwd, 'operations', validManifest('operations'));
  runCli(['enable', 'operations'], cwd);
  // A second capability present on disk but never enabled.
  writeProjectManifest(cwd, 'triage', validManifest('triage'));

  const { registerEmbedCapabilityJobs } = await import('../../lib/embed/capability-jobs.mjs');
  const { Scheduler } = await import('../../lib/embed/scheduler.mjs');

  const scheduler = new Scheduler();
  const registered = registerEmbedCapabilityJobs(scheduler, { rootDir: cwd, env: {} });

  assert.deepEqual(registered, ['operations']);
  assert.deepEqual(scheduler.status().map((t) => t.label), ['embed-capability:operations']);
});
