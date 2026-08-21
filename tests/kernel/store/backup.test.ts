/**
 * tests/kernel/store/backup.test.ts — the second copy of the store, and the
 * honesty of the check on it.
 *
 * The properties held here: a destination inside the store's own directory is
 * refused (spelled directly, and reached through a symlink), a copy is a whole
 * usable store rather than a torn file, a corrupted copy verifies as a
 * mismatch rather than a pass, a copy with no recorded checksum comes back
 * unverifiable rather than fine, repeated copies do not write over each other,
 * and the disclosure line names both states — no copy ever taken, and a copy
 * whose file is no longer where it was recorded.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  chmodSync,
  existsSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { join } from 'node:path';
import { sterile } from '../../harness/sterile.ts';
import type { SterileFixture } from '../../harness/sterile.ts';
import { openStore, storePath } from '../../../src/kernel/store/open.ts';
import { appendWorkLog, readWorkLog } from '../../../src/kernel/store/worklog.ts';
import {
  backupDisclosure,
  backupLedgerPath,
  BackupRefusedError,
  checksumSidecar,
  destinationProblem,
  lastBackup,
  takeBackup,
  verifyBackup,
} from '../../../src/kernel/store/backup.ts';

const AT = '2026-08-13T00:00:00.000Z';
const LATER = '2026-08-16T00:00:00.000Z';

/** A store with one work-log entry in it, so a copy has something to have carried. */
function seededStore(fixture: SterileFixture): string {
  const file = storePath(fixture.paths);
  const store = openStore(file);
  try {
    appendWorkLog(store, {
      run: 'run-1',
      task: null,
      role: 'engineer',
      action: 'noted',
      detail: 'the entry a copy has to carry',
      at: AT,
    });
  } finally {
    store.close();
  }
  return file;
}

test('a fresh copy verifies against the checksum recorded with it', () => {
  const fixture = sterile();
  try {
    const vault = join(fixture.root, 'vault');
    const record = takeBackup({
      storeFile: seededStore(fixture),
      destDir: vault,
      ledgerFile: backupLedgerPath(fixture.paths),
      at: AT,
    });

    assert.equal(record.file, join(vault, readdirSync(vault).filter((n) => n.endsWith('.db'))[0] ?? ''));
    assert.ok(record.bytes > 0);
    assert.match(record.sha256, /^[0-9a-f]{64}$/);

    const verdict = verifyBackup(record.file);
    assert.equal(verdict.matched, true, verdict.detail);
    assert.equal(verdict.actual, record.sha256);
    assert.equal(verdict.recorded, record.sha256);
  } finally {
    fixture.cleanup();
  }
});

test('a copy is a whole store, carrying the rows the original had', () => {
  const fixture = sterile();
  try {
    const record = takeBackup({
      storeFile: seededStore(fixture),
      destDir: join(fixture.root, 'vault'),
      ledgerFile: backupLedgerPath(fixture.paths),
      at: AT,
    });

    const copy = openStore(record.file);
    try {
      assert.deepEqual(
        readWorkLog(copy, 'run-1').map((entry) => entry.detail),
        ['the entry a copy has to carry'],
      );
    } finally {
      copy.close();
    }
  } finally {
    fixture.cleanup();
  }
});

test('opening a copy in place changes it, and the check says so rather than waving it through', () => {
  const fixture = sterile();
  try {
    const record = takeBackup({
      storeFile: seededStore(fixture),
      destDir: join(fixture.root, 'vault'),
      ledgerFile: backupLedgerPath(fixture.paths),
      at: AT,
    });
    assert.equal(verifyBackup(record.file).matched, true, 'the copy starts out matching');

    // Opening a database writes to it — the journal mode is a fact stored in
    // the file's own header. The checksum is over the bytes that were taken,
    // so this is a real difference and reporting it as one is the point: a
    // check that forgave changes it judged harmless would have to judge.
    openStore(record.file).close();

    const verdict = verifyBackup(record.file);
    assert.equal(verdict.matched, false, 'a copy that has been written to no longer matches');
    assert.equal(verdict.recorded, record.sha256);
  } finally {
    fixture.cleanup();
  }
});

test('the checksum sits beside the copy, in the format a stranger can check', () => {
  const fixture = sterile();
  try {
    const record = takeBackup({
      storeFile: seededStore(fixture),
      destDir: join(fixture.root, 'vault'),
      ledgerFile: backupLedgerPath(fixture.paths),
      at: AT,
    });

    const sidecar = checksumSidecar(record.file);
    assert.ok(existsSync(sidecar), 'the checksum is written beside the copy');
    assert.match(readFileSync(sidecar, 'utf8'), new RegExp(`^${record.sha256} {2}construct-.*\\.db\\n$`));
    // The copy holds everything the store holds, so it is not world-readable.
    assert.equal(statSync(record.file).mode & 0o777, 0o600);
  } finally {
    fixture.cleanup();
  }
});

test('a corrupted copy verifies as a mismatch, not a pass', () => {
  const fixture = sterile();
  try {
    const record = takeBackup({
      storeFile: seededStore(fixture),
      destDir: join(fixture.root, 'vault'),
      ledgerFile: backupLedgerPath(fixture.paths),
      at: AT,
    });
    assert.equal(verifyBackup(record.file).matched, true, 'the copy starts out intact');

    // One byte, in the middle of the file, with the recorded checksum left
    // exactly as it was: the state a silently-rotted backup is actually in.
    const bytes = readFileSync(record.file);
    bytes[Math.floor(bytes.length / 2)] ^= 0xff;
    chmodSync(record.file, 0o600);
    writeFileSync(record.file, bytes);

    const verdict = verifyBackup(record.file);
    assert.equal(verdict.matched, false, 'a changed copy must not verify');
    assert.equal(verdict.recorded, record.sha256);
    assert.notEqual(verdict.actual, record.sha256);
    assert.match(verdict.detail, /does not match the checksum recorded/);
  } finally {
    fixture.cleanup();
  }
});

test('a copy with no recorded checksum reads as unverifiable, which is not intact', () => {
  const fixture = sterile();
  try {
    const loose = join(fixture.root, 'loose.db');
    writeFileSync(loose, 'not really a database, and nothing says what it should hash to\n');

    const verdict = verifyBackup(loose);
    assert.equal(verdict.matched, false, 'an uncheckable copy is never a pass');
    assert.equal(verdict.recorded, null);
    assert.match(verdict.actual ?? '', /^[0-9a-f]{64}$/, 'what it does hash to is still reported');
    assert.match(verdict.detail, /cannot be verified, which is not the same as being intact/);
  } finally {
    fixture.cleanup();
  }
});

test('verifying a file that is not there says so rather than throwing', () => {
  const fixture = sterile();
  try {
    const verdict = verifyBackup(join(fixture.root, 'absent.db'));
    assert.equal(verdict.matched, false);
    assert.match(verdict.detail, /there is no file at/);
  } finally {
    fixture.cleanup();
  }
});

test('a destination inside the store directory is refused, spelled out or reached by symlink', () => {
  const fixture = sterile();
  try {
    const storeFile = seededStore(fixture);
    const storeDir = fixture.paths.dataDir;

    for (const inside of [storeDir, join(storeDir, 'copies'), join(storeDir, 'a', 'b')]) {
      assert.match(
        destinationProblem(inside, storeFile) ?? '',
        /resolves inside the store's own directory/,
        `${inside} must be refused`,
      );
    }

    // A symlink is exactly how a destination looks outside and is not.
    const decoy = join(fixture.root, 'looks-outside');
    symlinkSync(storeDir, decoy);
    assert.match(destinationProblem(decoy, storeFile) ?? '', /resolves inside the store's own directory/);

    assert.throws(
      () =>
        takeBackup({
          storeFile,
          destDir: decoy,
          ledgerFile: backupLedgerPath(fixture.paths),
          at: AT,
        }),
      BackupRefusedError,
    );
    assert.equal(readdirSync(storeDir).filter((n) => n.endsWith('.db')).length, 1, 'nothing was written inside');
  } finally {
    fixture.cleanup();
  }
});

test('a destination outside the store directory is allowed', () => {
  const fixture = sterile();
  try {
    const storeFile = seededStore(fixture);
    assert.equal(destinationProblem(join(fixture.root, 'vault'), storeFile), null);
    // The directory holding the store's directory is outside it: the deletion
    // this guards against takes the store's directory, not its parent.
    assert.equal(destinationProblem(join(fixture.root, 'data-sibling'), storeFile), null);
  } finally {
    fixture.cleanup();
  }
});

test('backing up a store that does not exist yet is refused, and creates nothing', () => {
  const fixture = sterile();
  try {
    assert.throws(
      () =>
        takeBackup({
          storeFile: storePath(fixture.paths),
          destDir: join(fixture.root, 'vault'),
          ledgerFile: backupLedgerPath(fixture.paths),
          at: AT,
        }),
      (error: unknown) =>
        error instanceof BackupRefusedError && /there is no store at .* yet/.test(error.message),
    );
    assert.equal(existsSync(join(fixture.root, 'vault')), false, 'a refusal writes nothing');
    assert.equal(existsSync(fixture.paths.dataDir), false, 'and brings no store into existence');
  } finally {
    fixture.cleanup();
  }
});

test('a second copy stands beside the first instead of over it', () => {
  const fixture = sterile();
  try {
    const storeFile = seededStore(fixture);
    const vault = join(fixture.root, 'vault');
    const ledgerFile = backupLedgerPath(fixture.paths);

    const first = takeBackup({ storeFile, destDir: vault, ledgerFile, at: AT });
    const second = takeBackup({ storeFile, destDir: vault, ledgerFile, at: LATER });

    assert.notEqual(first.file, second.file);
    assert.equal(readdirSync(vault).filter((name) => name.endsWith('.db')).length, 2);
    assert.equal(verifyBackup(first.file).matched, true, 'the older copy is untouched');
    assert.equal(lastBackup(ledgerFile)?.record.file, second.file, 'the newest is the one reported');
  } finally {
    fixture.cleanup();
  }
});

test('the disclosure names having no copy, and names it as a gap rather than a failure', () => {
  const fixture = sterile();
  try {
    const ledgerFile = backupLedgerPath(fixture.paths);
    assert.equal(lastBackup(ledgerFile), null);

    const line = backupDisclosure(ledgerFile, LATER);
    assert.match(line, /no copy of the store has ever been taken/);
    assert.match(line, /construct backup <dir>/, 'it says what to do about it');
    assert.equal(existsSync(fixture.paths.stateDir), false, 'asking the question creates nothing');
  } finally {
    fixture.cleanup();
  }
});

test('the disclosure names a copy that exists, and how recently it was taken', () => {
  const fixture = sterile();
  try {
    const ledgerFile = backupLedgerPath(fixture.paths);
    const record = takeBackup({
      storeFile: seededStore(fixture),
      destDir: join(fixture.root, 'vault'),
      ledgerFile,
      at: AT,
    });

    const line = backupDisclosure(ledgerFile, LATER);
    assert.match(line, /^last copy taken 3 days ago: /);
    assert.ok(line.endsWith(record.file), `expected the copy's path, got: ${line}`);
  } finally {
    fixture.cleanup();
  }
});

test('a recorded copy whose file is gone is reported as gone, not as a copy', () => {
  const fixture = sterile();
  try {
    const ledgerFile = backupLedgerPath(fixture.paths);
    const record = takeBackup({
      storeFile: seededStore(fixture),
      destDir: join(fixture.root, 'vault'),
      ledgerFile,
      at: AT,
    });

    // The record survives the copy: the ledger is a pointer that gets
    // re-checked, never a claim that gets repeated.
    rmSync(record.file);

    assert.equal(lastBackup(ledgerFile)?.present, false);
    const line = backupDisclosure(ledgerFile, LATER);
    assert.match(line, /is no longer at/);
    assert.match(line, /take a fresh one with: construct backup <dir>/);
  } finally {
    fixture.cleanup();
  }
});

test('a hand-mangled ledger line costs one entry, not the ability to ask', () => {
  const fixture = sterile();
  try {
    const ledgerFile = backupLedgerPath(fixture.paths);
    const record = takeBackup({
      storeFile: seededStore(fixture),
      destDir: join(fixture.root, 'vault'),
      ledgerFile,
      at: AT,
    });
    writeFileSync(ledgerFile, `${readFileSync(ledgerFile, 'utf8')}{ not json at all\n\n`);

    assert.equal(lastBackup(ledgerFile)?.record.file, record.file);
    assert.match(backupDisclosure(ledgerFile, LATER), /^last copy taken 3 days ago: /);
  } finally {
    fixture.cleanup();
  }
});

test('a copy carries what the store committed, including writes still held in the write-ahead log', () => {
  const fixture = sterile();
  try {
    const storeFile = seededStore(fixture);
    const store = openStore(storeFile);
    try {
      appendWorkLog(store, {
        run: 'run-1',
        task: null,
        role: 'engineer',
        action: 'noted',
        detail: 'committed but not yet folded back into the main file',
        at: LATER,
      });

      // Taken while the original is still open, which is when the newest
      // commits live in the sidecar rather than in the store file itself.
      const record = takeBackup({
        storeFile,
        destDir: join(fixture.root, 'vault'),
        ledgerFile: backupLedgerPath(fixture.paths),
        at: LATER,
      });

      const copy = openStore(record.file);
      try {
        assert.deepEqual(
          readWorkLog(copy, 'run-1').map((entry) => entry.detail),
          ['the entry a copy has to carry', 'committed but not yet folded back into the main file'],
        );
      } finally {
        copy.close();
      }
    } finally {
      store.close();
    }
  } finally {
    fixture.cleanup();
  }
});
