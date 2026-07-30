/**
 * tests/ingest/sidecar-providers.test.mjs — governed ingestion providers.
 *
 * Covers:
 *   1. docling/whisper manifests validate as `ingestion-provider` kind with a
 *      declared installProbe, healthCheck, and degradation chain.
 *   2. probeInstall/probeHealth report accurately in both present and absent
 *      states, driven entirely by FAKE probes (injected fs/exec) — no real uv
 *      venv or whisper-cli binary required.
 *   3. checkSidecarProvidersForDoctor (lib/doctor/sidecar-providers.mjs) surfaces
 *      those probes as doctor-shaped findings in both states.
 *   4. extractWithChain (lib/ingest/degraded-extract.mjs) follows the declared
 *      fallback (docling -> node-native -> refuse) and marks the result
 *      `degraded` when docling is absent, per the acceptance criterion.
 *
 * Bead:.
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import { validateManifest } from '../../lib/extensions/validate.mjs';
import { loadManifestsFromDir, resolveManifestDirs } from '../../lib/extensions/loader.mjs';
import { probeInstall, probeHealth, degradationChain, testProvider } from '../../lib/ingest/sidecar-providers.mjs';
import { extractWithChain } from '../../lib/ingest/degraded-extract.mjs';
import { checkSidecarProviderForDoctor, checkSidecarProvidersForDoctor } from '../../lib/doctor/sidecar-providers.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const MANIFESTS_DIR = join(__dirname, '../../lib/extensions/manifests');

// ---------------------------------------------------------------------------
// Manifest shape
// ---------------------------------------------------------------------------

test('docling and whisper manifests validate as ingestion-provider with install/health/degradation', () => {
  const { manifests, errors } = loadManifestsFromDir(MANIFESTS_DIR, { strict: true });
  assert.deepEqual(errors, []);

  for (const id of ['docling', 'whisper']) {
    const manifest = manifests.find((m) => m.id === id);
    assert.ok(manifest, `${id} manifest should load`);
    assert.equal(manifest.kind, 'ingestion-provider');
    assert.equal(validateManifest(manifest, { strict: true }).valid, true);
    assert.ok(manifest.installProbe, `${id} declares an installProbe`);
    assert.ok(manifest.healthCheck, `${id} declares a healthCheck`);
    assert.ok(Array.isArray(manifest.degradation?.chain), `${id} declares a degradation chain`);
    assert.equal(manifest.degradation.chain.at(-1).id, 'refuse', `${id} chain terminates in refuse`);
  }
});

test('uv is declared as an install dependency of docling only', () => {
  const { manifests } = loadManifestsFromDir(MANIFESTS_DIR);
  const docling = manifests.find((m) => m.id === 'docling');
  const whisper = manifests.find((m) => m.id === 'whisper');
  assert.ok(docling.installDependencies.includes('uv'));
  assert.equal(whisper.installDependencies.includes('uv'), false);
});

// ---------------------------------------------------------------------------
// Install/health probes — FAKE probes, both present and absent states
// ---------------------------------------------------------------------------

function fakeFs({ files = {} } = {}) {
  return {
    existsImpl: (p) => Object.prototype.hasOwnProperty.call(files, p),
    readFileImpl: (p) => {
      if (!(p in files)) throw new Error(`ENOENT: ${p}`);
      return files[p];
    },
  };
}

test('probeInstall(docling): absent state reports installed:false with a reason, no throw', () => {
  const { existsImpl, readFileImpl } = fakeFs({ files: {} });
  const result = probeInstall('docling', { runtimeDir: '/fake/docling', existsImpl, readFileImpl });
  assert.equal(result.ok, true);
  assert.equal(result.installed, false);
  assert.match(result.reason, /no install marker/);
});

test('probeInstall(docling): present state reports installed:true with the probed version (not fabricated)', () => {
  const marker = JSON.stringify({ doclingVersion: '2.45.0' });
  const { existsImpl, readFileImpl } = fakeFs({
    files: {
      '/fake/docling/.install-marker.json': marker,
      '/fake/docling/.venv/bin/python': '',
    },
  });
  const result = probeInstall('docling', { runtimeDir: '/fake/docling', existsImpl, readFileImpl });
  assert.equal(result.installed, true);
  assert.equal(result.version, '2.45.0');
});

test('probeInstall(docling): stale install (marker present, venv missing) reports installed:false', () => {
  const marker = JSON.stringify({ doclingVersion: '2.45.0' });
  const { existsImpl, readFileImpl } = fakeFs({
    files: { '/fake/docling/.install-marker.json': marker },
  });
  const result = probeInstall('docling', { runtimeDir: '/fake/docling', existsImpl, readFileImpl });
  assert.equal(result.installed, false);
  assert.match(result.reason, /stale install/);
});

test('probeInstall(whisper): absent state (no PATH hit, no cached binary) reports installed:false', () => {
  const execImpl = () => ({ status: 1, stdout: '' });
  const existsImpl = () => false;
  const result = probeInstall('whisper', { runtimeDir: '/fake/whisper', execImpl, existsImpl });
  assert.equal(result.installed, false);
  assert.match(result.reason, /not found on PATH/);
});

test('probeInstall(whisper): present state via PATH lookup reports installed:true', () => {
  const execImpl = (cmd, args) => {
    if (args[0] === 'whisper-cli') return { status: 0, stdout: '/usr/local/bin/whisper-cli\n' };
    return { status: 1, stdout: '' };
  };
  const result = probeInstall('whisper', { runtimeDir: '/fake/whisper', execImpl });
  assert.equal(result.installed, true);
  assert.equal(result.binary, '/usr/local/bin/whisper-cli');
  assert.equal(result.source, 'system');
});

test('probeInstall(whisper): present state via cached binary (not on PATH) reports installed:true', () => {
  const execImpl = () => ({ status: 1, stdout: '' });
  const existsImpl = (p) => p === '/fake/whisper/bin/whisper-cli';
  const result = probeInstall('whisper', { runtimeDir: '/fake/whisper', execImpl, existsImpl });
  assert.equal(result.installed, true);
  assert.equal(result.source, 'cached');
});

test('probeHealth: absent provider short-circuits to unhealthy without spawning the health subprocess', () => {
  let spawned = false;
  const execImpl = (...args) => { spawned = true; return { status: 1, stdout: '', stderr: '' }; };
  const existsImpl = () => false;
  const result = probeHealth('docling', { runtimeDir: '/fake/docling', existsImpl, execImpl });
  assert.equal(result.ok, true);
  assert.equal(result.healthy, false);
  assert.match(result.detail, /not installed/);
  assert.equal(spawned, false, 'health subprocess must not run when install probe reports absent');
});

test('probeHealth: present + passing health check reports healthy:true with the probed version string', () => {
  const marker = JSON.stringify({ doclingVersion: '2.45.0' });
  const { existsImpl, readFileImpl } = fakeFs({
    files: {
      '/fake/docling/.install-marker.json': marker,
      '/fake/docling/.venv/bin/python': '',
    },
  });
  const execImpl = (cmd, args) => {
    assert.equal(cmd, '/fake/docling/.venv/bin/docling');
    assert.deepEqual(args, ['--version']);
    return { status: 0, stdout: 'docling 2.45.0\n' };
  };
  const result = probeHealth('docling', { runtimeDir: '/fake/docling', existsImpl, readFileImpl, execImpl });
  assert.equal(result.healthy, true);
  assert.match(result.detail, /2\.45\.0/);
});

test('probeHealth: present but failing health check (non-zero exit) reports healthy:false with detail', () => {
  const marker = JSON.stringify({ doclingVersion: '2.45.0' });
  const { existsImpl, readFileImpl } = fakeFs({
    files: {
      '/fake/docling/.install-marker.json': marker,
      '/fake/docling/.venv/bin/python': '',
    },
  });
  const execImpl = () => ({ status: 1, stdout: '', stderr: 'ModuleNotFoundError: docling' });
  const result = probeHealth('docling', { runtimeDir: '/fake/docling', existsImpl, readFileImpl, execImpl });
  assert.equal(result.healthy, false);
  assert.match(result.detail, /exited 1/);
  assert.match(result.detail, /ModuleNotFoundError/);
});

test('testProvider: unknown id degrades loudly rather than throwing', () => {
  const result = testProvider('not-a-real-provider');
  assert.equal(result.installed, false);
  assert.equal(result.healthy, false);
  assert.match(result.detail, /unknown ingestion provider/);
});

test('testProvider(docling): absent state — no version fabricated, degradation chain surfaced', () => {
  const existsImpl = () => false;
  const result = testProvider('docling', { runtimeDir: '/fake/docling', existsImpl });
  assert.equal(result.installed, false);
  assert.equal(result.healthy, false);
  assert.equal(result.version, null);
  assert.ok(result.degradation);
  assert.equal(result.degradation.chain[0].id, 'docling');
  assert.equal(result.degradation.chain.at(-1).id, 'refuse');
});

test('degradationChain returns null for a provider with no manifest', () => {
  assert.equal(degradationChain('not-a-real-provider'), null);
});

// ---------------------------------------------------------------------------
// Doctor visibility — accurate in both present and absent states
// ---------------------------------------------------------------------------

test('doctor check: docling absent reports an optional (non-fatal) finding with an actionable label', () => {
  const existsImpl = () => false;
  const finding = checkSidecarProviderForDoctor('docling', { runtimeDir: '/fake/docling', existsImpl });
  assert.equal(finding.ok, true);
  assert.equal(finding.optional, true);
  assert.match(finding.label, /not installed/);
  assert.match(finding.label, /degrades per its declared fallback chain/);
});

test('doctor check: docling present + healthy reports ok, optional, with the probed version in the label', () => {
  const marker = JSON.stringify({ doclingVersion: '2.45.0' });
  const { existsImpl, readFileImpl } = fakeFs({
    files: {
      '/fake/docling/.install-marker.json': marker,
      '/fake/docling/.venv/bin/python': '',
    },
  });
  const execImpl = () => ({ status: 0, stdout: 'docling 2.45.0\n' });
  const finding = checkSidecarProviderForDoctor('docling', { runtimeDir: '/fake/docling', existsImpl, readFileImpl, execImpl });
  assert.equal(finding.ok, true);
  assert.match(finding.label, /2\.45\.0/);
});

test('doctor check: installed but unhealthy is a non-optional (hard) finding, distinct from absence', () => {
  const marker = JSON.stringify({ doclingVersion: '2.45.0' });
  const { existsImpl, readFileImpl } = fakeFs({
    files: {
      '/fake/docling/.install-marker.json': marker,
      '/fake/docling/.venv/bin/python': '',
    },
  });
  const execImpl = () => ({ status: 1, stdout: '', stderr: 'boom' });
  const finding = checkSidecarProviderForDoctor('docling', { runtimeDir: '/fake/docling', existsImpl, readFileImpl, execImpl });
  assert.equal(finding.ok, false);
  assert.equal(finding.optional, false);
  assert.match(finding.label, /installed but unhealthy/);
});

test('checkSidecarProvidersForDoctor: reports both docling and whisper, absent state, neither throws', () => {
  const existsImpl = () => false;
  const execImpl = () => ({ status: 1, stdout: '' });
  const findings = checkSidecarProvidersForDoctor({ runtimeDir: '/fake/nowhere', existsImpl, execImpl });
  assert.equal(findings.length, 2);
  assert.ok(findings.every((f) => f.ok === true && f.optional === true));
  assert.ok(findings.some((f) => f.label.includes('docling')));
  assert.ok(findings.some((f) => f.label.includes('whisper')));
});

// ---------------------------------------------------------------------------
// Ingest degradation: PDF without docling follows the declared fallback and
// is marked `degraded` — the acceptance criterion.
// ---------------------------------------------------------------------------

test('extractWithChain: PDF ingest without docling falls back to node-native and marks the result degraded', async () => {
  const installProbeImpl = () => ({ installed: false, reason: 'no install marker' });
  const nodeNativeResult = { text: 'unpdf text', characters: 10, extractionMethod: 'unpdf', droppedInfo: [] };

  const out = await extractWithChain('/tmp/doc.pdf', {
    extension: '.pdf',
    installProbeImpl,
    doclingExtract: async () => { throw new Error('must not be called when not installed'); },
    nodeNativeExtract: async () => nodeNativeResult,
  });

  assert.equal(out.degraded, true);
  assert.equal(out.degradationStep, 'node-native');
  assert.equal(out.extractionMethod, 'unpdf');
  assert.ok(out.droppedInfo.some((d) => d.kind === 'ingestion-provider-degraded'));
  assert.match(out.droppedInfo.find((d) => d.kind === 'ingestion-provider-degraded').reason, /docling is not installed/);
});

test('extractWithChain: docling installed but extraction throws falls back to node-native and marks degraded', async () => {
  const installProbeImpl = () => ({ installed: true, version: '2.45.0' });
  const nodeNativeResult = { text: 'unpdf text', characters: 10, extractionMethod: 'unpdf', droppedInfo: [] };

  const out = await extractWithChain('/tmp/doc.pdf', {
    extension: '.pdf',
    installProbeImpl,
    doclingExtract: async () => { throw new Error('sidecar crashed'); },
    nodeNativeExtract: async () => nodeNativeResult,
  });

  assert.equal(out.degraded, true);
  assert.equal(out.extractionMethod, 'unpdf');
  assert.match(out.droppedInfo.find((d) => d.kind === 'ingestion-provider-degraded').reason, /sidecar crashed/);
});

test('extractWithChain: docling present and healthy passes through unchanged (degraded:false, no drop)', async () => {
  const installProbeImpl = () => ({ installed: true, version: '2.45.0' });
  const doclingResult = { text: 'docling md', characters: 10, extractionMethod: 'docling', droppedInfo: [] };

  const out = await extractWithChain('/tmp/doc.pdf', {
    extension: '.pdf',
    installProbeImpl,
    doclingExtract: async () => doclingResult,
    nodeNativeExtract: async () => { throw new Error('node-native must not run when docling succeeds'); },
  });

  assert.equal(out.degraded, false);
  assert.equal(out.extractionMethod, 'docling');
  assert.equal(out.droppedInfo.length, 0);
});

test('extractWithChain: a format with no node-native backend (xlsx) refuses loudly instead of crashing silently', async () => {
  const installProbeImpl = () => ({ installed: false, reason: 'no install marker' });

  await assert.rejects(
    extractWithChain('/tmp/sheet.xlsx', {
      extension: '.xlsx',
      installProbeImpl,
      doclingExtract: async () => { throw new Error('must not be called'); },
      nodeNativeExtract: null,
    }),
    (err) => {
      assert.equal(err.code, 'INGESTION_PROVIDER_REFUSED');
      assert.match(err.message, /refusing per the docling degradation chain/);
      return true;
    },
  );
});

test('extractWithChain: node-native fallback itself failing also refuses loudly (both chain steps exhausted)', async () => {
  const installProbeImpl = () => ({ installed: false, reason: 'no install marker' });

  await assert.rejects(
    extractWithChain('/tmp/doc.pdf', {
      extension: '.pdf',
      installProbeImpl,
      doclingExtract: async () => { throw new Error('must not be called'); },
      nodeNativeExtract: async () => { throw new Error('unpdf parse error'); },
    }),
    (err) => {
      assert.equal(err.code, 'INGESTION_PROVIDER_REFUSED');
      assert.match(err.message, /node-native fallback also failed/);
      return true;
    },
  );
});
