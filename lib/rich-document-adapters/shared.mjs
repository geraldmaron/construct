/**
 * lib/rich-document-adapters/shared.mjs — Shared helpers for unified RichDocument markdown/HTML parsers.
 *
 * Frontmatter extraction and metadata merge mirror the conventions `markdownToRichDocument` used
 * before the unified migration; kept here so adapter modules stay focused on mdast/hast mapping.
 */

import { load as loadYaml } from 'js-yaml';

export function extractFrontmatter(text) {
  if (!text.startsWith('---')) return { frontmatter: {}, body: text };
  const end = text.indexOf('\n---', 3);
  if (end === -1) return { frontmatter: {}, body: text };
  let frontmatter = {};
  try {
    frontmatter = loadYaml(text.slice(3, end)) || {};
  } catch {
    frontmatter = {};
  }
  const body = text.slice(end + 4).replace(/^\n+/, '');
  return { frontmatter, body };
}

export function mergeMetadata(metadata, frontmatter) {
  const fm = frontmatter && typeof frontmatter === 'object' ? frontmatter : {};
  const dates = fm.dates && typeof fm.dates === 'object' ? fm.dates : (fm.date ? { date: String(fm.date) } : {});
  const authors = Array.isArray(fm.authors) ? fm.authors
    : (fm.owner ? [fm.owner] : (Array.isArray(metadata.authors) ? metadata.authors : []));
  return {
    title: metadata.title ?? fm.title ?? '',
    subtitle: metadata.subtitle ?? fm.subtitle ?? '',
    authors,
    dates: { ...dates, ...(metadata.dates || {}) },
    artifactType: metadata.artifactType ?? fm.artifactType ?? fm.artifact_type ?? '',
    docId: metadata.docId ?? fm.docId ?? fm.doc_id ?? '',
    version: metadata.version != null ? String(metadata.version) : (fm.version != null ? String(fm.version) : ''),
    classification: metadata.classification ?? fm.classification ?? '',
    frontmatter: fm,
  };
}

export function guessMime(uri) {
  const ext = String(uri || '').split('.').pop()?.toLowerCase();
  const table = { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', svg: 'image/svg+xml', webp: 'image/webp' };
  return table[ext] || null;
}

export function safeJson(s) {
  try { return JSON.parse(s); } catch { return null; }
}
