/**
 * lib/knowledge/layout.mjs — canonical .cx/knowledge/ directory layout.
 *
 * Single source of truth for the typed knowledge subdirectories. Import this
 * from inbox.mjs, document-ingest.mjs, and anywhere that writes into .cx/.
 *
 * Directory structure:
 *   .cx/knowledge/
 *     internal/    — team notes, meeting minutes, internal specs, ADRs, PRDs
 *     external/    — customer feedback, support tickets, external research
 *     decisions/   — architecture decision records, design decisions
 *     how-tos/     — runbooks, setup guides, operational procedures, playbooks
 *     reference/   — specs, RFCs, architecture docs, schemas, API references
 *
 * Inbox / ingest target names map 1-to-1 to subdirectory names.
 * Use KNOWLEDGE_SUBDIRS to enumerate all valid targets.
 * Use knowledgeDirForCategory() to pick the right subdir from an obs category.
 * Use inferKnowledgeTarget() to pick the right subdir from a file path.
 */

export const KNOWLEDGE_ROOT = '.cx/knowledge';

/**
 * All valid knowledge subdirectory names.
 * These are the values accepted by --target=knowledge/<name> in the ingest CLI.
 */
export const KNOWLEDGE_SUBDIRS = /** @type {const} */ ([
  'internal',
  'external',
  'decisions',
  'how-tos',
  'reference',
]);

/**
 * Map an observation category to the knowledge subdir that should store it.
 * @param {string} category
 * @returns {string}
 */
export function knowledgeDirForCategory(category) {
  switch (category) {
    case 'decision':     return 'decisions';
    case 'anti-pattern': return 'internal';
    case 'pattern':      return 'how-tos';
    default:             return 'internal';
  }
}

/**
 * Infer the best knowledge subdir from a file path using naming conventions.
 *
 * Conventions (case-insensitive):
 *   ADR / architecture-decision → decisions/
 *   postmortem / incident / rca → internal/   (incident records)
 *   spec / rfc / schema / api-ref → reference/
 *   runbook / playbook / how-to / setup / guide → how-tos/
 *   customer / feedback / support / external → external/
 *   everything else → internal/
 *
 * @param {string} filePath
 * @returns {string}  one of KNOWLEDGE_SUBDIRS
 */
export function inferKnowledgeTarget(filePath) {
  const name = filePath.toLowerCase();

  if (/\badr[-_]\d/.test(name) || /architecture.decision/.test(name)) return 'decisions';
  if (/\bspec\b|\brfc\b|\bschema\b|\bapi.ref/.test(name))             return 'reference';
  if (/\brunbook\b|\bplaybook\b|\bhow.to\b|\bsetup\b|\bguide\b/.test(name)) return 'how-tos';
  if (/\bcustomer\b|\bfeedback\b|\bsupport\b|\bexternal\b/.test(name)) return 'external';
  if (/\bpost.?mortem\b|\bincident\b|\brca\b/.test(name))             return 'internal';
  return 'internal';
}
