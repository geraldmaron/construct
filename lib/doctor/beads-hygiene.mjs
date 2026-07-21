/**
 * lib/doctor/beads-hygiene.mjs — beads drift doctor line, scoped to active tracker use.
 *
 * Skips entirely when the project has no .beads/ directory so tiny or
 * tracker-free projects never see scary lock/drift messaging.
 */

import fs from 'node:fs';
import path from 'node:path';

/**
 * @param {string} projectDir
 * @param {{ detectBeadsDrift?: () => { counts: { stuckInProgress: number, mergeDrift: number, staleOpen: number } } }} [opts]
 * @returns {{ run: boolean, pass: boolean, label: string, optional: boolean }}
 */
export function checkBeadsHygieneForDoctor(projectDir, { detectBeadsDrift } = {}) {
  const beadsDir = path.join(projectDir, '.beads');
  if (!fs.existsSync(beadsDir)) {
    return { run: false, pass: true, label: '', optional: true };
  }

  if (!detectBeadsDrift) {
    return { run: false, pass: true, label: '', optional: true };
  }

  const drift = detectBeadsDrift();
  const ok = drift.counts.stuckInProgress === 0 && drift.counts.mergeDrift === 0;
  let label = 'Beads hygiene: no drift';
  if (!ok) {
    const parts = [];
    if (drift.counts.stuckInProgress > 0) parts.push(`${drift.counts.stuckInProgress} stuck in_progress`);
    if (drift.counts.mergeDrift > 0) parts.push(`${drift.counts.mergeDrift} possible merge-drift`);
    label = `Beads hygiene: ${parts.join(', ')} — run \`construct beads drift\``;
  } else if (drift.counts.staleOpen > 0) {
    label = `Beads hygiene: ${drift.counts.staleOpen} stale-open (advisory) — run \`construct beads drift\``;
  }

  return { run: true, pass: ok, label, optional: true };
}
