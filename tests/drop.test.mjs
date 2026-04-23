/**
 * tests/drop.test.mjs — tests for lib/drop.mjs candidate collection.
 *
 * Exercises collectCandidates against a temp-dir fixture so no real
 * ~/Downloads state is touched. Covers recency filtering, extension
 * filtering, hidden-file rejection, mtime sort order, and the limit cap.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, utimesSync, rmSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { collectCandidates } from '../lib/drop.mjs';

function makeFixture() {
  const dir = mkdtempSync(join(tmpdir(), 'construct-drop-test-'));
  const write = (name, mtimeMs) => {
    const full = join(dir, name);
    writeFileSync(full, 'x');
    const secs = mtimeMs / 1000;
    utimesSync(full, secs, secs);
    return full;
  };
  return { dir, write, cleanup: () => rmSync(dir, { recursive: true, force: true }) };
}

test('drop.collectCandidates: sorts by mtime desc, honors sinceMs cutoff', () => {
  const { dir, write, cleanup } = makeFixture();
  try {
    const now = Date.now();
    write('old.pdf', now - 2 * 60 * 60 * 1000);   // 2h ago
    write('new.pdf', now - 5 * 60 * 1000);         // 5m ago
    write('middle.pdf', now - 30 * 60 * 1000);     // 30m ago

    const result = collectCandidates({
      dirs: [dir],
      sinceMs: 60 * 60 * 1000,  // 1 hour window — excludes old.pdf
      now,
    });
    const names = result.map((r) => r.name);
    assert.deepEqual(names, ['new.pdf', 'middle.pdf']);
  } finally {
    cleanup();
  }
});

test('drop.collectCandidates: filters by extension', () => {
  const { dir, write, cleanup } = makeFixture();
  try {
    const now = Date.now();
    write('report.pdf', now - 1000);
    write('notes.md', now - 1000);
    write('data.xlsx', now - 1000);

    const pdfOnly = collectCandidates({
      dirs: [dir],
      sinceMs: 60 * 60 * 1000,
      extensionFilter: 'pdf',
      now,
    });
    assert.equal(pdfOnly.length, 1);
    assert.equal(pdfOnly[0].name, 'report.pdf');
  } finally {
    cleanup();
  }
});

test('drop.collectCandidates: skips hidden files', () => {
  const { dir, write, cleanup } = makeFixture();
  try {
    const now = Date.now();
    write('.DS_Store', now - 1000);
    write('visible.pdf', now - 1000);

    const result = collectCandidates({
      dirs: [dir],
      sinceMs: 60 * 60 * 1000,
      now,
    });
    const names = result.map((r) => r.name);
    assert.ok(!names.includes('.DS_Store'), 'hidden files excluded');
    assert.ok(names.includes('visible.pdf'), 'visible files included');
  } finally {
    cleanup();
  }
});

test('drop.collectCandidates: respects limit', () => {
  const { dir, write, cleanup } = makeFixture();
  try {
    const now = Date.now();
    for (let i = 0; i < 15; i += 1) {
      write(`file${i}.txt`, now - i * 1000);
    }
    const result = collectCandidates({
      dirs: [dir],
      sinceMs: 60 * 60 * 1000,
      limit: 5,
      now,
    });
    assert.equal(result.length, 5);
  } finally {
    cleanup();
  }
});

test('drop.collectCandidates: handles missing directories gracefully', () => {
  const result = collectCandidates({
    dirs: ['/nonexistent/path/that/does/not/exist'],
    sinceMs: 60 * 60 * 1000,
  });
  assert.deepEqual(result, []);
});

test('drop.collectCandidates: skips non-extractable files', () => {
  const { dir, write, cleanup } = makeFixture();
  try {
    const now = Date.now();
    write('binary.bin', now - 1000);      // not extractable
    write('archive.zip', now - 1000);     // not extractable
    write('document.pdf', now - 1000);    // extractable

    const result = collectCandidates({
      dirs: [dir],
      sinceMs: 60 * 60 * 1000,
      now,
    });
    const names = result.map((r) => r.name);
    assert.ok(names.includes('document.pdf'));
    assert.ok(!names.includes('binary.bin'));
    assert.ok(!names.includes('archive.zip'));
  } finally {
    cleanup();
  }
});
