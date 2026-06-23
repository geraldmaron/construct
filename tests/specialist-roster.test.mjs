/**
 * tests/specialist-roster.test.mjs — lazy specialist catalog (construct-ymp5).
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import { buildSpecialistCatalog, formatSpecialistRosterText } from '../lib/specialists/roster.mjs';

test('buildSpecialistCatalog lists public specialists with routing hints', () => {
  const catalog = buildSpecialistCatalog();
  assert.ok(catalog.length >= 20);
  assert.ok(catalog.every((row) => row.id.startsWith('cx-') && row.whenToUse.length > 0));
  assert.equal(catalog.some((row) => row.id === 'cx-engineer'), true);
  assert.equal(catalog.some((row) => row.id === 'cx-orchestrator'), true, 'internal specialists are routable via orchestration_policy');
});

test('formatSpecialistRosterText matches the legacy roster line shape', () => {
  const text = formatSpecialistRosterText([
    { id: 'cx-engineer', whenToUse: 'implementation work' },
  ]);
  assert.equal(text, '- cx-engineer: implementation work');
});
