/**
 * tests/deployment-parity.test.mjs — capability parity contract vs topology.
 *
 * Pins that every deployment topology dimension carries a parity declaration and
 * that the declaration is reconciled with the live topology (bead construct-wvbf.13):
 * a `parity` capability must be present in every mode, a `mode-specific` one must
 * genuinely differ. The failure cases prove the silent-divergence guard bites.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import { validateParityContract, describeParityContract, PARITY_CONTRACT, PARITY_CLASSES } from '../lib/deployment/parity-contract.mjs';
import { resolveResourceMode, DEPLOYMENT_MODES } from '../lib/deployment-mode.mjs';

test('the parity contract reconciles with the live topology', () => {
  const { ok, errors } = validateParityContract();
  assert.equal(ok, true, errors.join('; '));
});

test('every topology dimension has a parity declaration', () => {
  const dims = new Set();
  for (const mode of DEPLOYMENT_MODES) for (const d of Object.keys(resolveResourceMode(mode))) dims.add(d);
  for (const d of dims) assert.ok(PARITY_CONTRACT[d], `dimension "${d}" must be declared`);
});

test('declarations use a valid parity class and carry a rationale', () => {
  for (const [dim, decl] of Object.entries(PARITY_CONTRACT)) {
    assert.ok(PARITY_CLASSES.includes(decl.parityClass), `${dim} parityClass`);
    assert.ok(decl.rationale && decl.rationale.length > 0, `${dim} rationale`);
  }
});

test('parity-classed capabilities are present in every mode', () => {
  for (const [dim, decl] of Object.entries(PARITY_CONTRACT)) {
    if (decl.parityClass !== 'parity') continue;
    for (const mode of DEPLOYMENT_MODES) {
      assert.ok(resolveResourceMode(mode)[dim], `${dim} present in ${mode}`);
    }
  }
});

test('describeParityContract returns a row per declared dimension', () => {
  const rows = describeParityContract();
  assert.equal(rows.length, Object.keys(PARITY_CONTRACT).length);
  for (const r of rows) assert.ok(r.backends.includes('solo:'), 'row shows the solo backend');
});
