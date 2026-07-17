/**
 * tests/providers/binary-health.test.mjs — version-identity health check for
 * `kind: 'binary'` Provider Cards (construct-tsyfe.10.3).
 *
 * Exercises lib/providers/binary-health.mjs's checkBinaryVersion against an
 * injected execImpl seam (mirroring tests/ingest/sidecar-providers.test.mjs's
 * pattern), covering: version-match, version-mismatch-warns (not fails),
 * binary-absent, and unhealthy-but-present, plus the malformed-input guards.
 */
import assert from 'node:assert/strict';
import test from 'node:test';

import { checkBinaryVersion, extractVersion } from '../../lib/providers/binary-health.mjs';

function makeCard(overrides = {}) {
  return {
    id: 'pandoc',
    kind: 'binary',
    versionPolicy: { type: 'external-pinned', expectedVersion: '3.10' },
    healthCheck: { kind: 'subprocess-version', command: 'pandoc', args: ['--version'], timeoutMs: 10000 },
    ...overrides,
  };
}

test('extractVersion pulls a dotted version number out of varied real-world output shapes', () => {
  assert.equal(extractVersion('pandoc 3.10\nFeatures: +server'), '3.10');
  assert.equal(extractVersion('dot - graphviz version 15.0.0 (20260523.1842)'), '15.0.0');
  assert.equal(extractVersion('LibreOffice 26.2.4.2 0229ac93fcf0'), '26.2.4.2');
  assert.equal(extractVersion('0.7.1'), '0.7.1');
  assert.equal(extractVersion(''), null);
  assert.equal(extractVersion(null), null);
});

test('version-match: healthy, versionMatch:true, no warning', () => {
  const execImpl = (cmd, args) => {
    assert.equal(cmd, 'pandoc');
    assert.deepEqual(args, ['--version']);
    return { status: 0, stdout: 'pandoc 3.10\nFeatures: +server\n' };
  };
  const result = checkBinaryVersion(makeCard(), { execImpl });
  assert.equal(result.ok, true);
  assert.equal(result.installed, true);
  assert.equal(result.healthy, true);
  assert.equal(result.versionMatch, true);
  assert.equal(result.actualVersion, '3.10');
  assert.equal(result.expectedVersion, '3.10');
  assert.equal(result.warning, null);
});

test('version-mismatch-warns: healthy stays true, versionMatch:false, warning names both versions', () => {
  const execImpl = () => ({ status: 0, stdout: 'pandoc 3.9\n' });
  const result = checkBinaryVersion(makeCard(), { execImpl });
  assert.equal(result.ok, true);
  assert.equal(result.installed, true);
  assert.equal(result.healthy, true, 'a version mismatch must warn, not fail the health check');
  assert.equal(result.versionMatch, false);
  assert.equal(result.actualVersion, '3.9');
  assert.match(result.warning, /expected 3\.10, found 3\.9/);
});

test('binary-absent (ENOENT): installed:false, healthy:false, no version fabricated', () => {
  const execImpl = () => ({ status: null, error: Object.assign(new Error('spawn pandoc ENOENT'), { code: 'ENOENT' }) });
  const result = checkBinaryVersion(makeCard(), { execImpl });
  assert.equal(result.ok, true);
  assert.equal(result.installed, false);
  assert.equal(result.healthy, false);
  assert.equal(result.actualVersion, null);
  assert.equal(result.versionMatch, null);
  assert.match(result.detail, /not found on PATH/);
});

test('present but exits non-zero: installed:true, healthy:false, no version fabricated', () => {
  const execImpl = () => ({ status: 1, stdout: '', stderr: 'segfault' });
  const result = checkBinaryVersion(makeCard(), { execImpl });
  assert.equal(result.installed, true);
  assert.equal(result.healthy, false);
  assert.equal(result.actualVersion, null);
  assert.match(result.detail, /exited 1/);
  assert.match(result.detail, /segfault/);
});

test('version output on stderr (e.g. graphviz dot -V) is read when stdout is empty', () => {
  const card = makeCard({
    id: 'dot',
    versionPolicy: { type: 'external-pinned', expectedVersion: '15.0.0' },
    healthCheck: { kind: 'subprocess-version', command: 'dot', args: ['-V'], timeoutMs: 10000 },
  });
  const execImpl = () => ({ status: 0, stdout: '', stderr: 'dot - graphviz version 15.0.0 (20260523.1842)\n' });
  const result = checkBinaryVersion(card, { execImpl });
  assert.equal(result.healthy, true);
  assert.equal(result.actualVersion, '15.0.0');
  assert.equal(result.versionMatch, true);
});

test('no expectedVersion recorded: versionMatch stays null (nothing to compare against), never fabricated', () => {
  const card = makeCard({ versionPolicy: { type: 'unmanaged' } });
  const execImpl = () => ({ status: 0, stdout: 'pandoc 3.10\n' });
  const result = checkBinaryVersion(card, { execImpl });
  assert.equal(result.healthy, true);
  assert.equal(result.actualVersion, '3.10');
  assert.equal(result.versionMatch, null);
  assert.equal(result.warning, null);
});

test('rejects a non-binary Provider Card without throwing', () => {
  const result = checkBinaryVersion({ id: 'docling', kind: 'sidecar' });
  assert.equal(result.ok, false);
  assert.match(result.detail, /requires a 'binary' kind/);
});

test('rejects a binary card whose healthCheck.kind is not subprocess-version', () => {
  const card = makeCard({ healthCheck: { kind: 'manual' } });
  const result = checkBinaryVersion(card);
  assert.equal(result.ok, false);
  assert.match(result.detail, /must be 'subprocess-version'/);
});
