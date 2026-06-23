/**
 * lib/intake/daemon.mjs — Continuous intake daemon with safeguards.
 *
 * Polls the canonical project-root `inbox/` for new files, classifies them via
 * the existing intake classifier, and writes packets to `.cx/intake/pending/`.
 * Packets past their TTL move to `.cx/intake/dead-letter/`; failed
 * classification retries up to the budget then dead-letters with the reason.
 *
 * Atomic handoff (ADR-0045 §C): only complete top-level files are enqueued.
 * Dotfiles and the `inbox/.staging/` assembly directory are skipped, so a file
 * a writer is still staging is invisible until it is renamed into `inbox/`.
 *
 * Built on lib/daemons/contract.mjs — every safeguard (bounded lifetime,
 * idle shutdown, heartbeat, killswitch, single-writer lock) applies.
 */

import { readdirSync, statSync, readFileSync, writeFileSync, renameSync, existsSync, mkdirSync } from 'node:fs';
import { join, basename } from 'node:path';
import { homedir } from 'node:os';

import { createDaemon, classifyPacket } from '../daemons/contract.mjs';
import { memoryCapMbFor } from '../resources/process-budget.mjs';

const KILLSWITCH_ENV = 'CONSTRUCT_INTAKE_DAEMON';

function inboxDir(cwd) { return join(cwd, 'inbox'); }
function pendingDir(cwd) { return join(cwd, '.cx', 'intake', 'pending'); }
function deadLetterDir(cwd) { return join(cwd, '.cx', 'intake', 'dead-letter'); }
function heartbeatPath() { return join(homedir(), '.construct', 'intake-daemon.heartbeat'); }

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

/**
 * Process one inbox file: classify, persist packet to pending, remove the
 * inbox source on success, or move to dead-letter on persistent failure.
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

  const id = `intake-${now().getTime()}-${Math.random().toString(36).slice(2, 8)}`;
  const packet = {
    id,
    firstSeenAt: new Date(statSync(filePath).mtimeMs).toISOString(),
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

  const packetPath = join(pendingDir(cwd), `${id}.json`);
  writeFileSync(packetPath, JSON.stringify(packet, null, 2));
  try {
    const consumedPath = join(pendingDir(cwd), `.${basename(filePath)}.consumed`);
    renameSync(filePath, consumedPath);
  } catch { /* ignore consume failure */ }
  return { didWork: true, route: 'pending', packetId: id };
}

function persistDeadLetter(filePath, packet, reason, cwd) {
  const dlPath = join(deadLetterDir(cwd), `${packet.id}.json`);
  writeFileSync(dlPath, JSON.stringify({ ...packet, deadLetterReason: reason, deadLetteredAt: new Date().toISOString() }, null, 2));
  try { renameSync(filePath, join(deadLetterDir(cwd), `.source.${basename(filePath)}`)); } catch { /* ignore */ }
  return { didWork: true, route: 'dead-letter', packetId: packet.id, reason };
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
    heartbeatPath: heartbeatPath(),
    maxRuntimeMs: 24 * 60 * 60 * 1000,
    maxIdleTicks: 6,
    memoryCapMb: memoryCapMbFor('intake', cwd),
    async tick() {
      const files = listInboxFiles(cwd);
      if (files.length === 0) return { didWork: false };
      let workedAny = false;
      for (const file of files) {
        const result = await processInboxFile(file, { cwd, classify: classifyFn });
        if (result.didWork) workedAny = true;
      }
      return { didWork: workedAny };
    },
  });
}
