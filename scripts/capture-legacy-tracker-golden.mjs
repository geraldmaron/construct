/**
 * scripts/capture-legacy-tracker-golden.mjs — dual-run capture for the tracker
 * projection harvest, frozen into
 * tests/kernel/tracker/fixtures/tracker-golden.json.
 *
 * v2 sources ported:
 *   lib/tracker-projection/field-authority.mjs
 *   lib/tracker-projection/projection.mjs
 *
 * Only the PURE half is ported. v2's storage layer (a Dolt lock) is a rewrite,
 * not a port, and is deferred to Phase 2 — see the bead.
 *
 * `importedAt` is passed explicitly on every case. v2 defaulted it to
 * new Date().toISOString(); the port refuses to read the clock at all, so
 * pinning it here is what makes the two comparable.
 *
 * Needs a construct-legacy checkout; NOT part of the test run. The frozen JSON
 * is. A diff on re-capture is a real behavior change.
 */

import { readFileSync, writeFileSync } from 'node:fs';
import { legacyCheckout } from './lib/legacy-checkout.mjs';

const LEGACY = legacyCheckout();

const { buildProjection, projectionFieldsByAuthority, canonicalJson, valuesEqual, projectionId } =
  await import(`${LEGACY}/lib/tracker-projection/projection.mjs`);
const { authorityFor, splitFieldsByAuthority, FIELD_AUTHORITY } = await import(
  `${LEGACY}/lib/tracker-projection/field-authority.mjs`
);

const casesUrl = new URL('../tests/kernel/tracker/fixtures/tracker-cases.json', import.meta.url);
const CASES = JSON.parse(readFileSync(casesUrl, 'utf8'));

const attempt = (fn) => {
  try {
    return { ok: true, value: fn() };
  } catch (err) {
    return { ok: false, message: err.message };
  }
};

const PINNED_AT = '2026-01-01T00:00:00.000Z';

const golden = {
  fieldAuthority: FIELD_AUTHORITY,
  authorityFor: Object.fromEntries(
    [...Object.keys(FIELD_AUTHORITY), 'id', 'totally_unknown_field', ''].map((f) => [
      f,
      authorityFor(f),
    ]),
  ),
  canonical: CASES.canonical.map((c) => ({
    name: c.name,
    value: c.value,
    json: canonicalJson(c.value),
  })),
  equality: CASES.equality.map((c) => ({ name: c.name, a: c.a, b: c.b, equal: valuesEqual(c.a, c.b) })),
  ids: CASES.ids.map((id) => ({ externalId: id, projectionId: projectionId(id) })),
  projections: CASES.issues.map((c) => ({
    name: c.name,
    issue: c.issue,
    outcome: attempt(() => buildProjection(c.issue, { ...c.options, importedAt: PINNED_AT })),
    split: attempt(() => splitFieldsByAuthority(c.issue)),
  })),
  byAuthority: CASES.issues.map((c) => ({
    name: c.name,
    outcome: attempt(() =>
      projectionFieldsByAuthority(buildProjection(c.issue, { ...c.options, importedAt: PINNED_AT })),
    ),
  })),
  pinnedAt: PINNED_AT,
};

const out = new URL('../tests/kernel/tracker/fixtures/tracker-golden.json', import.meta.url);
writeFileSync(out, `${JSON.stringify(golden, null, 2)}\n`);
console.log(`captured ${golden.projections.length} projections -> ${out.pathname}`);
