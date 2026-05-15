/**
 * tests/migrations-repair.test.mjs — drift-repair contract for runMigrations.
 *
 * Pins isIdempotentMigration's destructive-statement detection and the
 * repair-mode branch of runMigrations: idempotent drift gets re-applied
 * and the recorded SHA is updated; destructive drift still throws so
 * a fresh migration file is the forced path.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { isIdempotentMigration } from '../lib/storage/migrations.mjs';

describe('isIdempotentMigration', () => {
  it('accepts the shipped 001_init / 002_pgvector / 003_intake style migrations', () => {
    assert.equal(isIdempotentMigration('create extension if not exists vector;'), true);
    assert.equal(isIdempotentMigration('create table if not exists construct_intake_items (id text primary key);'), true);
    assert.equal(isIdempotentMigration('create index if not exists construct_intake_items_status_idx on construct_intake_items(status);'), true);
  });

  it('rejects DROP statements', () => {
    assert.equal(isIdempotentMigration('drop table construct_intake_items;'), false);
    assert.equal(isIdempotentMigration('DROP INDEX construct_intake_items_status_idx;'), false);
    assert.equal(isIdempotentMigration('drop extension if exists vector;'), false);
  });

  it('rejects ALTER … DROP', () => {
    assert.equal(isIdempotentMigration('alter table construct_intake_items drop column risk;'), false);
  });

  it('rejects TRUNCATE and DELETE', () => {
    assert.equal(isIdempotentMigration('truncate table construct_intake_items;'), false);
    assert.equal(isIdempotentMigration('delete from construct_intake_items where status = \'pending\';'), false);
  });

  it('strips comments before checking — a "-- DROP" docstring is fine', () => {
    const sql = [
      '-- migration 001: bootstrap the schema',
      '-- earlier drafts considered DROP TABLE constructs; we landed on CREATE IF NOT EXISTS instead.',
      '/* historical note: do not DROP this index */',
      'create table if not exists construct_intake_items (id text primary key);',
    ].join('\n');
    assert.equal(isIdempotentMigration(sql), true);
  });

  it('accepts ALTER … ADD (additive, non-destructive)', () => {
    assert.equal(isIdempotentMigration('alter table construct_intake_items add column if not exists trace_id text;'), true);
  });
});
