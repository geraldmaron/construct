/**
 * lib/document-assets.mjs — rich-media asset manifest and preservation pipeline for RichDocument
 * (ADR-0073 / construct-d1r7.10).
 *
 * The manifest is *derived from* the IR, not a parallel hand-maintained structure: `buildAssetManifest`
 * walks a RichDocument's figure/media/diagram blocks (including those nested in lists and callouts)
 * and records, per asset, the fields exports need to preserve or embed it — role (photo / screenshot
 * / diagram), local vs remote ref, resolved absolute path, sha256 hash, byte size, MIME type,
 * dimensions, caption, alt text, source ref, and an embed/link policy. `validateAssetManifest` fails
 * a document whose local media points at a file that is not on disk. `resolveDocAssets` returns a doc
 * clone whose local media refs are rewritten to absolute paths so a Pandoc/LibreOffice pass running in
 * a temp directory still finds and embeds them — the mechanism behind "exports preserve assets."
 *
 * Generated on import (lib/document-ingest.mjs writes it as a `.assets.json` sidecar) and consumed on
 * export (lib/rich-document-export.mjs validates + resolves before handing HTML to the engines).
 */

import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

const REMOTE_REF = /^(?:https?:|data:)/i;

function isLocalRef(src) {
  return Boolean(src) && !REMOTE_REF.test(src) && !src.startsWith('#');
}

// Screenshots and photos are both raster figures with no reliable structural difference; the source
// filename is the only signal available at this layer, so a name that reads as a capture is
// classified as such and everything else raster falls back to 'photo'.

function classifyRole(blockType, kind, src) {
  if (blockType === 'diagram') return 'diagram';
  if (kind === 'video' || kind === 'audio') return kind;
  if (/screen[\s._-]?(?:shot|cap(?:ture)?)|screenshot/i.test(String(src || ''))) return 'screenshot';
  return 'photo';
}

function runsText(runs) {
  return (runs || []).map((r) => String(r.text ?? '')).join('');
}

function* walkMediaBlocks(blocks) {
  for (const block of blocks || []) {
    if (!block || typeof block !== 'object') continue;
    if (block.type === 'figure' || block.type === 'media' || block.type === 'diagram') {
      yield block;
    }
    if (block.type === 'list') {
      for (const item of block.items || []) yield* walkMediaBlocks(item);
    }
    if (block.type === 'callout') {
      yield* walkMediaBlocks(block.blocks || []);
    }
  }
}

function assetFromBlock(block, index, baseDir) {
  const isFigure = block.type === 'figure';
  const media = isFigure ? (block.media || {}) : block;
  const kind = block.type === 'diagram' ? 'diagram' : (media.kind || 'image');
  const src = block.type === 'diagram' ? null : (media.uri || media.assetPath || null);
  const local = isLocalRef(src);
  const absPath = local ? path.resolve(baseDir, src) : null;
  const exists = Boolean(absPath && fs.existsSync(absPath) && fs.statSync(absPath).isFile());

  let hash = null;
  let bytes = null;
  if (exists) {
    const buf = fs.readFileSync(absPath);
    hash = crypto.createHash('sha256').update(buf).digest('hex');
    bytes = buf.length;
  }

  const remote = Boolean(src) && REMOTE_REF.test(src);
  return {
    id: `asset-${index + 1}`,
    role: classifyRole(block.type, kind, src),
    blockType: block.type,
    src,
    local,
    exists,
    absPath: exists ? absPath : null,
    mimeType: block.type === 'diagram' ? null : (media.mimeType || null),
    hash,
    bytes,
    dimensions: media.dimensions || null,
    caption: isFigure ? runsText(block.caption) : '',
    altText: isFigure ? (block.altText || '') : (block.altText || ''),
    sourceRef: (isFigure ? block.sourceRef : null) || null,
    policy: remote ? 'link' : 'embed',
  };
}

export function buildAssetManifest(doc, { baseDir = process.cwd() } = {}) {
  const blocks = (doc?.sections || []).flatMap((section) => section.blocks || []);
  const assets = [];
  let index = 0;
  for (const block of walkMediaBlocks(blocks)) {
    assets.push(assetFromBlock(block, index, baseDir));
    index += 1;
  }
  return { generatedFrom: 'rich-document', baseDir, assets };
}

// A local ref that names a file not on disk is a broken asset — a document that cannot be exported
// faithfully. Remote refs, data URIs, and diagram blocks (no file) are out of scope for the on-disk
// check, mirroring lib/export-validate.mjs's referenceIntegrity boundary.

export function validateAssetManifest(manifest) {
  const broken = (manifest?.assets || []).filter((a) => a.local && !a.exists);
  return {
    ok: broken.length === 0,
    broken,
    missing: broken.map((a) => a.src),
    message: broken.length === 0
      ? `${(manifest?.assets || []).length} asset(s) resolved`
      : `${broken.length} broken local media reference(s): ${broken.map((a) => a.src).join(', ')}`,
  };
}

// Rewrites local media refs to absolute paths on a deep clone so a Pandoc/LibreOffice pass in a temp
// working directory resolves and embeds them; remote refs and unresolved locals are left untouched
// (the latter is caught by validateAssetManifest before export). Captions and alt text are carried
// unchanged, so they survive to whatever the target format preserves.

export function resolveDocAssets(doc, { baseDir = process.cwd() } = {}) {
  const clone = structuredClone(doc);
  const rewriteMedia = (media) => {
    if (!media) return;
    const src = media.uri || media.assetPath || null;
    if (isLocalRef(src)) {
      const abs = path.resolve(baseDir, src);
      if (fs.existsSync(abs)) {
        if (media.uri) media.uri = abs;
        else media.assetPath = abs;
      }
    }
  };
  const walk = (blocks) => {
    for (const block of blocks || []) {
      if (block?.type === 'figure') rewriteMedia(block.media);
      else if (block?.type === 'media') rewriteMedia(block);
      else if (block?.type === 'list') (block.items || []).forEach(walk);
      else if (block?.type === 'callout') walk(block.blocks || []);
    }
  };
  for (const section of clone.sections || []) walk(section.blocks || []);
  return clone;
}
