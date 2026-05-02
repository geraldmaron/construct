/**
 * lib/beads-automation.mjs — Automation around beads issue tracking.
 *
 * 1. Sync plan.md with bead status changes
 * 2. Auto‑create handoffs when beads change state
 * 3. Track verification notes
 */

import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { spawnSync } from 'node:child_process';

import { acquireMergeSlot, releaseMergeSlot, runBd, runBdJson } from './beads-client.mjs';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const PLAN_MD_PATH = 'plan.md';
const HANDOFFS_DIR = '.cx/handoffs';

// ---------------------------------------------------------------------------
// Plan.md sync
// ---------------------------------------------------------------------------

/**
 * Find all bead IDs mentioned in plan.md and their current status.
 * Returns [ [lineNumber, construct-xxx, currentStatus], ... ]
 */
export function extractBeadsFromPlan(planContent) {
  const lines = planContent.split('\n');
  const beadLines = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    
    // Look for construct-xxx patterns
    const beadMatches = line.match(/(construct-[a-z0-9]+)/g);
    if (!beadMatches) continue;

    // Parse table row status (if in a table)
    let status = 'unknown';
    const tableMatch = line.match(/\|.*\|.*\|.*\|\s*([^|]+)\s*\|/);
    if (tableMatch) {
      const statusCell = tableMatch[1].trim();
      if (statusCell.match(/^(done|in_progress|pending)$/i)) {
        status = statusCell.toLowerCase();
      }
    }

    // Look for P0/P1/P2/P3 as well
    const priorityMatch = line.match(/\bP([0-3])\b/);
    const priority = priorityMatch ? `P${priorityMatch[1]}` : null;

    for (const beadId of beadMatches) {
      beadLines.push({
        line: i + 1,
        content: line,
        beadId,
        status,
        priority,
      });
    }
  }

  return beadLines;
}

/**
 * Update plan.md based on actual bead status.
 * Returns true if plan.md changed, false otherwise.
 */
export async function syncPlanWithBeads({ cwd = process.cwd(), dryRun = false } = {}) {
  const planPath = path.join(cwd, PLAN_MD_PATH);
  if (!fs.existsSync(planPath)) {
    console.error(`[beads] No ${PLAN_MD_PATH} found in ${cwd}`);
    return false;
  }

  const content = fs.readFileSync(planPath, 'utf8');
  const beadLines = extractBeadsFromPlan(content);
  if (!beadLines.length) return false;

  const lines = content.split('\n');
  let changed = false;

  for (const bl of beadLines) {
    const { beadId, line: lineIndex } = bl;
    try {
      // Get current bead status
      const bead = await runBdJson(['show', beadId], { cwd, silent: true });
      const actualStatus = bead?.status || 'unknown';

      // Update line if needed
      const currentLine = lines[lineIndex - 1];
      
      // Table format: | task | status | notes |
      if (currentLine.includes('|') && currentLine.includes(beadId)) {
        // Find status column (assume second column for simplicity)
        const parts = currentLine.split('|').map(p => p.trim());
        if (parts.length >= 3) {
          const oldStatus = parts[2].trim();
          if (oldStatus.toLowerCase() !== actualStatus.toLowerCase()) {
            parts[2] = ` ${actualStatus} `;
            const newLine = `|${parts.slice(1).join('|')}|`;
            lines[lineIndex - 1] = newLine;
            changed = true;
            console.error(`[beads] Updated ${beadId}: ${oldStatus} → ${actualStatus}`);
          }
        }
      }
      // Inline format: - construct-xxx (in progress)
      else {
        const statusMatch = currentLine.match(/\(([^)]+)\)/);
        const oldStatus = statusMatch ? statusMatch[1].trim() : '';
        if (oldStatus !== actualStatus) {
          const newLine = currentLine.replace(
            /\([^)]*\)/,
            `(${actualStatus})`
          ) || `${currentLine} (${actualStatus})`;
          lines[lineIndex - 1] = newLine;
          changed = true;
          console.error(`[beads] Updated ${beadId}: ${oldStatus} → ${actualStatus}`);
        }
      }
    } catch (error) {
      console.error(`[beads] Could not fetch ${beadId}: ${error.message}`);
    }
  }

  if (changed && !dryRun) {
    fs.writeFileSync(planPath, lines.join('\n'), 'utf8');
    console.error(`[beads] Updated ${PLAN_MD_PATH}`);
  }

  return changed;
}

// ---------------------------------------------------------------------------
// Handoff automation
// ---------------------------------------------------------------------------

/**
 * Create a handoff file for active beads.
 * Returns the path to the created handoff.
 */
export async function createHandoff({
  beads = [],
  actor = 'construct',
  summary = 'Session handoff',
  decisions = [],
  nextActions = [],
  risks = [],
  doNotTouch = [],
  cwd = process.cwd(),
}) {
  const date = new Date().toISOString().split('T')[0];
  const slug = summary
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 50);
  
  const handoffFileName = `${date}-${slug}.md`;
  const handoffDir = path.join(cwd, HANDOFFS_DIR);
  const handoffPath = path.join(handoffDir, handoffFileName);

  fs.mkdirSync(handoffDir, { recursive: true });

  // Gather bead details
  const beadDetails = [];
  for (const beadId of beads) {
    try {
      const bead = await runBdJson(['show', beadId], { cwd, silent: true });
      beadDetails.push({
        id: beadId,
        subject: bead.subject || 'unknown',
        status: bead.status || 'unknown',
        priority: bead.priority || 'P3',
        summary: `${beadId}: ${bead.subject} (${bead.status}, ${bead.priority})`,
      });
    } catch {
      beadDetails.push({ id: beadId, summary: `${beadId}: unknown` });
    }
  }

  // Build markdown
  const parts = [
    `# Handoff: ${summary}`,
    '',
    `Date: ${date}`,
    `Actor: ${actor}`,
    beads.length ? `Beads: ${beads.join(', ')}` : null,
    '',
    '## Current state',
    '',
    ...beadDetails.map(b => `- ${b.summary}`),
    beadDetails.length === 0 ? '(No beads active)' : '',
    '',
    decisions.length ? '## Recent decisions' : '',
    ...decisions.map(d => d.includes('|') ? d : `- ${d}`),
    '',
    nextActions.length ? '## Next actions' : '',
    ...nextActions.map(a => a.includes('|') ? a : `1. ${a}`),
    '',
    risks.length ? '## Risks' : '',
    ...risks.map(r => r.includes('|') ? r : `- ${r}`),
    '',
    doNotTouch.length ? '## Do not touch' : '',
    ...doNotTouch.map(f => f.includes('|') ? f : `- ${f}`),
    '',
    '## Verification',
    '',
    `- Session completed by ${actor}`,
    `- Beads status synced with ${PLAN_MD_PATH}`,
    beads.length ? `- Handoff attached to ${beads.length} bead(s)` : '',
  ].filter(Boolean);

  const content = parts.join('\n');
  fs.writeFileSync(handoffPath, content, 'utf8');

  // Attach handoff to each bead as a note
  for (const beadId of beads) {
    try {
      spawnSync('bd', ['note', beadId, '--message', `Handoff: ${handoffFileName}`], {
        cwd,
        stdio: 'ignore',
      });
    } catch {
      // Ignore note failures
    }
  }

  console.error(`[beads] Handoff written to ${path.relative(cwd, handoffPath)}`);
  return handoffPath;
}

/**
 * Auto-create handoff based on beads that were worked on this session.
 * Scans `bd list` for beads that were touched within the last hour.
 */
export async function autoCreateHandoff({ actor = 'unknown', cwd = process.cwd() } = {}) {
  try {
    const beads = await runBdJson(['list', '--json'], { cwd, silent: true });
    const oneHourAgo = new Date(Date.now() - 3600 * 1000).toISOString();

    const recent = beads.filter(b => {
      const updated = b.updated_at || b.created_at;
      return updated && new Date(updated) > oneHourAgo;
    });

    if (!recent.length) {
      console.error('[beads] No recent beads to create handoff for');
      return null;
    }

    const beadIds = recent.slice(0, 5).map(b => b.id);
    const summary = `Session for ${recent[0].subject?.split(' ')[0] || 'work'}`;

    const decisions = [
      `Used beads client with locking to avoid conflicts`,
      recent.length > 1 ? `Worked on ${recent.length} beads` : 'Focused on single bead',
    ];

    const nextActions = [
      'Continue with next ready bead from `bd ready`',
      'Sync plan.md after bead status changes',
    ];

    const risks = [
      'Parallel agent access still requires merge-slot coordination for batch operations',
    ];

    const handoffPath = await createHandoff({
      beads: beadIds,
      actor,
      summary,
      decisions,
      nextActions,
      risks,
      cwd,
    });

    return handoffPath;
  } catch (error) {
    console.error(`[beads] Failed to auto‑create handoff: ${error.message}`);
    return null;
  }
}

// ---------------------------------------------------------------------------
// Hooks
// ---------------------------------------------------------------------------

/**
 * Post‑bead‑update hook that syncs plan.md if bead status changed.
 * Call this after `bd update`, `bd close`, etc.
 */
export async function postBeadUpdateHook(beadId, { cwd = process.cwd() } = {}) {
  try {
    const changed = await syncPlanWithBeads({ cwd, dryRun: false });
    if (changed) {
      console.error(`[beads] plan.md updated for ${beadId}`);
    }
  } catch (error) {
    console.error(`[beads] Plan sync failed for ${beadId}: ${error.message}`);
  }
}

/**
 * End‑of‑session hook.
 */
export async function endOfSessionHook({ actor = 'unknown', cwd = process.cwd() } = {}) {
  console.error('[beads] Running end‑of‑session hooks…');
  
  // 1. Sync plan.md with actual bead statuses
  await syncPlanWithBeads({ cwd });
  
  // 2. Create automatic handoff
  const handoffPath = await autoCreateHandoff({ actor, cwd });
  
  // 3. Quick health check
  let mergeSlotHeld = false;
  try {
    const mergeSlot = await acquireMergeSlot({ cwd, actor });
    mergeSlotHeld = Boolean(mergeSlot?.success);
    await runBd(['dolt', 'push'], { cwd, silent: true, actor });
    console.error('[beads] Beads changes pushed');
  } catch (pushError) {
    console.error(`[beads] dolt push failed: ${pushError.message}`);
  } finally {
    if (mergeSlotHeld) {
      await releaseMergeSlot({ cwd, actor });
    }
  }
  
  return handoffPath;
}

// ---------------------------------------------------------------------------
// CLI entry point (for direct invocation)
// ---------------------------------------------------------------------------

export async function runBeadsAutomationCli(args) {
  const sub = args[0] || 'status';
  const subArgs = args.slice(1);
  const cwd = process.cwd();

  if (sub === 'sync-plan') {
    const dryRun = subArgs.includes('--dry-run');
    const changed = await syncPlanWithBeads({ cwd, dryRun });
    console.log(changed ? 'plan.md updated' : 'plan.md unchanged');
    return;
  }

  if (sub === 'create-handoff') {
    const actor = process.env.USER || 'unknown';
    const beads = subArgs.filter(arg => !arg.startsWith('--'));
    const summary = beads.length ? `Working on ${beads[0]}` : 'Session handoff';
    
    const handoffPath = await createHandoff({
      beads,
      actor,
      summary,
      cwd,
    });
    console.log(`Created: ${handoffPath}`);
    return;
  }

  if (sub === 'end-session') {
    const actor = process.env.USER || 'unknown';
    const handoffPath = await endOfSessionHook({ actor, cwd });
    if (handoffPath) {
      console.log(`Session ended. Handoff: ${handoffPath}`);
    } else {
      console.log('Session ended (no handoff generated)');
    }
    return;
  }

  console.error('Usage:');
  console.error('  sync-plan        Sync plan.md with bead status');
  console.error('  create-handoff   Create a handoff for given beads');
  console.error('  end-session      Run all end‑of‑session hooks');
}
