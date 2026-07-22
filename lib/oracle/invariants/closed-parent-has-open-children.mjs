/**
 * lib/oracle/invariants/closed-parent-has-open-children.mjs — Layer 1 deterministic
 * invariant: a CLOSED bead must not have one or more OPEN (open/in_progress/blocked/
 * deferred) children, unless its notes carry an explicit clarification annotation.
 *
 * Distinct failure mode from closed-bead-sha-reachable.mjs (which asks "did the cited
 * commit land?"): this asks "is the bead's own completion state internally consistent
 * with its children's state?" A CLOSED parent with an OPEN child is usually a
 * premature close (children still have work), but per construct-4uxq0's own
 * 2026-07-17 investigation (construct-4uxq0.9.15), it can also be a deliberate,
 * documented pattern — a completed audit/program bead that correctly stays closed
 * while spawning independent follow-on epics as its own deliverable. Per this
 * invariant's own originating bead (construct-4uxq0.12.10), the second case must not
 * re-trigger a false alarm — the exact class of failure this Oracle assurance program
 * exists to catch, and would be ironic to reintroduce here.
 *
 * Annotation convention: `OPEN_CHILDREN_ANNOTATION_PREFIX` deliberately reuses
 * construct-4uxq0's own pre-existing notes text ("Close-reason clarification (",
 * written 2026-07-17 by the construct-4uxq0.9.15 investigation, before this invariant
 * existed) rather than inventing an unrelated phrase and appending a redundant `bd
 * note` — the precedent was real, human-authored, and already fits the shape this
 * invariant needs: a durable, dated, reasoned explanation for why children outliving
 * a closed parent is not an error. Mirrors closed-bead-sha-reachable.mjs's
 * RECONCILIATION_NOTE_PREFIX convention for the equivalent problem in that invariant.
 *
 * Data source: `bd list --json` includes each bead's `notes` and `parent` fields
 * directly (verified live 2026-07-17 against this repo's bd install — contradicts an
 * older comment in closed-bead-sha-reachable.mjs claiming notes are omitted from list
 * output; that invariant's separate `--notes-contains` collector still works and is
 * left as-is, but this invariant does not need a second query for the same data).
 * Open children are found by grouping the default (non-closed) bead list by `parent`
 * rather than querying `--parent <id>` per closed bead — one bulk pass over the open
 * corpus instead of one bd subprocess per closed bead evaluated.
 */

import { execFileSync } from 'node:child_process';

export const id = 'closed-parent-has-open-children';
export const layer = 1;
export const description =
  'A CLOSED bead must not have one or more OPEN children, unless its notes carry an explicit clarification annotation.';

export const OPEN_CHILDREN_ANNOTATION_PREFIX = 'Close-reason clarification (';

export function hasClarificationAnnotation(notes) {
  if (!notes || typeof notes !== 'string') return false;
  return notes.includes(OPEN_CHILDREN_ANNOTATION_PREFIX);
}

// execFileSync's stderr inherits to the parent process by default (Node's exec-family
// convenience default, unlike spawnSync); this invariant runs on an unattended
// schedule (lib/oracle/invariant-scan.mjs), so a missing/uninitialized bd store must
// degrade to a caught collection-error, not spam the host process's stderr. stdio
// mirrors closed-bead-sha-reachable.mjs's git calls (['ignore', 'pipe', 'pipe']):
// stderr is still captured on err.stderr for the collection-error detail, just not
// inherited.

function defaultListClosedBeads(cwd) {
  const raw = execFileSync('bd', ['list', '--status', 'closed', '--json', '--limit', '0'], {
    cwd,
    encoding: 'utf8',
    maxBuffer: 32 * 1024 * 1024,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  const parsed = JSON.parse(raw);
  return Array.isArray(parsed) ? parsed : [];
}

// Default `bd list` with no --status filter already excludes closed issues
// (verified live: 131 rows, identical to an explicit
// --status open,in_progress,blocked,deferred filter) — this is every bead whose
// open-ness could violate the invariant for some closed parent.

function defaultListOpenBeads(cwd) {
  const raw = execFileSync('bd', ['list', '--json', '--limit', '0'], {
    cwd,
    encoding: 'utf8',
    maxBuffer: 32 * 1024 * 1024,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  const parsed = JSON.parse(raw);
  return Array.isArray(parsed) ? parsed : [];
}

function groupOpenChildrenByParent(openBeads) {
  const byParent = new Map();
  for (const bead of openBeads) {
    const parentId = bead.parent;
    if (!parentId) continue;
    if (!byParent.has(parentId)) byParent.set(parentId, []);
    byParent.get(parentId).push({ id: bead.id, status: bead.status });
  }
  return byParent;
}

/**
 * @param {{cwd?: string, listClosedBeads?: () => (Array|Promise<Array>), listOpenBeads?: () => (Array|Promise<Array>)}} [opts]
 */
export async function check({
  cwd = process.cwd(),
  listClosedBeads = () => defaultListClosedBeads(cwd),
  listOpenBeads = () => defaultListOpenBeads(cwd),
} = {}) {
  let closedBeads;
  try {
    closedBeads = await listClosedBeads();
  } catch (err) {
    return {
      status: 'collection-error',
      detail: `failed to list closed beads: ${err.message || err}`,
      evaluated: 0,
      violations: [],
      results: [],
    };
  }

  let openBeads;
  try {
    openBeads = await listOpenBeads();
  } catch (err) {
    return {
      status: 'collection-error',
      detail: `failed to list open beads: ${err.message || err}`,
      evaluated: 0,
      violations: [],
      results: [],
    };
  }

  const openChildrenByParent = groupOpenChildrenByParent(openBeads);

  const withOpenChildren = closedBeads
    .map((bead) => ({ bead, openChildren: openChildrenByParent.get(bead.id) || [] }))
    .filter((entry) => entry.openChildren.length > 0);

  const results = withOpenChildren.map(({ bead, openChildren }) => {
    const childList = openChildren.map((c) => `${c.id} (${c.status})`).join(', ');
    if (hasClarificationAnnotation(bead.notes)) {
      return {
        beadId: bead.id, status: 'passed', annotated: true, openChildren,
        detail: `has ${openChildren.length} open child(ren) [${childList}], but notes carry an explicit "${OPEN_CHILDREN_ANNOTATION_PREFIX}...)" clarification`,
      };
    }
    return {
      beadId: bead.id, status: 'failed', violation: true, openChildren,
      detail: `has ${openChildren.length} open child(ren) [${childList}] with no clarification annotation in notes`,
    };
  });

  const violations = results.filter((r) => r.status === 'failed');
  const status = violations.length > 0 ? 'failed' : 'passed';

  return { status, evaluated: results.length, violations, results };
}
