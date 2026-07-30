/**
 * lib/export-provider-contract.mjs — ExportProvider result contract (construct-tsyfe.6.1).
 *
 * Hand-rolled validator for the export evidence envelope every provider must return:
 * provider identity (name + version), sha256 content hash of output bytes, and a fidelity
 * report derived from RichDocument block coverage rather than prose assertions. Hand-rolled
 * only (no external validation library). Consumed by lib/export-from-source.mjs, lib/rich-document-export.mjs, and
 * lib/document-export.mjs when attaching evidence to export results.
 */

import crypto from 'node:crypto';
import fs from 'node:fs';

import { BLOCK_TYPES } from './rich-document-schema.mjs';

const CONTENT_HASH_RE = /^sha256:[a-f0-9]{64}$/;

export { BLOCK_TYPES };

export const DEFAULT_EXPORT_CAPABILITIES = Object.freeze({
  html: {
    supports: BLOCK_TYPES.filter((t) => t !== 'droppedInfo'),
    drops: ['droppedInfo'],
  },
  htmlfrag: {
    supports: BLOCK_TYPES.filter((t) => t !== 'droppedInfo'),
    drops: ['droppedInfo'],
  },
  pdf: {
    supports: BLOCK_TYPES.filter((t) => t !== 'droppedInfo'),
    drops: ['droppedInfo'],
  },
  docx: {
    supports: BLOCK_TYPES.filter((t) => t !== 'droppedInfo'),
    drops: ['droppedInfo'],
  },
  doc: {
    supports: BLOCK_TYPES.filter((t) => t !== 'droppedInfo'),
    drops: ['droppedInfo'],
  },
  odt: {
    supports: BLOCK_TYPES.filter((t) => t !== 'droppedInfo'),
    drops: ['droppedInfo'],
  },
  odp: {
    supports: ['paragraph', 'heading', 'list', 'table', 'figure', 'media', 'code', 'diagram'],
    drops: ['callout', 'droppedInfo'],
  },
  pptx: {
    supports: ['paragraph', 'heading', 'list', 'table', 'figure', 'media', 'code', 'diagram'],
    drops: ['callout', 'droppedInfo'],
  },
  deck: {
    supports: BLOCK_TYPES.filter((t) => t !== 'droppedInfo'),
    drops: ['droppedInfo'],
  },
  rtf: {
    supports: BLOCK_TYPES.filter((t) => t !== 'droppedInfo'),
    drops: ['droppedInfo'],
  },
  epub: {
    supports: BLOCK_TYPES.filter((t) => t !== 'droppedInfo'),
    drops: ['droppedInfo'],
  },
  txt: {
    supports: ['paragraph', 'heading', 'list', 'table', 'code', 'diagram'],
    drops: ['figure', 'media', 'callout', 'droppedInfo'],
  },
  tex: {
    supports: BLOCK_TYPES.filter((t) => t !== 'droppedInfo'),
    drops: ['droppedInfo'],
  },
  md: {
    supports: ['paragraph', 'heading', 'list', 'table', 'figure', 'media', 'code', 'diagram'],
    drops: ['callout', 'droppedInfo'],
  },
  mdx: {
    supports: ['paragraph', 'heading', 'list', 'table', 'figure', 'media', 'code', 'diagram'],
    drops: ['callout', 'droppedInfo'],
  },
});

function walkBlocks(blocks, out) {
  for (const block of blocks || []) {
    if (!block || typeof block !== 'object') continue;
    out.push(block);
    if (block.type === 'list') {
      for (const item of block.items || []) {
        for (const sub of item) walkBlocks([sub], out);
      }
    }
    if (block.type === 'callout') walkBlocks(block.blocks, out);
  }
}

function collectDocBlocks(doc) {
  const blocks = [];
  for (const section of doc?.sections || []) walkBlocks(section.blocks, blocks);
  return blocks;
}

export function hashExportOutput(bytesOrPath) {
  const bytes = Buffer.isBuffer(bytesOrPath)
    ? bytesOrPath
    : fs.readFileSync(bytesOrPath);
  return `sha256:${crypto.createHash('sha256').update(bytes).digest('hex')}`;
}

export function validateExportProviderCapabilities(capabilities = {}) {
  const errors = [];
  if (!capabilities || typeof capabilities !== 'object') {
    return { ok: false, errors: ['capabilities must be an object'] };
  }
  for (const [format, spec] of Object.entries(capabilities)) {
    if (!spec || typeof spec !== 'object') {
      errors.push(`${format}: capabilities entry must be an object`);
      continue;
    }
    const supports = spec.supports || [];
    const drops = spec.drops || [];
    if (!Array.isArray(supports) || !Array.isArray(drops)) {
      errors.push(`${format}: supports and drops must be arrays`);
      continue;
    }
    for (const type of [...supports, ...drops]) {
      if (!BLOCK_TYPES.includes(type)) errors.push(`${format}: unrecognized block type "${type}"`);
    }
    for (const type of supports) {
      if (drops.includes(type)) errors.push(`${format}: "${type}" appears in both supports and drops`);
    }
  }
  return errors.length ? { ok: false, errors } : { ok: true, errors: [] };
}

export function computeFidelityReport({ doc, capabilities, format }) {
  const spec = capabilities?.[format] || DEFAULT_EXPORT_CAPABILITIES[format];
  const drops = new Set(spec?.drops || []);
  const blocks = collectDocBlocks(doc);
  const droppedBlocks = [];
  for (const block of blocks) {
    if (!drops.has(block.type)) continue;
    droppedBlocks.push({
      type: block.type,
      id: block.id || null,
      reason: `format "${format}" does not preserve ${block.type} blocks`,
    });
  }
  return {
    droppedBlocks,
    degraded: droppedBlocks.length > 0,
  };
}

export function validateExportProviderResult(result) {
  const errors = [];
  if (!result || typeof result !== 'object') return { ok: false, errors: ['result must be an object'] };
  if (result.ok !== true) return { ok: false, errors: ['validateExportProviderResult expects ok:true results'] };
  if (!result.format || typeof result.format !== 'string') errors.push('format is required');
  if (!result.outputPath || typeof result.outputPath !== 'string') errors.push('outputPath is required');
  if (!result.provider || typeof result.provider !== 'object') {
    errors.push('provider is required');
  } else {
    if (!result.provider.name) errors.push('provider.name is required');
    if (!result.provider.version) errors.push('provider.version is required');
  }
  if (!result.contentHash || !CONTENT_HASH_RE.test(result.contentHash)) {
    errors.push('contentHash must match sha256:<hex>');
  }
  if (!result.fidelity || typeof result.fidelity !== 'object') {
    errors.push('fidelity is required');
  } else {
    if (!Array.isArray(result.fidelity.droppedBlocks)) errors.push('fidelity.droppedBlocks must be an array');
    if (typeof result.fidelity.degraded !== 'boolean') errors.push('fidelity.degraded must be a boolean');
    if (result.fidelity.degraded !== (result.fidelity.droppedBlocks?.length > 0)) {
      errors.push('fidelity.degraded must match whether droppedBlocks is non-empty');
    }
  }
  return errors.length ? { ok: false, errors } : { ok: true, errors: [] };
}

export function attachExportEvidence(result, {
  doc = null,
  format,
  capabilities = DEFAULT_EXPORT_CAPABILITIES,
  resolveProvider = () => ({ name: 'unknown', version: 'unknown' }),
} = {}) {
  if (!result?.ok || !result.outputPath) return result;
  let contentHash;
  try {
    contentHash = hashExportOutput(result.outputPath);
  } catch {
    return result;
  }
  const provider = resolveProvider(result);
  const fidelity = doc
    ? computeFidelityReport({ doc, capabilities, format: format || result.format })
    : { droppedBlocks: [], degraded: false };
  return {
    ...result,
    provider,
    contentHash,
    fidelity,
  };
}
