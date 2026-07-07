/**
 * lib/intake/daemon.mjs — Continuous intake daemon with safeguards.
 *
 * Polls the canonical project-root `inbox/` for new files, classifies them via
 * the existing intake classifier, and writes packets to `.construct/intake/pending/`.
 * Packets past their TTL move to `.construct/intake/dead-letter/`; failed
 * classification retries up to the budget then dead-letters with the reason.
 *
 * Every tick also sweeps the persisted `.construct/intake/pending/` packets
 * (sweepPendingPackets): a packet whose `intake.sourcePath` is missing from
 * disk, or whose age exceeds classifyPacket's TTL, moves to
 * `.construct/intake/dead-letter/` with a `deadLetterReason`. This covers persisted
 * packets, not just in-flight inbox files, so the TTL/dead-letter contract
 * above applies to the whole pending queue.
 *
 * Atomic handoff (ADR-0045 §C): only complete top-level files are enqueued.
 * Dotfiles and the `inbox/.staging/` assembly directory are skipped, so a file
 * a writer is still staging is invisible until it is renamed into `inbox/`.
 *
 * Built on lib/daemons/contract.mjs — every safeguard (bounded lifetime,
 * idle shutdown, heartbeat, killswitch, single-writer lock) applies.
 */

import { readdirSync, statSync, readFileSync, writeFileSync, renameSync, unlinkSync, existsSync, mkdirSync } from 'node:fs';
import { join, basename } from 'node:path';

import { createDaemon, classifyPacket } from '../daemons/contract.mjs';
import { memoryCapMbFor } from '../resources/process-budget.mjs';
import { resolveStatePath } from '../state-root.mjs';
import { configPath } from '../config-dir.mjs';

const KILLSWITCH_ENV = 'CONSTRUCT_INTAKE_DAEMON';

function inboxDir(cwd) { return join(cwd, 'inbox'); }
function pendingDir(cwd) { return configPath(cwd, 'intake', 'pending'); }
function deadLetterDir(cwd) { return configPath(cwd, 'intake', 'dead-letter'); }
function heartbeatPath(cwd) { return resolveStatePath(cwd, 'runtime', 'intake-daemon.heartbeat'); }

function ensureDir(dir) {
  try { mkdirSync(dir, { recursive: true }); } catch { /* ignore */ }
}

// A writer staging into `inbox/.staging/` and renaming into `inbox/` is the
// atomic handoff. As a backstop for writers that drop in place, a file whose
// size is still moving between two stats is mid-write — skip it this tick.

function isSizeStable(full) {
  try {
    const a = statSync(full);
    const b = statSync(full);
    return a.size === b.size;
  } catch {
    return false;
  }
}

function listInboxFiles(cwd) {
  const dir = inboxDir(cwd);
  if (!existsSync(dir)) return [];
  let entries;
  try { entries = readdirSync(dir, { withFileTypes: true }); } catch { return []; }

  // Only complete top-level files: dotfiles (and the `.staging/` assembly dir)
  // are skipped, so a file a writer is still staging is invisible until rename.

  return entries
    .filter((e) => e.isFile() && !e.name.startsWith('.'))
    .map((e) => join(dir, e.name))
    .filter((full) => isSizeStable(full));
}

function pendingPacketFiles(cwd) {
  const dir = pendingDir(cwd);
  if (!existsSync(dir)) return [];
  try { return readdirSync(dir).filter((name) => name.endsWith('.json')); }
  catch { return []; }
}

function readPacketFile(cwd, name) {
  try { return JSON.parse(readFileSync(join(pendingDir(cwd), name), 'utf8')); }
  catch { return null; }
}

function packetSourcePath(packet) {
  return packet?.intake?.sourcePath || packet?.sourcePath || null;
}

function packetFirstSeenAt(packet) {
  return packet?.firstSeenAt || packet?.createdAt || null;
}

// processInboxFile renames its source into a `.<name>.consumed` marker inside
// pendingDir once a packet is written, so the original sourcePath disappears
// the moment ingestion succeeds. That disappearance is expected, not an
// orphan — the sweep must not dead-letter a packet on the very next tick
// just because its own consumption already moved the source out of the way.

function hasConsumedMarker(cwd, sourcePath) {
  return existsSync(join(pendingDir(cwd), `.${basename(sourcePath)}.consumed`));
}

// A pending packet is keyed by the source file it came from, independent of
// which ingest path wrote it (flat `sourcePath` here, nested
// `intake.sourcePath` for packets from lib/intake/prepare.mjs). Finding a
// live match lets re-ingestion refresh in place instead of writing a sibling
// packet for the same source.

function findExistingPendingBySource(cwd, sourcePath) {
  for (const name of pendingPacketFiles(cwd)) {
    const data = readPacketFile(cwd, name);
    if (data && packetSourcePath(data) === sourcePath) return { name, data };
  }
  return null;
}

/**
 * Process one inbox file: classify, persist packet to pending, remove the
 * inbox source on success, or move to dead-letter on persistent failure.
 * A file whose sourcePath already has a live pending packet refreshes that
 * packet in place rather than writing a second one for the same source.
 *
 * Returns one of:
 *   { didWork: true,  route: 'pending'|'dead-letter', packetId }
 *   { didWork: false, reason }
 */
export async function processInboxFile(filePath, { cwd, classify, now = () => new Date() }) {
  ensureDir(pendingDir(cwd));
  ensureDir(deadLetterDir(cwd));

  let body;
  try { body = readFileSync(filePath, 'utf8'); }
  catch (err) { return { didWork: false, reason: `read failed: ${err.message}` }; }

  const existing = findExistingPendingBySource(cwd, filePath);
  const id = existing?.data?.id || `intake-${now().getTime()}-${Math.random().toString(36).slice(2, 8)}`;
  const packet = {
    id,
    firstSeenAt: existing?.data?.firstSeenAt || new Date(statSync(filePath).mtimeMs).toISOString(),
    sourcePath: filePath,
    excerpt: body.slice(0, 500),
    attempts: 0,
  };

  const decision = classifyPacket(packet);
  if (decision.route === 'dead-letter') {
    return persistDeadLetter(filePath, packet, decision.reason, cwd);
  }

  try {
    packet.triage = await classify({ sourcePath: filePath, extractedText: body });
  } catch (err) {
    packet.attempts++;
    packet.lastError = err.message;
    if (packet.attempts >= 3) {
      return persistDeadLetter(filePath, packet, 'retry-budget-exhausted', cwd);
    }
    return { didWork: false, reason: `classify failed, will retry: ${err.message}` };
  }

  packet.lastSeenAt = now().toISOString();
  const packetName = existing?.name || `${id}.json`;
  const packetPath = join(pendingDir(cwd), packetName);
  writeFileSync(packetPath, JSON.stringify(packet, null, 2));
  try {
    const consumedPath = join(pendingDir(cwd), `.${basename(filePath)}.consumed`);
    renameSync(filePath, consumedPath);
  } catch { /* ignore consume failure */ }
  return { didWork: true, route: 'pending', packetId: id, refreshed: !!existing };
}

function persistDeadLetter(filePath, packet, reason, cwd) {
  const dlPath = join(deadLetterDir(cwd), `${packet.id}.json`);
  writeFileSync(dlPath, JSON.stringify({ ...packet, deadLetterReason: reason, deadLetteredAt: new Date().toISOString() }, null, 2));
  try { renameSync(filePath, join(deadLetterDir(cwd), `.source.${basename(filePath)}`)); } catch { /* ignore */ }
  return { didWork: true, route: 'dead-letter', packetId: packet.id, reason };
}

/**
 * Sweep persisted `.construct/intake/pending/` packets: one whose source file is
 * missing from disk, or whose age exceeds classifyPacket's TTL, moves to
 * `.construct/intake/dead-letter/` with a `deadLetterReason`. Runs every tick
 * alongside the inbox scan so packets written by any ingest path (not just
 * processInboxFile) are covered — the daemon's TTL/dead-letter contract
 * otherwise only reaches packets still in flight through the inbox.
 *
 * Returns the list of { id, reason } packets moved.
 */
export function sweepPendingPackets(cwd, { now = () => new Date() } = {}) {
  const swept = [];
  for (const name of pendingPacketFiles(cwd)) {
    const packet = readPacketFile(cwd, name);
    if (!packet) continue;

    const sourcePath = packetSourcePath(packet);
    const sourceMissing = !!sourcePath && !existsSync(sourcePath) && !hasConsumedMarker(cwd, sourcePath);
    const decision = classifyPacket({ firstSeenAt: packetFirstSeenAt(packet), attempts: packet.attempts || 0 });

    let reason = null;
    if (sourceMissing) reason = 'source-missing';
    else if (decision.route === 'dead-letter') reason = 'ttl-expired';
    if (!reason) continue;

    ensureDir(deadLetterDir(cwd));
    const dlPath = join(deadLetterDir(cwd), name);
    writeFileSync(dlPath, JSON.stringify({ ...packet, deadLetterReason: reason, deadLetteredAt: now().toISOString() }, null, 2));
    try { unlinkSync(join(pendingDir(cwd), name)); } catch { /* leave the dead-letter copy even if cleanup fails */ }
    swept.push({ id: packet.id || name.replace(/\.json$/, ''), reason });
  }
  return swept;
}

/**
 * Build a DaemonRunner for the intake daemon. Caller is responsible for
 * calling .run() — typically construct intake daemon start.
 */
export function buildIntakeDaemon({ cwd = process.cwd(), intervalMs = 60_000, classify } = {}) {
  const classifyFn = classify || (async () => ({ intakeType: 'unknown', rdStage: 'triage', primaryOwner: 'product-manager', recommendedAction: 'review' }));
  return createDaemon({
    name: 'intake',
    intervalMs,
    killswitchEnv: KILLSWITCH_ENV,
    heartbeatPath: heartbeatPath(cwd),
    maxRuntimeMs: 24 * 60 * 60 * 1000,
    maxIdleTicks: 6,
    memoryCapMb: memoryCapMbFor('intake', cwd),
    async tick() {
      const swept = sweepPendingPackets(cwd);
      const files = listInboxFiles(cwd);
      let workedAny = swept.length > 0;
      for (const file of files) {
        const result = await processInboxFile(file, { cwd, classify: classifyFn });
        if (result.didWork) workedAny = true;
      }
      return { didWork: workedAny };
    },
  });
}
