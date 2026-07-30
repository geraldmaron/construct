/**
 * lib/document-extract/docling-rich-document.mjs — Docling structured dict to RichDocument.
 *
 * Converts the lossless Docling sidecar `structuredDict` (export_to_dict output) into
 * RichDocument blocks while preserving the raw provider dict separately for
 * forward-compatible replay for Docling sidecar structured output.
 */

import { basename } from 'node:path';

import {
  makeRichDocument,
  makeSection,
  makeRun,
  makeCell,
  makeParagraphBlock,
  makeHeadingBlock,
  makeTableBlock,
  validateRichDocument,
} from '../rich-document.mjs';

function cellText(cell) {
  if (cell == null) return '';
  if (typeof cell === 'string') return cell;
  if (typeof cell.text === 'string') return cell.text;
  if (Array.isArray(cell.runs)) return cell.runs.map((run) => run?.text ?? '').join('');
  return String(cell.text ?? '');
}

function tableBlockFromDoclingEntry(tableEntry) {
  const grid = tableEntry?.data?.grid;
  if (!Array.isArray(grid) || grid.length === 0) return null;

  const rows = grid
    .map((row) => {
      if (!Array.isArray(row)) return null;
      return row.map((cell) => makeCell({ runs: [makeRun({ text: cellText(cell) })] }));
    })
    .filter(Boolean);

  if (rows.length === 0) return null;
  if (rows.length === 1) {
    return makeTableBlock({ headers: rows[0], rows: [] });
  }

  return makeTableBlock({ headers: rows[0], rows: rows.slice(1) });
}

function blockFromTextItem(item) {
  const text = String(item?.text ?? '').trim();
  if (!text) return null;

  const label = String(item?.label ?? item?.type ?? '').toLowerCase();
  if (label.includes('header') || label === 'title') {
    const levelMatch = label.match(/level[-_]?(\d)/);
    const level = levelMatch ? Number(levelMatch[1]) : (label === 'title' ? 1 : 2);
    return makeHeadingBlock({ level, runs: [makeRun({ text })] });
  }

  return makeParagraphBlock({ runs: [makeRun({ text })] });
}

function collectTableBlocks(richDoc) {
  const blocks = [];
  for (const section of richDoc.sections ?? []) {
    for (const block of section.blocks ?? []) {
      if (block?.type === 'table') blocks.push(block);
    }
  }
  return blocks;
}

/**
 * Build a RichDocument from a Docling export_to_dict payload.
 *
 * @param {object|null|undefined} structuredDict
 * @param {object} [opts]
 * @param {string} [opts.title]
 * @param {object} [opts.metadata]
 * @returns {object|null}
 */
export function buildRichDocumentFromDoclingDict(structuredDict, { title = '', metadata = {} } = {}) {
  if (!structuredDict || typeof structuredDict !== 'object') return null;

  const blocks = [];

  const texts = Array.isArray(structuredDict.texts) ? structuredDict.texts : [];
  for (const item of texts) {
    const block = blockFromTextItem(item);
    if (block) blocks.push(block);
  }

  const tables = Array.isArray(structuredDict.tables) ? structuredDict.tables : [];
  for (const tableEntry of tables) {
    const block = tableBlockFromDoclingEntry(tableEntry);
    if (block) blocks.push(block);
  }

  const pageRefs = Array.isArray(structuredDict.pages)
    ? structuredDict.pages
      .map((page) => ({
        page: page.page_no ?? page.pageNo ?? null,
        width: page.size?.width ?? null,
        height: page.size?.height ?? null,
      }))
      .filter((ref) => ref.page != null)
    : [];

  const richDoc = makeRichDocument({
    title: title || metadata?.sourcePath ? basename(String(metadata.sourcePath)) : '',
    frontmatter: {
      doclingSchema: structuredDict.schema_name ?? structuredDict.schemaName ?? null,
      doclingVersion: metadata?.doclingVersion ?? null,
      pageRefs,
    },
  }, [
    makeSection({
      id: 'docling-body',
      level: 1,
      title: title || 'Document',
      blocks,
    }),
  ]);

  const shape = validateRichDocument(richDoc);
  return shape.ok ? richDoc : null;
}

/**
 * Attach ladder-facing fields to a docling sidecar result.
 *
 * @param {object} out sidecar result ({ markdown, metadata, droppedInfo, structuredDict? })
 * @param {object} [opts]
 * @param {string} [opts.title]
 * @returns {object}
 */
export function enrichDoclingSidecarResult(out, { title = '' } = {}) {
  const structured = buildRichDocumentFromDoclingDict(out.structuredDict, {
    title,
    metadata: out.metadata,
  });

  return {
    ...out,
    text: out.markdown,
    extractionMethod: 'docling',
    structured,
    providerRepresentation: out.structuredDict ?? null,
  };
}

export { collectTableBlocks };
