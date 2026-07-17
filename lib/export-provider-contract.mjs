/**
 * lib/export-provider-contract.mjs — ExportProvider contract (construct-tsyfe.6.1).
 *
 * Defines the shape every export provider (Pandoc, Typst, pptxgenjs, LibreOffice, a future
 * sanitized-HTML provider) must return once wired to it, plus a hand-rolled validator for that
 * shape — ADR-0001 keeps `lib/` free of external schema-validation libraries. Follows the
 * twin-file convention lib/certification/run.mjs already established for
 * schemas/certification-run.schema.json: a schema file (schemas/export-provider-result.schema.json)
 * documents the shape, a hand-rolled validator function enforces it.
 *
 * Scope: contract definition only (construct-tsyfe.6.1). No existing exporter
 * (lib/document-export.mjs, lib/deck-export-pptx.mjs, lib/rich-document-export.mjs) is wired to
 * emit this shape yet — that is construct-tsyfe.6.2 (RichDocument-IR + fidelity/hash wiring) and
 * the per-engine consolidation beads it blocks (construct-tsyfe.6.3, .6.6).
 *
 * Contract:
 *   - Input: every provider accepts a RichDocument (lib/rich-document.mjs) as its canonical IR —
 *     not a raw markdown/HTML string. No conversion happens here; only the result a provider
 *     reports is validated, and the fidelity/hash fields are computed from real inputs.
 *   - Provider identity: `{ name, version }` identifies the external engine (pandoc, typst,
 *     pptxgenjs, libreoffice, ...), never the Construct module that called it.
 *   - Fidelity: a provider declares, per output format, which RichDocument block types
 *     (lib/rich-document.mjs BLOCK_TYPES) it renders vs. drops (ExportProviderCapabilities).
 *     `computeFidelityReport` diffs that declaration against a real document's block-type
 *     inventory, so the dropped-block report reflects actual content, not asserted prose.
 *   - Output hashing: `hashExportOutput` computes sha256 over output bytes only — never a
 *     filesystem path or environment-derived value — so two runs are comparable independent of
 *     which engine produced the file.
 *
 * Public API:
 *   validateExportProviderResult(result) → { valid, errors }
 *   validateExportProviderCapabilities(capabilities) → { valid, errors }
 *   computeFidelityReport({ doc, capabilities, format }) → { droppedBlocks[], degraded }
 *   hashExportOutput(bytesOrPath) → 'sha256:<hex>'
 */

import { createHash } from 'node:crypto';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { BLOCK_TYPES } from './rich-document.mjs';

const CONTENT_HASH_PATTERN = /^sha256:[a-f0-9]{64}$/;

function hasText(value) {
  return typeof value === 'string' && value.trim().length > 0;
}

/**
 * Validate a provider result object against the required-field list: provider.name,
 * provider.version, contentHash, fidelity.droppedBlocks, fidelity.degraded, alongside the
 * pre-existing ok/format/outputPath fields every landed export result already reports.
 * Returns { valid, errors } — errors is empty on success.
 */
export function validateExportProviderResult(result) {
  const errors = [];
  if (!result || typeof result !== 'object') {
    return { valid: false, errors: ['result must be an object'] };
  }

  if (typeof result.ok !== 'boolean') errors.push('ok must be a boolean');
  if (!hasText(result.format)) errors.push('format required');
  if (!hasText(result.outputPath)) errors.push('outputPath required');

  const provider = result.provider;
  if (!provider || typeof provider !== 'object') {
    errors.push('provider required');
  } else {
    if (!hasText(provider.name)) errors.push('provider.name required');
    if (provider.version !== null && !hasText(provider.version)) {
      errors.push('provider.version required (string, or explicit null when genuinely unknown)');
    }
  }

  if (!hasText(result.contentHash)) {
    errors.push('contentHash required');
  } else if (!CONTENT_HASH_PATTERN.test(result.contentHash)) {
    errors.push(`contentHash must match sha256:<64 hex chars>, got: ${result.contentHash}`);
  }

  const fidelity = result.fidelity;
  if (!fidelity || typeof fidelity !== 'object') {
    errors.push('fidelity required');
  } else {
    if (!Array.isArray(fidelity.droppedBlocks)) {
      errors.push('fidelity.droppedBlocks must be an array');
    } else {
      fidelity.droppedBlocks.forEach((entry, i) => {
        if (!entry || typeof entry !== 'object') { errors.push(`fidelity.droppedBlocks[${i}] must be an object`); return; }
        if (!hasText(entry.blockType)) errors.push(`fidelity.droppedBlocks[${i}].blockType required`);
        if (!Number.isInteger(entry.count) || entry.count < 1) errors.push(`fidelity.droppedBlocks[${i}].count must be a positive integer`);
        if (!hasText(entry.reason)) errors.push(`fidelity.droppedBlocks[${i}].reason required`);
      });
    }
    if (typeof fidelity.degraded !== 'boolean') errors.push('fidelity.degraded must be a boolean');
    if (Array.isArray(fidelity.droppedBlocks) && typeof fidelity.degraded === 'boolean') {
      const shouldBeDegraded = fidelity.droppedBlocks.length > 0;
      if (fidelity.degraded !== shouldBeDegraded) {
        errors.push(`fidelity.degraded must be ${shouldBeDegraded} when droppedBlocks has ${fidelity.droppedBlocks.length} entries`);
      }
    }
  }

  return { valid: errors.length === 0, errors };
}

/**
 * Validate a provider's static per-format block-coverage declaration:
 * { name, version, formats: { <format>: { supports: string[], drops: string[] } } }.
 * Every listed block type must be a real lib/rich-document.mjs BLOCK_TYPES member, and a type
 * cannot appear in both supports and drops for the same format.
 */
export function validateExportProviderCapabilities(capabilities) {
  const errors = [];
  if (!capabilities || typeof capabilities !== 'object') {
    return { valid: false, errors: ['capabilities must be an object'] };
  }
  if (!hasText(capabilities.name)) errors.push('capabilities.name required');
  if (!hasText(capabilities.version)) errors.push('capabilities.version required');

  const formats = capabilities.formats;
  if (!formats || typeof formats !== 'object') {
    errors.push('capabilities.formats must be an object keyed by format');
    return { valid: errors.length === 0, errors };
  }

  for (const [format, decl] of Object.entries(formats)) {
    const loc = `capabilities.formats.${format}`;
    if (!decl || typeof decl !== 'object') { errors.push(`${loc} must be an object`); continue; }
    const supports = Array.isArray(decl.supports) ? decl.supports : null;
    const drops = Array.isArray(decl.drops) ? decl.drops : null;
    if (!supports) errors.push(`${loc}.supports must be an array`);
    if (!drops) errors.push(`${loc}.drops must be an array`);
    for (const blockType of [...(supports || []), ...(drops || [])]) {
      if (!BLOCK_TYPES.includes(blockType)) {
        errors.push(`${loc} declares unrecognized block type "${blockType}" (known: ${BLOCK_TYPES.join('|')})`);
      }
    }
    if (supports && drops) {
      const overlap = supports.filter((t) => drops.includes(t));
      if (overlap.length) errors.push(`${loc}: block type(s) declared both supported and dropped: ${overlap.join(', ')}`);
    }
  }

  return { valid: errors.length === 0, errors };
}

// Walks every RichDocument block, including blocks nested inside list items and callouts, so a
// dropped table inside a callout is counted the same as a top-level one.

function countBlockTypes(doc) {
  const counts = new Map();
  const visitBlock = (block) => {
    if (!block || typeof block !== 'object' || !block.type) return;
    counts.set(block.type, (counts.get(block.type) || 0) + 1);
    if (block.type === 'list' && Array.isArray(block.items)) {
      for (const item of block.items) (item || []).forEach(visitBlock);
    }
    if (block.type === 'callout' && Array.isArray(block.blocks)) {
      block.blocks.forEach(visitBlock);
    }
  };
  for (const section of doc?.sections || []) {
    for (const block of section?.blocks || []) visitBlock(block);
  }
  return counts;
}

/**
 * Compute the fidelity report for one provider/format pair against a real RichDocument: counts
 * every block type the document actually contains, and reports as dropped any block type the
 * provider's capabilities declare as dropped for that format and the document actually contains
 * one or more of — derived from real content, never asserted independent of the input.
 */
export function computeFidelityReport({ doc, capabilities, format }) {
  const counts = countBlockTypes(doc);
  const declaredDrops = capabilities?.formats?.[format]?.drops || [];
  const droppedBlocks = [];
  for (const blockType of declaredDrops) {
    const count = counts.get(blockType) || 0;
    if (count > 0) {
      droppedBlocks.push({
        blockType,
        count,
        reason: `${capabilities?.name || 'provider'} does not render '${blockType}' blocks for format '${format}'`,
        recoverable: false,
      });
    }
  }
  return { droppedBlocks, degraded: droppedBlocks.length > 0 };
}

/**
 * sha256 of output bytes only, prefixed 'sha256:' to match the contentHash contract field.
 * Accepts a Buffer/Uint8Array directly, or a file path string read from disk — never hashes a
 * path string itself or any environment-derived value.
 */
export function hashExportOutput(bytesOrPath) {
  const bytes = typeof bytesOrPath === 'string' ? readFileFully(bytesOrPath) : bytesOrPath;
  if (!bytes || typeof bytes.length !== 'number') {
    throw new Error('hashExportOutput: expected a Buffer/Uint8Array or an existing file path');
  }
  return `sha256:${createHash('sha256').update(bytes).digest('hex')}`;
}

function readFileFully(filePath) {
  if (!existsSync(filePath) || !statSync(filePath).isFile()) {
    throw new Error(`hashExportOutput: not a file: ${filePath}`);
  }
  return readFileSync(filePath);
}
