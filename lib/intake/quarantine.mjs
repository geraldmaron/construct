/**
 * lib/intake/quarantine.mjs — low-confidence intake quarantine + learned-fixture loop.
 *
 * When the classifier is uncertain (low confidence or close margin between
 * top-2 candidates), the packet should not auto-route to pending where a
 * downstream specialist might act on a confident-looking-but-wrong label.
 * Instead it lands in `.construct/intake/quarantine/` and waits for human review
 * via `construct intake quarantine show <id>` + `construct intake reroute`.
 *
 * The reroute path writes a fixture into tests/fixtures/intake/learned/
 * keyed by content hash. CI loads these fixtures alongside the golden
 * corpus and asserts the classifier handles them correctly. The override
 * thus becomes durable — the same wrong call cannot happen twice without
 * also failing CI.
 *
 * Determinism contract preserved: the daemon never reads the learned
 * fixtures at runtime; only tests do. Classification stays a pure function
 * of (sourcePath, extractedText, related, profile).
 */

import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { CONFIG_DIR_NAME } from '../config-dir.mjs';

const QUEUE_SUBDIR = `${CONFIG_DIR_NAME}/intake`;

// Quarantine thresholds. A packet with a winning candidate still lands in
// quarantine when either bar fails. Conservative defaults: 0.60 confidence
// and 0.20 margin cover the demonstrated failure cases without flooding
// quarantine for borderline-but-defensible classifications.
export const QUARANTINE_CONFIDENCE_THRESHOLD = 0.60;
export const QUARANTINE_MARGIN_THRESHOLD = 0.20;

export function quarantineDir(rootDir) {
  return path.join(rootDir, QUEUE_SUBDIR, 'quarantine');
}

/**
 * Decide whether a triage result should be routed to quarantine.
 * Returns { quarantine: boolean, reason?: string }.
 */
export function shouldQuarantine(triage) {
  if (!triage || triage.intakeType === 'unknown') {
    return { quarantine: false }; // unknown is its own bucket; not quarantine
  }
  const confidence = typeof triage.confidence === 'number' ? triage.confidence : 1;
  if (confidence < QUARANTINE_CONFIDENCE_THRESHOLD) {
    return { quarantine: true, reason: `confidence ${confidence.toFixed(2)} < ${QUARANTINE_CONFIDENCE_THRESHOLD}` };
  }
  if (Array.isArray(triage.candidates) && triage.candidates.length >= 2) {
    const margin = triage.candidates[0].score - triage.candidates[1].score;
    if (margin < QUARANTINE_MARGIN_THRESHOLD) {
      return { quarantine: true, reason: `margin ${margin.toFixed(2)} < ${QUARANTINE_MARGIN_THRESHOLD}` };
    }
  }
  return { quarantine: false };
}

/**
 * Hash content for fixture deduplication. Uses the same input the classifier
 * sees so two packets with identical signal produce one fixture.
 */
export function fixtureHash(sourcePath, extractedText) {
  const h = createHash('sha256');
  h.update(String(sourcePath || ''));
  h.update('\n--\n');
  h.update(String(extractedText || '').slice(0, 8000));
  return h.digest('hex').slice(0, 16);
}

/**
 * Write a learned-fixture file recording the human-chosen classification.
 * Called by `construct intake reroute`. Idempotent — overwrites with the
 * latest reroute decision (the most recent human call is authoritative).
 *
 * @param {string} rootDir - repo root where tests/fixtures/intake/learned lives
 * @param {object} packet - the quarantined packet being rerouted
 * @param {string} expectedType - intakeType the human picked
 * @returns {{ filePath: string, hash: string }}
 */
export function writeLearnedFixture(rootDir, packet, expectedType) {
  const sourcePath = packet?.intake?.sourcePath || packet?.sourcePath || '';
  const text = packet?.excerpt || '';
  const hash = fixtureHash(sourcePath, text);
  const dir = path.join(rootDir, 'tests', 'fixtures', 'intake', 'learned');
  mkdirSync(dir, { recursive: true });
  const filePath = path.join(dir, `${hash}.json`);
  const fixture = {
    content_hash: `sha256:${hash}`,
    source_path: sourcePath,
    text_snippet: text.slice(0, 500),
    expected: { intakeType: expectedType },
    origin: 'user-reroute',
    created_at: new Date().toISOString(),
    packet_id: packet?.id || null,
  };
  writeFileSync(filePath, JSON.stringify(fixture, null, 2) + '\n', 'utf8');
  return { filePath, hash };
}

/**
 * List all learned fixtures (for the calibration test). Returns an array
 * of { content_hash, source_path, text_snippet, expected, ... } objects.
 */
export function loadLearnedFixtures(rootDir) {
  const dir = path.join(rootDir, 'tests', 'fixtures', 'intake', 'learned');
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((name) => name.endsWith('.json'))
    .map((name) => {
      try { return JSON.parse(readFileSync(path.join(dir, name), 'utf8')); }
      catch { return null; }
    })
    .filter(Boolean);
}

/**
 * Write a quarantined packet to disk. Mirrors the structure of pending/
 * packets so `intake show` / `intake reroute` can read either location.
 */
export function writeQuarantinePacket(rootDir, packet, quarantineReason) {
  const dir = quarantineDir(rootDir);
  mkdirSync(dir, { recursive: true });
  const id = packet.id;
  if (!id) throw new Error('writeQuarantinePacket: packet.id required');
  const filePath = path.join(dir, `${id}.json`);
  const payload = {
    ...packet,
    status: 'quarantined',
    quarantinedAt: new Date().toISOString(),
    quarantineReason: quarantineReason || null,
  };
  writeFileSync(filePath, JSON.stringify(payload, null, 2) + '\n', 'utf8');
  return { id, filePath };
}

/**
 * List packets currently in quarantine. Same shape as listPending.
 */
export function listQuarantine(rootDir) {
  const dir = quarantineDir(rootDir);
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((name) => name.endsWith('.json'))
    .map((name) => {
      const filePath = path.join(dir, name);
      try {
        const data = JSON.parse(readFileSync(filePath, 'utf8'));
        return { ...data, filePath };
      } catch { return null; }
    })
    .filter(Boolean)
    .sort((a, b) => (a.quarantinedAt || '').localeCompare(b.quarantinedAt || ''));
}

/**
 * Read a single quarantined packet by id. Returns null if not found.
 */
export function readQuarantine(rootDir, id) {
  const filePath = path.join(quarantineDir(rootDir), `${id}.json`);
  if (!existsSync(filePath)) return null;
  try {
    const data = JSON.parse(readFileSync(filePath, 'utf8'));
    return { ...data, filePath };
  } catch { return null; }
}

/**
 * Move a quarantined packet to pending after a human reroute. Updates the
 * triage.intakeType + records the reroute history. Writes the learned
 * fixture as a side effect.
 *
 * Returns { id, filePath, fixturePath, fixtureHash } on success.
 */
export function rerouteQuarantined(rootDir, id, newType, { reroutedBy = 'unknown', reason = '' } = {}) {
  const packet = readQuarantine(rootDir, id);
  if (!packet) throw new Error(`reroute: no quarantined packet ${id}`);

  // Write learned fixture BEFORE moving — fixture creation must succeed for
  // the reroute to commit. If fixture write fails, the packet stays put so
  // the human can retry.
  const { filePath: fixturePath, hash } = writeLearnedFixture(rootDir, packet, newType);

  const updated = {
    ...packet,
    status: 'pending',
    triage: {
      ...(packet.triage || {}),
      intakeType: newType,
      originalIntakeType: packet.triage?.intakeType,
      reroutedAt: new Date().toISOString(),
      reroutedBy,
      rerouteReason: reason || null,
      rerouteFixtureHash: hash,
    },
  };
  delete updated.quarantinedAt;
  delete updated.quarantineReason;

  const pendingPath = path.join(rootDir, QUEUE_SUBDIR, 'pending', `${id}.json`);
  mkdirSync(path.dirname(pendingPath), { recursive: true });
  writeFileSync(pendingPath, JSON.stringify(updated, null, 2) + '\n', 'utf8');
  rmSync(packet.filePath);
  return { id, filePath: pendingPath, fixturePath, fixtureHash: hash };
}
