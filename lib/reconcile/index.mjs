/**
 * lib/reconcile/index.mjs — registry of state-reconciliation tasks that
 * bring on-disk state in line with the expected disposition contract
 * (ADR-0027). Separate from lib/migrations/ (artifact-JSON schema
 * versioning) and lib/storage/migrations.mjs (Postgres schema).
 *
 * Each task declares: id (kebab), description (one line), safety
 * (`auto` = run silently from `construct sync` when detect() reports
 * needsRepair; `ask` = surfaced by `construct doctor` and runs only on
 * explicit `construct sync --reconcile=<id>`), detect() (async, cheap,
 * side-effect-free, returns { needsRepair, summary, ... }), and apply()
 * (async, idempotent, returns { summary }).
 *
 * Two invariants every task must hold:
 *   1. Never touch a user-authored file without consent — `safety: 'ask'`
 *      gates anything that could remove user edits, and detect() must
 *      exclude paths whose mtime suggests user interaction.
 *   2. Calling detect() after apply() must return needsRepair: false on
 *      the same input. A task that would loop is a detection bug — the
 *      stamp file is a hint and a record, not a correctness guard.
 *
 * Stamps land at ~/.construct/reconcile.json so the dashboard and doctor
 * can show what's been applied; loss of the file does not break apply()
 * (apply() stays idempotent on its own).
 */

import fs from 'node:fs';
import path from 'node:path';

import { constructDir } from '../paths.mjs';
import legacySkillsCleanup from './legacy-skills-cleanup.mjs';
import gitignoreCoverage from './gitignore-coverage.mjs';
import agentInstructionsRewrap from './agent-instructions-rewrap.mjs';
import legacyDoctrineStrip from './legacy-doctrine-strip.mjs';
import legacyGuideDecommit from './legacy-guide-decommit.mjs';
import legacyLayoutMigration from './legacy-layout-migration.mjs';
import mcpEntryReconcile from './mcp-entry-reconcile.mjs';
import adapterPrune from './adapter-prune.mjs';

export const RECONCILIATIONS = [
  legacySkillsCleanup,
  gitignoreCoverage,
  agentInstructionsRewrap,
  legacyDoctrineStrip,
  legacyGuideDecommit,
  legacyLayoutMigration,
  mcpEntryReconcile,
  adapterPrune,
];

const STAMP_FILE = 'reconcile.json';

function stampPath() {
  return path.join(constructDir(), STAMP_FILE);
}

function readStamps() {
  try {
    const raw = fs.readFileSync(stampPath(), 'utf8');
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' && parsed.applied
      ? parsed
      : { applied: {} };
  } catch {
    return { applied: {} };
  }
}

function writeStamp(id, summary) {
  const stamps = readStamps();
  stamps.applied[id] = { at: new Date().toISOString(), summary };
  try {
    fs.mkdirSync(path.dirname(stampPath()), { recursive: true });
    fs.writeFileSync(stampPath(), JSON.stringify(stamps, null, 2));
  } catch {
    // Stamp failure is non-fatal — apply() must be idempotent so a missing
    // stamp just means the next detect() catches the same state again.
  }
}

async function safeDetect(task) {
  try {
    const result = await task.detect();
    return result && typeof result === 'object'
      ? { needsRepair: !!result.needsRepair, summary: result.summary || null, details: result.details || null }
      : { needsRepair: false, summary: null, details: null };
  } catch (err) {
    return { needsRepair: false, summary: null, details: null, error: err.message };
  }
}

export async function listReconciliations() {
  const stamps = readStamps();
  const out = [];
  for (const task of RECONCILIATIONS) {
    const detected = await safeDetect(task);
    out.push({
      id: task.id,
      description: task.description,
      safety: task.safety,
      needsRepair: detected.needsRepair,
      summary: detected.summary,
      details: detected.details,
      error: detected.error || null,
      previouslyApplied: !!stamps.applied[task.id],
      appliedAt: stamps.applied[task.id]?.at || null,
    });
  }
  return out;
}

export async function runAutoReconciliations({ dryRun = false, verbose = false, logger = console } = {}) {
  const applied = [];
  const skipped = [];
  for (const task of RECONCILIATIONS) {
    if (task.safety !== 'auto') {
      skipped.push({ id: task.id, reason: 'safety:ask' });
      continue;
    }
    const detected = await safeDetect(task);
    if (detected.error) {
      skipped.push({ id: task.id, reason: `detect-error:${detected.error}` });
      continue;
    }
    if (!detected.needsRepair) {
      skipped.push({ id: task.id, reason: 'no-op' });
      continue;
    }
    if (dryRun) {
      applied.push({ id: task.id, summary: detected.summary, dryRun: true });
      if (verbose && logger?.log) logger.log(`[reconcile:${task.id}] would apply: ${detected.summary}`);
      continue;
    }
    try {
      const result = await task.apply();
      const summary = result?.summary || detected.summary || '';
      writeStamp(task.id, summary);
      applied.push({ id: task.id, summary });
      if (verbose && logger?.log) logger.log(`[reconcile:${task.id}] ${summary}`);
    } catch (err) {
      skipped.push({ id: task.id, reason: `apply-error:${err.message}` });
      if (verbose && logger?.error) logger.error(`[reconcile:${task.id}] failed: ${err.message}`);
    }
  }
  return { applied, skipped };
}

export async function runReconciliation(id, { dryRun = false } = {}) {
  const task = RECONCILIATIONS.find((x) => x.id === id);
  if (!task) {
    return { ok: false, reason: `Unknown reconciliation: ${id}`, available: RECONCILIATIONS.map((x) => x.id) };
  }
  const detected = await safeDetect(task);
  if (detected.error) return { ok: false, reason: `detect-error:${detected.error}` };
  if (!detected.needsRepair) {
    return { ok: true, ran: false, reason: 'no-op', summary: detected.summary || 'Nothing to reconcile.' };
  }
  if (dryRun) return { ok: true, ran: false, dryRun: true, summary: detected.summary };
  try {
    const result = await task.apply();
    const summary = result?.summary || detected.summary || '';
    writeStamp(id, summary);
    return { ok: true, ran: true, summary };
  } catch (err) {
    return { ok: false, ran: false, reason: `apply-error:${err.message}` };
  }
}

export function reconcileStampPath() {
  return stampPath();
}
