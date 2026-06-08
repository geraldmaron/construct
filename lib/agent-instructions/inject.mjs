/**
 * lib/agent-instructions/inject.mjs — non-destructive marker-block injection for
 * agent-instruction files the user owns (AGENTS.md, CLAUDE.md) — ADR-0027 §2.
 *
 * Construct's integration guidance lives inside a versioned, hash-stamped block:
 *
 *   <!-- BEGIN CONSTRUCT INTEGRATION v:N hash:XXXX -->
 *   ...pointers...
 *   <!-- END CONSTRUCT INTEGRATION -->
 *
 * Everything outside the markers is preserved byte-for-byte. Injection is
 * idempotent: an existing block with the same version+hash is a no-op; a
 * different hash replaces the block content only; no block appends one. The
 * block dedups against a sibling Beads Integration block — when one is present
 * the tracker line points at it instead of repeating `bd` commands.
 *
 * Mirrors the marker pattern beads-automation uses for its own block, lifted
 * into a reusable primitive so init and sync share one append-or-replace path.
 */

import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';

export const CONSTRUCT_INTEGRATION_VERSION = 1;

const BEGIN_PREFIX = '<!-- BEGIN CONSTRUCT INTEGRATION';
const END_MARKER = '<!-- END CONSTRUCT INTEGRATION -->';
const BLOCK_RE = /<!-- BEGIN CONSTRUCT INTEGRATION[^>]*-->[\s\S]*?<!-- END CONSTRUCT INTEGRATION -->/;
const BEADS_BLOCK_RE = /<!-- BEGIN BEADS INTEGRATION/;

function shortHash(body) {
  return createHash('sha256').update(body).digest('hex').slice(0, 12);
}

// The managed block: concise pointers to the surfaces an agent needs to work
// with Construct (≤60 lines). When a Beads Integration block is already present
// the tracker line defers to it rather than duplicating `bd` commands.

export function buildConstructIntegrationBody({ hasBeadsBlock = false } = {}) {
  const tracker = hasBeadsBlock
    ? '- **Tracker**: see the Beads Integration block below for `bd` commands.'
    : '- **Tracker**: use Beads (`bd`) for all task tracking — run `bd prime` for the workflow. Do not use ad-hoc TODO lists.';
  return [
    '## Construct integration',
    '',
    'This project is managed by Construct. Address `@construct` in your editor and ask',
    'for the outcome, not the specialist — Construct routes to the right specialist chain.',
    '',
    '- **Durable state** lives in `.cx/` (context, knowledge, intake, traces) and Beads.',
    '  If services are down, resume from `plan.md`, `.cx/context.md`, the latest',
    '  `.cx/handoffs/` file, Beads, and git.',
    '- **Signals**: drop a file into `.cx/inbox/`; `construct intake` classifies and routes it.',
    '- **Specialists** (architect, reviewer, security, …) are dispatched by Construct — you',
    '  do not call them directly.',
    tracker,
    '- **Single-writer rule**: one session owns a file\'s edits; others review or wait.',
    '- Run `construct doctor` to check system health.',
  ].join('\n');
}

// Inject or update the managed block in `content`. Returns the new content and
// the action taken (`unchanged` | `updated` | `created`).

export function injectConstructBlock(content, body, version = CONSTRUCT_INTEGRATION_VERSION) {
  const hash = shortHash(body);
  const block = `${BEGIN_PREFIX} v:${version} hash:${hash} -->\n${body}\n${END_MARKER}`;
  const existing = content.match(BLOCK_RE);
  if (existing) {
    if (existing[0].includes(`v:${version} hash:${hash}`)) return { content, action: 'unchanged' };
    return { content: content.replace(BLOCK_RE, block), action: 'updated' };
  }
  const sep = content.length === 0 ? '' : content.endsWith('\n') ? '\n' : '\n\n';
  return { content: `${content}${sep}${block}\n`, action: 'created' };
}

// Apply the managed block to a single agent-instruction file. Creates the file
// (with `header`) when missing; otherwise injects/updates in place, preserving
// all surrounding content. Writes only when the content changes.

export function injectIntoAgentFile(filePath, { version = CONSTRUCT_INTEGRATION_VERSION, header = '' } = {}) {
  const existed = fs.existsSync(filePath);
  const current = existed ? fs.readFileSync(filePath, 'utf8') : '';
  const hasBeadsBlock = BEADS_BLOCK_RE.test(current);
  const body = buildConstructIntegrationBody({ hasBeadsBlock });
  const base = !existed && header ? (header.endsWith('\n') ? header : `${header}\n`) : current;
  const { content, action } = injectConstructBlock(base, body, version);
  const changed = !existed || action !== 'unchanged';
  if (changed) {
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, content, 'utf8');
  }
  return { action: existed ? action : 'created', existed, changed };
}
