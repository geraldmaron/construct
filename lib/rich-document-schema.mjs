/**
 * lib/rich-document-schema.mjs — RichDocument IR schema constants.
 *
 * Lightweight block-type vocabulary shared by lib/rich-document.mjs and
 * lib/export-provider-contract.mjs without pulling unified/remark/rehype parsers
 * into CLI paths that only need export evidence or validation.
 */

export const BLOCK_TYPES = Object.freeze([
  'paragraph', 'heading', 'list', 'table', 'figure', 'media', 'code', 'diagram', 'callout', 'droppedInfo', 'html',
]);
