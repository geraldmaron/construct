/**
 * tests/embed-capability-loader.test.mjs — embed-capability manifest loader,
 * enable/disable lifecycle, status, dry-run, and daemon job registration
 * (ADR-0061, LMCP-P2).
 */

import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import {
  EMBED_MANIFEST_TYPE,
  loadEmbedCapabilities,
  validateEmbedBlock,
  validateEmbedManifest,
  writeProjectEmbedManifest,
  readProjectEmbedManifest,
  embedProjectDir,
} from '../lib/embed/capability-loader.mjs';
import {
  enableCapability,
  disableCapability,
  listCapabilities,
  capabilityStatus,
  resolveCapabilityChain,
  enabledCapabilityIds,
  readCapabilityTick,
  writeCapabilityTick,
} from '../lib/embed/capability-lifecycle.mjs';
import { resolveRuntime, SKIP_REASON_NO_RUNTIME } from '../lib/embed/capability-runtime.mjs';
import { registerEmbedCapabilityJobs, runCapabilityTick, parseCadenceMs } from '../lib/embed/capability-jobs.mjs';
import { Scheduler } from '../lib/embed/scheduler.mjs';

let tmpDir;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cx-embed-cap-'));
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

function validManifest(id = 'operations') {
  return {
    id,
    type: EMBED_MANIFEST_TYPE,
    version: '1.0.0',
    defaultApprovalMode: 'proposal-only',
    embed: {
      specialist: 'cx-operations',
      providerBindings: ['github', 'jira'],
      framework: 'cx-ops-triage',
      outputContract: 'proposal.v1',
      proposalAuthority: 'propose-only',
      cadence: { every: 'PT15M' },
      runtime: 'auto',
    },
  };
}

// ─── validateEmbedBlock ──────────────────────────────────────────────────────

describe('validateEmbedBlock', () => {
  it('accepts a fully-formed embed manifest', () => {
    const result = validateEmbedBlock(validManifest());
    assert.equal(result.valid, true);
  });

  it('rejects a manifest with type !== "embed"', () => {
    const manifest = { ...validManifest(), type: 'linear' };
    const result = validateEmbedBlock(manifest);
    assert.equal(result.valid, false);
    assert.match(result.errors[0], /^type: must be "embed"/);
  });

  it('rejects a missing embed block', () => {
    const { embed, ...rest } = validManifest();
    const result = validateEmbedBlock(rest);
    assert.equal(result.valid, false);
    assert.match(result.errors[0], /^embed: must be an object/);
  });

  it('rejects a missing required embed field with a JSON-schema-style path', () => {
    const manifest = validManifest();
    delete manifest.embed.runtime;
    const result = validateEmbedBlock(manifest, { filePath: '/tmp/x.manifest.json' });
    assert.equal(result.valid, false);
    assert.ok(result.errors.some((e) => e === '/tmp/x.manifest.json: embed.runtime: missing required field'));
  });

  it('rejects an unknown runtime value', () => {
    const manifest = validManifest();
    manifest.embed.runtime = 'quantum';
    const result = validateEmbedBlock(manifest);
    assert.equal(result.valid, false);
    assert.match(result.errors[0], /^embed\.runtime: must be one of/);
  });

  it('rejects an unknown proposalAuthority value', () => {
    const manifest = validManifest();
    manifest.embed.proposalAuthority = 'full-write';
    const result = validateEmbedBlock(manifest);
    assert.equal(result.valid, false);
    assert.match(result.errors[0], /^embed\.proposalAuthority: must be one of/);
  });

  it('rejects providerBindings that is not an array', () => {
    const manifest = validManifest();
    manifest.embed.providerBindings = 'github';
    const result = validateEmbedBlock(manifest);
    assert.equal(result.valid, false);
    assert.match(result.errors[0], /^embed\.providerBindings: must be an array/);
  });

  it('rejects an empty providerBindings array', () => {
    const manifest = validManifest();
    manifest.embed.providerBindings = [];
    const result = validateEmbedBlock(manifest);
    assert.equal(result.valid, false);
    assert.match(result.errors[0], /^embed\.providerBindings: must declare at least one/);
  });

  it('rejects a non-string entry in providerBindings with an indexed path', () => {
    const manifest = validManifest();
    manifest.embed.providerBindings = ['github', 42];
    const result = validateEmbedBlock(manifest);
    assert.equal(result.valid, false);
    assert.ok(result.errors.some((e) => e.startsWith('embed.providerBindings[1]:')));
  });

  it('rejects an unresolvable specialist id against the known set', () => {
    const manifest = validManifest();
    manifest.embed.specialist = 'cx-does-not-exist';
    const result = validateEmbedBlock(manifest, { knownSpecialists: ['cx-operations', 'cx-architect'] });
    assert.equal(result.valid, false);
    assert.match(result.errors[0], /^embed\.specialist: unresolvable specialist id/);
  });

  it('accepts a resolvable specialist id against the known set', () => {
    const manifest = validManifest();
    const result = validateEmbedBlock(manifest, { knownSpecialists: ['cx-operations', 'cx-architect'] });
    assert.equal(result.valid, true);
  });

  it('rejects an unknown top-level filter key', () => {
    const manifest = validManifest();
    manifest.embed.filter = { bogusKey: true };
    const result = validateEmbedBlock(manifest);
    assert.equal(result.valid, false);
    assert.match(result.errors[0], /^embed\.filter\.bogusKey: unknown filter key/);
  });

  it('rejects an unknown scope key inside the filter block', () => {
    const manifest = validManifest();
    manifest.embed.filter = { scope: { bogusScope: ['x'] } };
    const result = validateEmbedBlock(manifest);
    assert.equal(result.valid, false);
    assert.match(result.errors[0], /^embed\.filter\.scope\.bogusScope: unknown scope key/);
  });

  it('rejects a filter valid in shape but illegal for a bound provider kind', () => {
    // "channels" scope is only legal for slack, not github/jira.
    const manifest = validManifest();
    manifest.embed.providerBindings = ['github'];
    manifest.embed.filter = { scope: { channels: ['C123'] } };
    const result = validateEmbedBlock(manifest);
    assert.equal(result.valid, false);
    assert.ok(result.errors.some((e) => e.includes("not supported by this provider kind") || e.includes('invalid for bound provider')));
  });

  it('accepts a valid ADR-0060 filter block scoped correctly for its provider', () => {
    const manifest = validManifest();
    manifest.embed.providerBindings = ['jira'];
    manifest.embed.filter = { scope: { projects: ['PLATFORM'] }, predicates: { statusCategory: ['in-progress'] } };
    const result = validateEmbedBlock(manifest);
    assert.equal(result.valid, true);
  });
});

// ─── validateEmbedManifest (base workflow shape + embed block) ──────────────

describe('validateEmbedManifest', () => {
  it('rejects a manifest missing base workflow-manifest required fields', () => {
    const manifest = validManifest();
    delete manifest.version;
    const result = validateEmbedManifest(manifest);
    assert.equal(result.valid, false);
    assert.ok(result.errors.some((e) => e.includes('missing required field: version')));
  });

  it('accepts a complete manifest', () => {
    const result = validateEmbedManifest(validManifest());
    assert.equal(result.valid, true);
  });
});

// ─── loadEmbedCapabilities (D1 tiering) ─────────────────────────────────────

describe('loadEmbedCapabilities', () => {
  it('discovers a valid manifest from the project tier (.cx/embed/)', () => {
    const dir = embedProjectDir(tmpDir);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'operations.manifest.json'), JSON.stringify(validManifest()));

    const { capabilities, errors } = loadEmbedCapabilities({ rootDir: tmpDir, packRoots: [], knownSpecialists: [] });
    assert.equal(errors.length, 0);
    assert.equal(capabilities.length, 1);
    assert.equal(capabilities[0].id, 'operations');
  });

  it('excludes non-embed workflow manifests found in the same directory', () => {
    const dir = embedProjectDir(tmpDir);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'linear.manifest.json'), JSON.stringify({
      id: 'linear-flow', type: 'linear', version: '1.0.0', defaultApprovalMode: 'proposal-only',
    }));

    const { capabilities, errors } = loadEmbedCapabilities({ rootDir: tmpDir, packRoots: [], knownSpecialists: [] });
    assert.equal(errors.length, 0);
    assert.ok(!capabilities.some((c) => c.id === 'linear-flow'), 'non-embed manifest is excluded');
  });

  it('collects a JSON-schema-path error for an invalid manifest instead of throwing', () => {
    const dir = embedProjectDir(tmpDir);
    fs.mkdirSync(dir, { recursive: true });
    const bad = validManifest('broken');
    bad.embed.runtime = 'bogus';
    fs.writeFileSync(path.join(dir, 'broken.manifest.json'), JSON.stringify(bad));

    const { capabilities, errors } = loadEmbedCapabilities({ rootDir: tmpDir, packRoots: [], knownSpecialists: [] });
    assert.ok(!capabilities.some((c) => c.id === 'broken'), 'the invalid manifest is not accepted');
    assert.ok(errors.some((e) => e.includes('embed.runtime: must be one of')));
  });

  it('project tier overrides a same-id pack-tier manifest', () => {
    const packDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cx-embed-pack-'));
    fs.mkdirSync(path.join(packDir, 'workflows'), { recursive: true });
    const packManifest = validManifest('operations');
    packManifest.embed.runtime = 'none';
    fs.writeFileSync(path.join(packDir, 'workflows', 'operations.manifest.json'), JSON.stringify(packManifest));

    const dir = embedProjectDir(tmpDir);
    fs.mkdirSync(dir, { recursive: true });
    const projectManifest = validManifest('operations');
    projectManifest.embed.runtime = 'in-process';
    fs.writeFileSync(path.join(dir, 'operations.manifest.json'), JSON.stringify(projectManifest));

    const { capabilities } = loadEmbedCapabilities({ rootDir: tmpDir, packRoots: [packDir], knownSpecialists: [] });
    assert.equal(capabilities.length, 1);
    assert.equal(capabilities[0].embed.runtime, 'in-process');

    fs.rmSync(packDir, { recursive: true, force: true });
  });
});

// ─── enable / disable round trip ────────────────────────────────────────────

describe('enableCapability / disableCapability', () => {
  it('fails enable with a JSON-schema path for an invalid manifest', () => {
    const dir = embedProjectDir(tmpDir);
    // No pack default exists; supply an invalid override directly.
    const result = enableCapability('broken', {
      rootDir: tmpDir,
      overrides: { id: 'broken', type: EMBED_MANIFEST_TYPE, version: '1.0.0', defaultApprovalMode: 'proposal-only', embed: { specialist: 'x', providerBindings: [], framework: 'f', outputContract: 'o', proposalAuthority: 'propose-only', runtime: 'bogus' } },
    });
    assert.equal(result.ok, false);
    assert.ok(result.errors.some((e) => e.includes('embed.runtime: must be one of')));
    assert.equal(fs.existsSync(path.join(dir, 'broken.manifest.json')), false, 'invalid manifest must never be written');
  });

  it('enable/disable round-trips through .cx/embed/<id>.manifest.json', () => {
    const overrides = validManifest('operations');
    const enableResult = enableCapability('operations', { rootDir: tmpDir, overrides, packRoots: [], knownSpecialists: [] });
    assert.equal(enableResult.ok, true);
    assert.ok(fs.existsSync(enableResult.filePath));

    let stored = readProjectEmbedManifest('operations', tmpDir);
    assert.equal(stored.manifest.embed.enabled, true);
    assert.deepEqual(enabledCapabilityIds({ rootDir: tmpDir, packRoots: [], knownSpecialists: [] }), ['operations']);

    const disableResult = disableCapability('operations', { rootDir: tmpDir });
    assert.equal(disableResult.ok, true);
    assert.equal(disableResult.wasEnabled, true);

    stored = readProjectEmbedManifest('operations', tmpDir);
    assert.equal(stored.manifest.embed.enabled, false);
    assert.deepEqual(enabledCapabilityIds({ rootDir: tmpDir, packRoots: [], knownSpecialists: [] }), []);
  });

  it('disable is idempotent for a never-enabled capability', () => {
    const result = disableCapability('never-enabled', { rootDir: tmpDir });
    assert.equal(result.ok, true);
    assert.equal(result.wasEnabled, false);
  });

  it('re-enabling preserves project overrides made while disabled', () => {
    const overrides = validManifest('operations');
    enableCapability('operations', { rootDir: tmpDir, overrides, packRoots: [], knownSpecialists: [] });
    disableCapability('operations', { rootDir: tmpDir });

    // Re-enable with a cadence override; enabling must not lose it or reset unrelated fields.
    const reEnableOverrides = { ...validManifest('operations'), embed: { ...validManifest('operations').embed, cadence: { every: 'PT30M' } } };
    const result = enableCapability('operations', { rootDir: tmpDir, overrides: reEnableOverrides, packRoots: [], knownSpecialists: [] });
    assert.equal(result.ok, true);
    assert.equal(result.manifest.embed.cadence.every, 'PT30M');
    assert.equal(result.manifest.embed.enabled, true);
  });
});

// ─── listCapabilities ────────────────────────────────────────────────────────

describe('listCapabilities', () => {
  it('reports enabled vs available state per discovered capability', () => {
    enableCapability('operations', { rootDir: tmpDir, overrides: validManifest('operations'), packRoots: [], knownSpecialists: [] });

    // A second capability that is discoverable (pack tier) but never enabled.
    const packDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cx-embed-pack2-'));
    fs.mkdirSync(path.join(packDir, 'workflows'), { recursive: true });
    fs.writeFileSync(path.join(packDir, 'workflows', 'triage.manifest.json'), JSON.stringify(validManifest('triage')));

    const { capabilities } = listCapabilities({ rootDir: tmpDir, packRoots: [packDir], knownSpecialists: [] });

    const ops = capabilities.find((c) => c.id === 'operations');
    assert.ok(ops, 'enabled project-tier capability is listed');
    assert.equal(ops.enabled, true);

    const triage = capabilities.find((c) => c.id === 'triage');
    assert.ok(triage, 'pack-tier-only capability is listed as available');
    assert.equal(triage.enabled, false);

    fs.rmSync(packDir, { recursive: true, force: true });
  });
});

// ─── resolveRuntime ──────────────────────────────────────────────────────────

describe('resolveRuntime', () => {
  it('resolves "in-process" directly regardless of env', async () => {
    const result = await resolveRuntime('in-process', {});
    assert.deepEqual(result, { resolved: 'in-process' });
  });

  it('resolves "none" to a visible skip with reason', async () => {
    const result = await resolveRuntime('none', {});
    assert.equal(result.resolved, 'none');
    assert.equal(result.reason, SKIP_REASON_NO_RUNTIME);
  });

  it('resolves "external" to "none" with a reason when no external host is configured', async () => {
    const result = await resolveRuntime('external', {});
    assert.equal(result.resolved, 'none');
    assert.equal(result.reason, SKIP_REASON_NO_RUNTIME);
  });

  it('resolves "external" to "external" when a host is configured', async () => {
    const result = await resolveRuntime('external', { CONSTRUCT_EXTERNAL_AGENT_HOST: 'http://localhost:9999' });
    assert.equal(result.resolved, 'external');
  });

  it('resolves "auto" to "none" with a reason when nothing is configured', async () => {
    const result = await resolveRuntime('auto', {});
    assert.equal(result.resolved, 'none');
    assert.equal(result.reason, SKIP_REASON_NO_RUNTIME);
  });

  it('resolves "auto" to "external" when only an external host is configured', async () => {
    const result = await resolveRuntime('auto', { CONSTRUCT_EXTERNAL_AGENT_HOST: 'http://localhost:9999' });
    assert.equal(result.resolved, 'external');
  });
});

// ─── dry-run: resolves the chain without side effects ───────────────────────

describe('resolveCapabilityChain (dry-run)', () => {
  it('resolves the full binding chain without writing a tick record', async () => {
    enableCapability('operations', { rootDir: tmpDir, overrides: validManifest('operations'), packRoots: [], knownSpecialists: [] });

    const before = readCapabilityTick('operations', tmpDir);
    assert.equal(before, null);

    const result = await resolveCapabilityChain('operations', { rootDir: tmpDir, env: {}, packRoots: [], knownSpecialists: [] });
    assert.equal(result.ok, true);
    assert.equal(result.chain.specialist, 'cx-operations');
    assert.deepEqual(result.chain.providerBindings, ['github', 'jira']);
    assert.equal(result.chain.framework, 'cx-ops-triage');
    assert.equal(result.chain.proposalAuthority, 'propose-only');
    assert.equal(result.chain.runtime.declared, 'auto');
    assert.equal(result.chain.runtime.resolved, 'none');
    assert.equal(result.chain.runtime.reason, SKIP_REASON_NO_RUNTIME);

    const after = readCapabilityTick('operations', tmpDir);
    assert.equal(after, null, 'dry-run must not perform side effects');
  });

  it('reports ok:false for an unknown capability id', async () => {
    const result = await resolveCapabilityChain('does-not-exist', { rootDir: tmpDir, env: {}, packRoots: [], knownSpecialists: [] });
    assert.equal(result.ok, false);
    assert.ok(result.errors.some((e) => e.includes('not found')));
  });
});

// ─── capabilityStatus ────────────────────────────────────────────────────────

describe('capabilityStatus', () => {
  it('shows bindings/filter/runtime/last-tick per specialist', async () => {
    const overrides = validManifest('operations');
    overrides.embed.filter = { scope: { projects: ['PLATFORM'] } };
    overrides.embed.providerBindings = ['jira'];
    enableCapability('operations', { rootDir: tmpDir, overrides, packRoots: [], knownSpecialists: [] });

    writeCapabilityTick('operations', { status: 'skipped-with-reason', reason: 'no-runtime', runtime: 'none', tickedAt: '2026-07-03T00:00:00.000Z' }, tmpDir);

    const result = await capabilityStatus('operations', { rootDir: tmpDir, env: {}, packRoots: [], knownSpecialists: [] });
    assert.equal(result.ok, true);
    assert.equal(result.enabled, true);
    assert.deepEqual(result.chain.filter, { scope: { projects: ['PLATFORM'] } });
    assert.deepEqual(result.chain.providerBindings, ['jira']);
    assert.equal(result.lastTick.status, 'skipped-with-reason');
    assert.equal(result.lastTick.reason, 'no-runtime');
  });

  it('reflects disabled state after disable', async () => {
    enableCapability('operations', { rootDir: tmpDir, overrides: validManifest('operations'), packRoots: [], knownSpecialists: [] });
    disableCapability('operations', { rootDir: tmpDir });
    const result = await capabilityStatus('operations', { rootDir: tmpDir, env: {}, packRoots: [], knownSpecialists: [] });
    assert.equal(result.ok, true);
    assert.equal(result.enabled, false);
  });
});

// ─── daemon job registration ─────────────────────────────────────────────────

describe('registerEmbedCapabilityJobs', () => {
  it('registers exactly one job per enabled capability, none for disabled/available-only ones', () => {
    enableCapability('operations', { rootDir: tmpDir, overrides: validManifest('operations'), packRoots: [], knownSpecialists: [] });

    // A second capability discoverable at the pack tier but never enabled —
    // a project-tier file's mere presence means "has an override", so an
    // available-but-not-enabled capability must live outside .cx/embed/.
    const packDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cx-embed-pack3-'));
    fs.mkdirSync(path.join(packDir, 'workflows'), { recursive: true });
    fs.writeFileSync(path.join(packDir, 'workflows', 'triage.manifest.json'), JSON.stringify(validManifest('triage')));

    const scheduler = new Scheduler();
    const registered = registerEmbedCapabilityJobs(scheduler, { rootDir: tmpDir, env: {}, packRoots: [packDir], knownSpecialists: [] });

    assert.deepEqual(registered, ['operations']);
    const taskLabels = scheduler.status().map((t) => t.label);
    assert.deepEqual(taskLabels, ['embed-capability:operations']);

    fs.rmSync(packDir, { recursive: true, force: true });
  });

  it('registers zero jobs when nothing is enabled', () => {
    const scheduler = new Scheduler();
    const registered = registerEmbedCapabilityJobs(scheduler, { rootDir: tmpDir, env: {}, packRoots: [], knownSpecialists: [] });
    assert.deepEqual(registered, []);
    assert.deepEqual(scheduler.status(), []);
  });

  it('the stub tick body records skipped-with-reason(no-runtime) and never fabricates output', async () => {
    const overrides = validManifest('operations');
    overrides.embed.runtime = 'none';
    enableCapability('operations', { rootDir: tmpDir, overrides, packRoots: [], knownSpecialists: [] });

    const { capabilities } = loadEmbedCapabilities({ rootDir: tmpDir, packRoots: [], knownSpecialists: [] });
    const manifest = capabilities.find((c) => c.id === 'operations');

    const tick = await runCapabilityTick(manifest, { rootDir: tmpDir, env: {} });
    assert.equal(tick.status, 'skipped-with-reason');
    assert.equal(tick.reason, SKIP_REASON_NO_RUNTIME);
    assert.ok(!('output' in tick), 'stub must never carry fabricated output');

    const persisted = readCapabilityTick('operations', tmpDir);
    assert.deepEqual(persisted, tick);
  });
});

// ─── parseCadenceMs ──────────────────────────────────────────────────────────

describe('parseCadenceMs', () => {
  it('parses PT15M to milliseconds', () => {
    assert.equal(parseCadenceMs('PT15M'), 15 * 60_000);
  });

  it('parses P1D to milliseconds', () => {
    assert.equal(parseCadenceMs('P1D'), 24 * 60 * 60_000);
  });

  it('returns null for an unparsable value', () => {
    assert.equal(parseCadenceMs('every 15 minutes'), null);
    assert.equal(parseCadenceMs(null), null);
  });
});
