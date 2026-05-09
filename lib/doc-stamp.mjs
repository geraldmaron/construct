/**
 * lib/doc-stamp.mjs — Auditability stamps for Construct-generated documents.
 *
 * Provides:
 *   uuidv7()          — time-ordered UUID (RFC 9562) for document identity
 *   bodyHash(text)    — SHA-256 of document body for tamper detection
 *   stampFrontmatter  — inject/update audit block at top of a markdown string
 *   verifyStamp       — verify body_hash against current content
 *   parseStamp        — extract stamp fields from a document string
 *
 * Design:
 *   - Zero npm dependencies (Node built-ins only)
 *   - Stamp is a YAML-fenced block at the very top of the file, before any
 *     other content. Markdown renderers show it as a metadata block.
 *   - body_hash covers everything after the closing --- of the stamp block,
 *     trimmed, so whitespace-only edits do not break verification.
 *   - generator field is intentionally short (no version pinning) so the
 *     stamp survives construct upgrades without false-positive hash mismatches.
 */

import { createHash, randomBytes } from 'node:crypto';

// ---------------------------------------------------------------------------
// UUIDv7 — RFC 9562 §5.7
// Top 48 bits: Unix ms timestamp. Next 4 bits: version=7. Next 12 bits:
// random seq. Next 2 bits: variant=10. Remaining 62 bits: random.
// ---------------------------------------------------------------------------
export function uuidv7() {
  const ms = BigInt(Date.now());
  const rand = randomBytes(10);
  // Build 128-bit value as two 64-bit halves
  const hi =
    ((ms & 0xffffffffffffn) << 16n) |
    (7n << 12n) |
    (BigInt(rand[0] & 0x0f) << 8n) |
    BigInt(rand[1]);
  const lo =
    (0x8000000000000000n) |
    (BigInt(rand[2] & 0x3f) << 56n) |
    (BigInt(rand[3]) << 48n) |
    (BigInt(rand[4]) << 40n) |
    (BigInt(rand[5]) << 32n) |
    (BigInt(rand[6]) << 24n) |
    (BigInt(rand[7]) << 16n) |
    (BigInt(rand[8]) << 8n) |
    BigInt(rand[9]);

  const hex = hi.toString(16).padStart(16, '0') + lo.toString(16).padStart(16, '0');
  return `${hex.slice(0,8)}-${hex.slice(8,12)}-${hex.slice(12,16)}-${hex.slice(16,20)}-${hex.slice(20)}`;
}

// ---------------------------------------------------------------------------
// Content hash — SHA-256 of trimmed body text
// ---------------------------------------------------------------------------
export function bodyHash(bodyText) {
  return 'sha256:' + createHash('sha256').update(bodyText.trim(), 'utf8').digest('hex');
}

// ---------------------------------------------------------------------------
// Stamp block helpers
// ---------------------------------------------------------------------------
const STAMP_OPEN = '---';
const STAMP_CLOSE = '---';
const STAMP_MARKER = 'cx_doc_id:';

/**
 * Returns true if the document already has a Construct stamp block.
 */
export function hasStamp(content) {
  if (!content.startsWith(STAMP_OPEN)) return false;
  const rest = content.slice(3);
  return rest.includes(STAMP_MARKER);
}

/**
 * Split document into { stampBlock, body }.
 * stampBlock includes the opening and closing --- lines.
 * body is everything after the closing ---.
 * Returns null if no stamp found.
 */
function splitStamp(content) {
  if (!content.startsWith(STAMP_OPEN + '\n')) return null;
  const afterOpen = content.slice(4); // skip "---\n"
  const closeIdx = afterOpen.indexOf('\n' + STAMP_CLOSE + '\n');
  if (closeIdx === -1) return null;
  const stampBlock = STAMP_OPEN + '\n' + afterOpen.slice(0, closeIdx) + '\n' + STAMP_CLOSE;
  const body = afterOpen.slice(closeIdx + STAMP_CLOSE.length + 2); // skip "\n---\n"
  return { stampBlock, body };
}

/**
 * Inject a new audit stamp at the top of a markdown string.
 * If a stamp already exists it is replaced (id preserved, hash updated).
 *
 * @param {string} content   - Raw markdown content (may already have a stamp)
 * @param {object} options
 *   generator   {string}  - Short generator label (default: 'construct')
 *   sessionId   {string}  - Construct session ID if available
 *   model       {string}  - Model name/version if available
 *   preserve_id {boolean} - Keep existing cx_doc_id if present (default: true)
 */
export function stampFrontmatter(content, {
  generator = 'construct',
  sessionId = null,
  model = null,
  preserve_id = true,
} = {}) {
  const existing = hasStamp(content) ? splitStamp(content) : null;
  const existingFields = existing ? parseStamp(content) : {};

  const id = (preserve_id && existingFields.cx_doc_id) ? existingFields.cx_doc_id : uuidv7();
  const createdAt = existingFields.created_at || new Date().toISOString();
  const updatedAt = new Date().toISOString();

  // Body is everything after stamp (or all content if no prior stamp)
  const body = existing ? existing.body : content;
  const hash = bodyHash(body);

  const lines = [
    STAMP_OPEN,
    `cx_doc_id: ${id}`,
    `created_at: ${createdAt}`,
    `updated_at: ${updatedAt}`,
    `generator: ${generator}`,
  ];
  if (model) lines.push(`model: ${model}`);
  if (sessionId) lines.push(`session_id: ${sessionId}`);
  lines.push(`body_hash: ${hash}`);
  lines.push(STAMP_CLOSE);
  lines.push('');

  return lines.join('\n') + body;
}

/**
 * Parse stamp fields from a stamped document.
 * Returns {} if no stamp found.
 */
export function parseStamp(content) {
  const parts = splitStamp(content);
  if (!parts) return {};
  const fields = {};
  for (const line of parts.stampBlock.split('\n')) {
    const m = line.match(/^(\w+):\s*(.+)$/);
    if (m) fields[m[1]] = m[2].trim();
  }
  return fields;
}

/**
 * Verify that the stored body_hash matches the current body.
 * Returns { valid: true } or { valid: false, reason, stored, computed }.
 */
export function verifyStamp(content) {
  const parts = splitStamp(content);
  if (!parts) return { valid: false, reason: 'no stamp found' };
  const fields = parseStamp(content);
  if (!fields.body_hash) return { valid: false, reason: 'no body_hash in stamp' };
  const computed = bodyHash(parts.body);
  if (computed !== fields.body_hash) {
    return { valid: false, reason: 'body_hash mismatch', stored: fields.body_hash, computed };
  }
  return { valid: true, id: fields.cx_doc_id, created_at: fields.created_at };
}
