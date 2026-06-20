/**
 * tests/libreoffice-export.test.mjs — LibreOffice bin resolution and detect contract.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  resolveLibreOfficeBin,
  libreOfficePresent,
  libreOfficeInstallHint,
} from '../lib/libreoffice-export.mjs';

test('libreOfficeInstallHint mentions LibreOffice', () => {
  assert.match(libreOfficeInstallHint(), /LibreOffice/i);
});

test('resolveLibreOfficeBin returns null or a path string', () => {
  const env = { ...process.env, CONSTRUCT_LIBREOFFICE_BIN: '', SOFFICE_BIN: '' };
  const bin = resolveLibreOfficeBin(env);
  assert.ok(bin === null || typeof bin === 'string');
});

test('libreOfficePresent matches resolveLibreOfficeBin', () => {
  const env = { ...process.env, CONSTRUCT_LIBREOFFICE_BIN: '', SOFFICE_BIN: '' };
  assert.equal(libreOfficePresent(env), Boolean(resolveLibreOfficeBin(env)));
});
