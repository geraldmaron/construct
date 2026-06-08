/**
 * lib/reconcile/agent-instructions-rewrap.mjs — keep the CONSTRUCT INTEGRATION
 * block current inside existing AGENTS.md / CLAUDE.md files (ADR-0027 §2).
 *
 * The integration block is versioned and hash-stamped. A changed managed body
 * or version leaves files written by an earlier init carrying a stale block.
 * Re-injection rewrites the current block into files that already contain one,
 * replacing only the marker region and preserving every byte outside it.
 *
 * Scope is deliberately narrow: a file is touched only when it EXISTS in cwd
 * and already carries a CONSTRUCT INTEGRATION marker. Files without a block are
 * left for init to create — backward-repair never authors a block into a file
 * the user never opted into. Safety: `auto`. detect() reads only; apply() is
 * idempotent because injectIntoAgentFile returns `unchanged` once the stamp
 * matches.
 */

import fs from 'node:fs';
import path from 'node:path';

import {
  injectIntoAgentFile,
  injectConstructBlock,
  buildConstructIntegrationBody,
  CONSTRUCT_INTEGRATION_VERSION,
} from '../agent-instructions/inject.mjs';

const AGENT_FILES = ['AGENTS.md', 'CLAUDE.md'];
const BEGIN_MARKER = '<!-- BEGIN CONSTRUCT INTEGRATION';
const BEADS_BLOCK_RE = /<!-- BEGIN BEADS INTEGRATION/;

function hasIntegrationBlock(content) {
  return content.includes(BEGIN_MARKER);
}

// Re-injection that would change the file maps to a stale block. The body
// dedups against a sibling Beads block, so the comparison rebuilds the body
// the same way injectIntoAgentFile does before hashing.

function wouldChange(content) {
  const body = buildConstructIntegrationBody({ hasBeadsBlock: BEADS_BLOCK_RE.test(content) });
  const { action } = injectConstructBlock(content, body, CONSTRUCT_INTEGRATION_VERSION);
  return action !== 'unchanged';
}

function candidateFiles() {
  const dir = process.cwd();
  const out = [];
  for (const name of AGENT_FILES) {
    const full = path.join(dir, name);
    if (!fs.existsSync(full)) continue;
    let content = '';
    try {
      content = fs.readFileSync(full, 'utf8');
    } catch {
      continue;
    }
    if (!hasIntegrationBlock(content)) continue;
    out.push({ name, full, content });
  }
  return out;
}

async function detect() {
  const candidates = candidateFiles();
  if (candidates.length === 0) {
    return { needsRepair: false, summary: 'No agent file carries a CONSTRUCT INTEGRATION block.' };
  }
  const stale = candidates.filter((c) => wouldChange(c.content)).map((c) => c.name);
  if (stale.length === 0) {
    return { needsRepair: false, summary: 'CONSTRUCT INTEGRATION blocks are current.' };
  }
  return {
    needsRepair: true,
    summary: `Stale CONSTRUCT INTEGRATION block in ${stale.join(', ')}.`,
    details: { stale },
  };
}

async function apply() {
  const candidates = candidateFiles();
  const rewrapped = [];
  for (const c of candidates) {
    if (!wouldChange(c.content)) continue;
    const result = injectIntoAgentFile(c.full, { version: CONSTRUCT_INTEGRATION_VERSION });
    if (result.changed) rewrapped.push(c.name);
  }
  if (rewrapped.length === 0) return { summary: 'Already current.' };
  return { summary: `Rewrapped CONSTRUCT INTEGRATION block in ${rewrapped.join(', ')}.` };
}

export default {
  id: 'agent-instructions-rewrap',
  description: 'Refresh stale CONSTRUCT INTEGRATION blocks in existing AGENTS.md / CLAUDE.md files.',
  safety: 'auto',
  detect,
  apply,
};
