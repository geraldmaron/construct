/**
 * Registry catalog formatting helpers — Worker Profile list label vs tagline.
 */

import assert from 'node:assert/strict';
import test from 'node:test';

import {
  formatWorkerProfileListLine,
  humanizeId,
  workerProfileListLabel,
  workerProfileTagline,
} from '../../lib/registry/catalog-format.mjs';

test('humanizeId converts kebab-case ids to title labels', () => {
  assert.equal(humanizeId('engineer'), 'Engineer');
  assert.equal(humanizeId('product-manager'), 'Product Manager');
  assert.equal(humanizeId('data-analyst'), 'Data Analyst');
  assert.equal(humanizeId('qa'), 'QA');
});

test('workerProfileListLabel derives a short label from id', () => {
  const record = {
    id: 'product-manager',
    displayName: 'Translates user reality into technical deliverables — skeptical of any requirement that cannot be traced to observed user behavior.',
  };
  assert.equal(workerProfileListLabel(record), 'Product Manager');
});

test('workerProfileTagline keeps tagline-style displayName separate from list label', () => {
  const record = {
    id: 'engineer',
    displayName: 'Reads before writing — understanding the existing pattern matters more than having the better one.',
  };
  assert.equal(workerProfileTagline(record), record.displayName);
  assert.notEqual(workerProfileListLabel(record), workerProfileTagline(record));
});

test('formatWorkerProfileListLine renders id, short label, and tagline columns', () => {
  const record = {
    id: 'engineer',
    displayName: 'Reads before writing — understanding the existing pattern matters more than having the better one.',
  };
  const line = formatWorkerProfileListLine(record, { idWidth: 8, labelWidth: 8, taglineMax: 40 });
  assert.match(line, /^engineer\s+Engineer\s+Reads before writing/);
});
