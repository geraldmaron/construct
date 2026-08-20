/**
 * tests/kernel/store/catalog.test.ts — the catalog high-water mark.
 *
 * The mark exists so an older Construct can hear it is behind, which means the
 * one property that matters is that an older build cannot lower it: the mark
 * must survive being read — and re-recorded — by exactly the build it warns.
 * Ordering must treat prerelease numbers numerically (alpha.5 before
 * alpha.10), because that is the shape this package's own versions take.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { sterile } from '../../harness/sterile.ts';
import { openStore } from '../../../src/kernel/store/open.ts';
import {
  catalogHighWater,
  compareCatalogVersions,
  recordCatalogSighting,
  sightingAhead,
} from '../../../src/kernel/store/catalog.ts';

const AT = '2026-08-03T00:00:00.000Z';
const LATER = '2026-08-04T00:00:00.000Z';

function withStore<T>(fn: (store: ReturnType<typeof openStore>) => T): T {
  const fixture = sterile();
  const store = openStore(join(fixture.root, 'data', 'construct.db'));
  try {
    return fn(store);
  } finally {
    store.close();
    fixture.cleanup();
  }
}

test('a fresh store has no mark, and a sighting becomes one', () => {
  withStore((store) => {
    assert.equal(catalogHighWater(store), null);

    recordCatalogSighting(store, { version: '3.0.0-alpha.5', domains: 15, at: AT });
    assert.deepEqual(catalogHighWater(store), {
      version: '3.0.0-alpha.5',
      domains: 15,
      at: AT,
    });
  });
});

test('a newer build advances the mark; an older one cannot lower it', () => {
  withStore((store) => {
    recordCatalogSighting(store, { version: '3.0.0-alpha.5', domains: 15, at: AT });
    recordCatalogSighting(store, { version: '3.0.0-alpha.10', domains: 17, at: LATER });
    assert.deepEqual(catalogHighWater(store), {
      version: '3.0.0-alpha.10',
      domains: 17,
      at: LATER,
    });

    // The build the mark warns re-records its own catalog on every open. If
    // that lowered the mark, the warning would erase itself the moment it was
    // needed.
    recordCatalogSighting(store, { version: '3.0.0-alpha.5', domains: 15, at: LATER });
    assert.equal(catalogHighWater(store)?.version, '3.0.0-alpha.10');
  });
});

test('re-recording the same catalog changes nothing', () => {
  withStore((store) => {
    recordCatalogSighting(store, { version: '3.0.0-alpha.10', domains: 17, at: AT });
    recordCatalogSighting(store, { version: '3.0.0-alpha.10', domains: 17, at: LATER });
    // The original timestamp survives: an identical sighting is not an event.
    assert.equal(catalogHighWater(store)?.at, AT);
  });
});

test('equal versions with a bigger catalog still advance the mark', () => {
  withStore((store) => {
    recordCatalogSighting(store, { version: 'dev', domains: 15, at: AT });
    recordCatalogSighting(store, { version: 'dev', domains: 17, at: LATER });
    assert.equal(catalogHighWater(store)?.domains, 17);
  });
});

test('version order is semantic, prerelease numbers numeric', () => {
  assert.ok(compareCatalogVersions('3.0.0-alpha.5', '3.0.0-alpha.10') < 0);
  assert.ok(compareCatalogVersions('3.0.0-alpha.10', '3.0.0') < 0);
  assert.ok(compareCatalogVersions('3.0.1', '3.0.0') > 0);
  assert.equal(compareCatalogVersions('3.0.0', '3.0.0'), 0);
  // Unparsable versions assert nothing; the domain count breaks the tie.
  assert.equal(compareCatalogVersions('dev', '3.0.0'), 0);
  assert.ok(sightingAhead({ version: 'dev', domains: 17, at: AT }, { version: '3.0.0', domains: 15 }));
  assert.ok(!sightingAhead({ version: 'dev', domains: 15, at: AT }, { version: '3.0.0', domains: 15 }));
});
