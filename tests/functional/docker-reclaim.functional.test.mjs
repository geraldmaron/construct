/**
 * tests/functional/docker-reclaim.functional.test.mjs — orphan Postgres reclaim.
 *
 * Exercises lib/maintenance/docker-reclaim.mjs against a fake `docker` so the
 * suite stays hermetic: no daemon, no machine-global container or volume is
 * touched. The fake records every command, letting the test assert that only
 * abandoned per-home resources are removed and that the live install, the
 * operator-pinned container, foreign-but-live homes, and the legacy singular
 * are all spared.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  parseContainers,
  parseVolumes,
  selectOrphans,
  reclaimOrphanedDockerResources,
  formatReclaim,
} from '../../lib/maintenance/docker-reclaim.mjs';
import { homeNamespaceSuffix } from '../../lib/home-namespace.mjs';

const HOME = '/Users/test/home';
const CURRENT = homeNamespaceSuffix(HOME);

function makeDocker({ psLines = [], volLines = [], failPs = false, inUse = new Set() } = {}) {
  const calls = [];
  const run = (args) => {
    calls.push(args.join(' '));
    if (args[0] === 'ps') {
      if (failPs) return { status: 1, stdout: '', stderr: 'Cannot connect to the Docker daemon', error: null };
      return { status: 0, stdout: `${psLines.join('\n')}\n`, stderr: '' };
    }
    if (args[0] === 'volume' && args[1] === 'ls') {
      return { status: 0, stdout: `${volLines.join('\n')}\n`, stderr: '' };
    }
    if (args[0] === 'rm') return { status: 0, stdout: '', stderr: '' };
    if (args[0] === 'volume' && args[1] === 'rm') {
      return inUse.has(args[2])
        ? { status: 1, stdout: '', stderr: 'volume is in use' }
        : { status: 0, stdout: '', stderr: '' };
    }
    return { status: 1, stdout: '', stderr: 'unexpected' };
  };
  return { run, calls };
}

const EXISTING = new Set([
  `${HOME}/.construct/services/postgres`,
  '/Users/other/.construct/services/postgres',
]);
const pathExists = (p) => EXISTING.has(p);

function scenario() {
  const psLines = [
    `construct-postgres-${CURRENT}\t${HOME}/.construct/services/postgres`,
    'construct-postgres-c53c59df\t/tmp/cx-footprint-WbGx/home/.construct/services/postgres',
    'construct-postgres-aaaaaaaa\t/Users/other/.construct/services/postgres',
    'construct-postgres-bbbbbbbb\t/tmp/gone-pinned/services/postgres',
    'construct-postgres\t/legacy/singular',
    'unrelated-postgres\t/somewhere',
  ];
  const volLines = [
    `postgres_construct-postgres-${CURRENT}-data`,
    'postgres_construct-postgres-c53c59df-data',
    'postgres_construct-postgres-aaaaaaaa-data',
    'postgres_construct-postgres-bbbbbbbb-data',
    'postgres_construct-postgres-deadbeef-data',
    'postgres_construct-postgres-feedface-data',
    'some-unrelated-volume',
  ];
  return { psLines, volLines };
}

describe('parseContainers / parseVolumes', () => {
  it('matches only namespaced names and captures the working_dir label', () => {
    const parsed = parseContainers('construct-postgres-c53c59df\t/tmp/x\nconstruct-postgres\t/legacy\nfoo\t/bar\n');
    assert.deepEqual(parsed, [{ name: 'construct-postgres-c53c59df', suffix: 'c53c59df', workingDir: '/tmp/x' }]);
  });

  it('ignores the legacy singular and non-Construct volumes', () => {
    const parsed = parseVolumes('postgres_construct-postgres-c53c59df-data\nconstruct-postgres_data\nrandom\n');
    assert.deepEqual(parsed, [{ name: 'postgres_construct-postgres-c53c59df-data', suffix: 'c53c59df' }]);
  });
});

describe('selectOrphans', () => {
  it('flags foreign + gone, spares current, pinned, foreign-but-live', () => {
    const { psLines, volLines } = scenario();
    const containers = parseContainers(psLines.join('\n'));
    const volumes = parseVolumes(volLines.join('\n'));
    const { orphanContainers, orphanVolumes } = selectOrphans({
      containers,
      volumes,
      currentSuffix: CURRENT,
      pinnedName: 'construct-postgres-bbbbbbbb',
      pathExists,
    });

    assert.deepEqual(orphanContainers.map((c) => c.name), ['construct-postgres-c53c59df']);
    const orphanVolNames = orphanVolumes.map((v) => v.name).sort();
    assert.deepEqual(orphanVolNames, [
      'postgres_construct-postgres-c53c59df-data',
      'postgres_construct-postgres-deadbeef-data',
      'postgres_construct-postgres-feedface-data',
    ].sort());
  });
});

describe('reclaimOrphanedDockerResources', () => {
  it('removes only the abandoned container + volumes, spares everything live', () => {
    const { psLines, volLines } = scenario();
    const docker = makeDocker({ psLines, volLines, inUse: new Set(['postgres_construct-postgres-feedface-data']) });

    const summary = reclaimOrphanedDockerResources({
      runDocker: docker.run,
      homeDir: HOME,
      env: { CONSTRUCT_PG_CONTAINER: 'construct-postgres-bbbbbbbb' },
      pathExists,
    });

    assert.equal(summary.available, true);
    assert.deepEqual(summary.removedContainers, ['construct-postgres-c53c59df']);
    assert.deepEqual(summary.removedVolumes.sort(), [
      'postgres_construct-postgres-c53c59df-data',
      'postgres_construct-postgres-deadbeef-data',
    ].sort());

    assert.ok(summary.skipped.some((s) => s.name === 'postgres_construct-postgres-feedface-data' && s.reason === 'in-use-or-missing'));
    assert.equal(summary.errors.length, 0);

    assert.ok(docker.calls.includes('rm -f -v construct-postgres-c53c59df'));
    assert.ok(!docker.calls.some((c) => c.includes('construct-postgres-bbbbbbbb')), 'pinned container untouched');
    assert.ok(!docker.calls.some((c) => c.includes('construct-postgres-aaaaaaaa')), 'foreign-but-live untouched');
    assert.ok(!docker.calls.some((c) => c.includes(`construct-postgres-${CURRENT}`)), 'live install untouched');
  });

  it('is a clean no-op when Docker is unavailable', () => {
    const docker = makeDocker({ failPs: true });
    const summary = reclaimOrphanedDockerResources({ runDocker: docker.run, homeDir: HOME, env: {}, pathExists });
    assert.equal(summary.available, false);
    assert.equal(summary.reason, 'docker-unavailable');
    assert.equal(summary.removedContainers.length, 0);
    assert.ok(!docker.calls.some((c) => c.startsWith('rm') || c.startsWith('volume rm')));
  });

  it('dry-run reports intent without issuing destructive commands', () => {
    const psLines = ['construct-postgres-c53c59df\t/tmp/gone/services/postgres'];
    const volLines = ['postgres_construct-postgres-c53c59df-data'];
    const docker = makeDocker({ psLines, volLines });
    const summary = reclaimOrphanedDockerResources({
      runDocker: docker.run, homeDir: HOME, env: {}, dryRun: true, pathExists,
    });
    assert.deepEqual(summary.removedContainers, ['construct-postgres-c53c59df']);
    assert.deepEqual(summary.removedVolumes, ['postgres_construct-postgres-c53c59df-data']);
    assert.ok(!docker.calls.some((c) => c.startsWith('rm ') || c.startsWith('volume rm')), 'no destructive docker calls in dry-run');
  });

  it('respects the reclaim budget', () => {
    const psLines = [
      'construct-postgres-11111111\t/tmp/gone1',
      'construct-postgres-22222222\t/tmp/gone2',
    ];
    const docker = makeDocker({ psLines, volLines: [] });
    const summary = reclaimOrphanedDockerResources({
      runDocker: docker.run, homeDir: HOME, env: {}, max: 1, pathExists,
    });
    assert.equal(summary.removedContainers.length, 1);
    assert.ok(summary.skipped.some((s) => s.reason === 'reclaim-budget-exhausted'));
  });
});

describe('formatReclaim', () => {
  it('summarizes counts and returns null when nothing was reclaimed', () => {
    assert.equal(formatReclaim({ available: true, removedContainers: [], removedVolumes: [] }), null);
    assert.equal(formatReclaim({ available: false, removedContainers: ['x'], removedVolumes: [] }), null);
    assert.equal(
      formatReclaim({ available: true, removedContainers: ['a'], removedVolumes: ['b', 'c'], dryRun: false }),
      'Reclaimed 1 orphaned Postgres container and 2 abandoned data volumes from deleted home namespaces.',
    );
  });
});
