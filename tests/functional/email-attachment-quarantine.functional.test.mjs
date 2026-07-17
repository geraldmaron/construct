/**
 * tests/functional/email-attachment-quarantine.functional.test.mjs — email
 * ingestion attachment policy end to end (construct-tsyfe.2.7).
 *
 * Spawns the real `ingestDocuments()` pipeline (lib/document-ingest.mjs) over
 * a real .eml fixture in a tmpdir and asserts on the durable artifacts it
 * writes: a `.quarantine.json` sidecar recording a withheld attachment
 * (mirroring the `.assets.json` sidecar pattern), the markdown output still
 * succeeding for the rest of the message (AC1), and a path-traversal
 * attachment filename never reaching the ingest output directory unsanitized
 * (AC2).
 */
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { ingestDocuments } from '../../lib/document-ingest.mjs';
import { rmTmpDir } from '../helpers/cleanup.mjs';

const FIXTURE_DIR = path.resolve('tests/fixtures/email-mime');
const tmpDirs = [];
after(() => { for (const dir of tmpDirs) rmTmpDir(dir); });

function tmpDir() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'email-quarantine-'));
  tmpDirs.push(dir);
  return dir;
}

test('a zip-bomb-suspect attachment is quarantined to a durable sidecar and the rest of the message still ingests', async () => {
  const dir = tmpDir();
  const source = path.join(dir, 'archive.eml');
  fs.copyFileSync(path.join(FIXTURE_DIR, '09-zip-bomb-suspect.eml'), source);

  const result = await ingestDocuments([source], { cwd: dir, highFidelity: false });

  assert.equal(result.status, 'ok');
  const file = result.files[0];
  assert.equal(file.extractionMethod, 'eml-mailparser');
  assert.ok(file.quarantine, 'a quarantine sidecar path is recorded on the ingest result');

  const quarantinePath = path.join(dir, file.quarantine);
  assert.equal(fs.existsSync(quarantinePath), true, 'the .quarantine.json sidecar was actually written to disk');
  const sidecar = JSON.parse(fs.readFileSync(quarantinePath, 'utf8'));
  assert.equal(sidecar.quarantined.length, 1);
  assert.equal(sidecar.quarantined[0].originalFilename, 'payload.zip');
  assert.match(sidecar.quarantined[0].quarantineReason, /zip-bomb threshold/);

  assert.equal(fs.existsSync(file.outputPath), true, 'ingest of the rest of the message still succeeded');
  const markdown = fs.readFileSync(file.outputPath, 'utf8');
  assert.match(markdown, /See the attached archive\./);
  assert.ok(
    file.droppedInfo.some((d) => d.kind === 'attachment-quarantined'),
    'the quarantine is also surfaced on droppedInfo, not only the sidecar',
  );
});

test('a path-traversal attachment filename is sanitized before it ever reaches the ingest output tree', async () => {
  const dir = tmpDir();
  const source = path.join(dir, 'invoice.eml');
  fs.copyFileSync(path.join(FIXTURE_DIR, '08-attachment-path-traversal.eml'), source);

  const result = await ingestDocuments([source], { cwd: dir, highFidelity: false });

  const file = result.files[0];
  assert.deepEqual(file.structured.attachments, [{ filename: 'passwd' }]);
  assert.equal(file.quarantine, null, 'a sanitized-but-kept attachment is not quarantined');

  const escapedTarget = path.resolve(dir, '..', '..', '..', 'etc', 'passwd');
  assert.equal(fs.existsSync(escapedTarget), false, 'no write ever followed the traversal sequence');
});
