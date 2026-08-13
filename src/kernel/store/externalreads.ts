/**
 * kernel/store/externalreads.ts — what a role read that no declared source
 * holds: the provenance class for research done through the host's own tools.
 *
 * Construct builds no connectors and fetches nothing. A role dispatched into a
 * host that has web access will nonetheless go and read the standard, the
 * vendor's documentation, the regulation — and that reading produced no row
 * anywhere. The result was a deliverable half-grounded in a declared
 * repository, with provenance for that half and silence for the other, while
 * the fabricated-provenance gate looked only at declared sources and saw
 * nothing wrong. Silence that reads as "grounded in your material" is the
 * failure this closes.
 *
 * What this records is what the host reported reading. It is not a claim that
 * the page said what the role says it said, and nothing here fetches anything
 * to check: an external read is testimony, and it is stored as testimony so a
 * reader can weigh it differently from a document the survey walked. Append
 * only, enforced by triggers, for the same reason every other provenance table
 * is: evidence that can be edited afterwards is evidence for whatever it says
 * now.
 */

import type { Store } from './open.ts';

export interface ExternalRead {
  readonly run: string;
  readonly task: string | null;
  /** The role that reported it, in its own name. */
  readonly role: string;
  /** Where it read: a URL, a standard's designation, a document's title. */
  readonly locator: string;
  /** What it took from there, in words a reader can weigh against the claim. */
  readonly took: string;
  readonly recordedAt: string;
}

interface Row {
  readonly run: string;
  readonly task: string | null;
  readonly role: string;
  readonly locator: string;
  readonly took: string;
  readonly recorded_at: string;
}

function toExternalRead(row: Row): ExternalRead {
  return {
    run: row.run,
    task: row.task,
    role: row.role,
    locator: row.locator,
    took: row.took,
    recordedAt: row.recorded_at,
  };
}

/**
 * Record one external read. Both fields are required and neither may be
 * blank: a locator with nothing taken from it is a claim to have been
 * somewhere, and something taken from nowhere is the fabrication this table
 * would otherwise legitimize.
 */
export function recordExternalRead(store: Store, read: ExternalRead): void {
  if (read.locator.trim() === '') throw new Error('recordExternalRead: no locator');
  if (read.took.trim() === '') throw new Error('recordExternalRead: nothing was taken from it');
  store.db
    .prepare(
      `INSERT INTO external_reads (run, task, role, locator, took, recorded_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
    )
    .run(read.run, read.task, read.role, read.locator.trim(), read.took.trim(), read.recordedAt);
}

/** Everything a run read outside its declared ground, oldest first. */
export function externalReadsFor(store: Store, run: string): ExternalRead[] {
  const rows = store.db
    .prepare('SELECT * FROM external_reads WHERE run = ? ORDER BY seq')
    .all(run) as unknown as Row[];
  return rows.map(toExternalRead);
}
