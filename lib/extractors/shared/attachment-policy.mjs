/**
 * lib/extractors/shared/attachment-policy.mjs — attachment security/resource
 * policy for email ingestion (construct-tsyfe.2.7).
 *
 * Applies four controls to a parsed message's attachment list before any
 * content reaches a caller: a per-attachment size limit, an aggregate size
 * limit across all kept attachments, a count limit, filename sanitization
 * (path-traversal/absolute-path/control-character removal, applied before any
 * filesystem write ever happens), and a zip-bomb heuristic. The heuristic
 * reads the DECLARED uncompressed size from a ZIP local file header or a
 * single-member gzip trailer without inflating the payload, so a hostile
 * ratio cannot exhaust memory here; a ZIP64 entry (declared sizes live in the
 * extra field, not read by this heuristic) is treated as suspect by default
 * rather than guessed at.
 *
 * Limits are CONSTRUCT_EMAIL_* env-overridable constants, matching the
 * `Number(process.env.X)`-with-fallback shape lib/document-ingest.mjs already
 * uses for CONSTRUCT_DOCLING_TIMEOUT_MS. classifyAttachments never throws:
 * every input attachment resolves to exactly one of "kept" (content
 * available, filename possibly sanitized) or "quarantined" (content
 * withheld, reason recorded), so ingest of the rest of the message can always
 * proceed.
 */
import { basename } from 'node:path';

function numEnv(name, fallback) {
  const raw = Number(process.env[name]);
  return Number.isFinite(raw) && raw > 0 ? raw : fallback;
}

export const MAX_ATTACHMENT_BYTES = numEnv('CONSTRUCT_EMAIL_MAX_ATTACHMENT_BYTES', 10 * 1024 * 1024);
export const MAX_ATTACHMENT_COUNT = numEnv('CONSTRUCT_EMAIL_MAX_ATTACHMENT_COUNT', 25);
export const MAX_AGGREGATE_ATTACHMENT_BYTES = numEnv('CONSTRUCT_EMAIL_MAX_AGGREGATE_ATTACHMENT_BYTES', 25 * 1024 * 1024);
export const ZIP_BOMB_RATIO_THRESHOLD = numEnv('CONSTRUCT_EMAIL_ZIP_BOMB_RATIO', 100);

const ZIP_LOCAL_HEADER_SIGNATURE = 0x04034b50;
const GZIP_MAGIC = Buffer.from([0x1f, 0x8b]);
const CONTROL_CHAR_RE = /[\x00-\x1f\x7f]/g;

// A path-traversal / absolute-path / drive-letter / control-character sweep,
// applied before any attachment filename reaches a filesystem path. basename()
// on a backslash-normalized name strips both POSIX and Windows-style
// directory components in one pass.

export function sanitizeAttachmentFilename(rawName) {
  const original = typeof rawName === 'string' ? rawName : '';
  const normalizedSlashes = original.replace(/\\/g, '/');
  const stripped = basename(normalizedSlashes)
    .replace(/^\.+/, '')
    .replace(CONTROL_CHAR_RE, '')
    .trim();
  const safeName = stripped.slice(0, 255) || 'unnamed-attachment';
  return { safeName, wasSanitized: safeName !== original };
}

/**
 * Reads a ZIP local file header (offset 0) or a single-member gzip trailer to
 * recover the declared uncompressed size without inflating the payload.
 * Returns { isArchive, suspectZipBomb, ratio, reason }.
 */
export function assessArchiveRisk(content, { ratioThreshold = ZIP_BOMB_RATIO_THRESHOLD } = {}) {
  if (!Buffer.isBuffer(content) || content.length < 4) {
    return { isArchive: false, suspectZipBomb: false, ratio: null, reason: null };
  }

  if (content.length >= 30 && content.readUInt32LE(0) === ZIP_LOCAL_HEADER_SIGNATURE) {
    const compressedSize = content.readUInt32LE(18);
    const uncompressedSize = content.readUInt32LE(22);
    if (compressedSize === 0xffffffff || uncompressedSize === 0xffffffff) {
      return {
        isArchive: true,
        suspectZipBomb: true,
        ratio: null,
        reason: 'ZIP64 declared sizes are not readable from the local file header; refusing an unbounded archive',
      };
    }
    const ratio = compressedSize > 0 ? uncompressedSize / compressedSize : (uncompressedSize > 0 ? Infinity : 0);
    const suspect = ratio >= ratioThreshold;
    return {
      isArchive: true,
      suspectZipBomb: suspect,
      ratio,
      reason: suspect ? `declared ratio ${ratio.toFixed(1)}:1 meets/exceeds the ${ratioThreshold}:1 zip-bomb threshold` : null,
    };
  }

  if (content.subarray(0, 2).equals(GZIP_MAGIC)) {
    const declaredUncompressed = content.length >= 4 ? content.readUInt32LE(content.length - 4) : 0;
    const compressedSize = content.length;
    const ratio = compressedSize > 0 ? declaredUncompressed / compressedSize : 0;
    const suspect = ratio >= ratioThreshold;
    return {
      isArchive: true,
      suspectZipBomb: suspect,
      ratio,
      reason: suspect ? `declared ratio ${ratio.toFixed(1)}:1 meets/exceeds the ${ratioThreshold}:1 zip-bomb threshold` : null,
    };
  }

  return { isArchive: false, suspectZipBomb: false, ratio: null, reason: null };
}

/**
 * Applies size/count/filename/archive-risk policy to a parsed message's
 * attachment list. Every attachment resolves to exactly one disposition —
 * "kept" or "quarantined" — with a provenance record explaining why, so
 * nothing is silently dropped and ingest of the rest of the message can
 * always proceed (construct-tsyfe.2.7 AC1-AC3). `overrides` lets callers
 * (tests, future policy config) tighten limits without touching the module
 * constants; production callers pass none and get the env-configured defaults.
 */
export function classifyAttachments(attachments, overrides = {}) {
  const maxBytes = overrides.maxAttachmentBytes ?? MAX_ATTACHMENT_BYTES;
  const maxCount = overrides.maxAttachmentCount ?? MAX_ATTACHMENT_COUNT;
  const maxAggregateBytes = overrides.maxAggregateAttachmentBytes ?? MAX_AGGREGATE_ATTACHMENT_BYTES;
  const ratioThreshold = overrides.zipBombRatioThreshold ?? ZIP_BOMB_RATIO_THRESHOLD;

  const kept = [];
  const quarantined = [];
  const provenance = [];
  let aggregateBytes = 0;

  (attachments || []).forEach((att, index) => {
    const originalFilename = att.filename || `attachment-${index + 1}`;
    const size = Number(att.size ?? att.content?.length ?? 0);
    const { safeName, wasSanitized } = sanitizeAttachmentFilename(originalFilename);

    let quarantineReason = null;
    if (index + 1 > maxCount) {
      quarantineReason = `attachment count ${index + 1} exceeds the ${maxCount}-attachment limit`;
    } else if (size > maxBytes) {
      quarantineReason = `attachment size ${size} bytes exceeds the ${maxBytes}-byte per-attachment limit`;
    } else if (aggregateBytes + size > maxAggregateBytes) {
      quarantineReason = `cumulative attachment bytes would exceed the ${maxAggregateBytes}-byte aggregate limit`;
    } else if (Buffer.isBuffer(att.content)) {
      const risk = assessArchiveRisk(att.content, { ratioThreshold });
      if (risk.suspectZipBomb) quarantineReason = risk.reason;
    }

    const record = {
      originalFilename,
      sanitizedFilename: safeName,
      filenameSanitized: wasSanitized,
      sizeBytes: size,
      disposition: quarantineReason ? 'quarantined' : 'kept',
      quarantineReason,
    };
    provenance.push(record);

    if (quarantineReason) {
      quarantined.push(record);
    } else {
      aggregateBytes += size;
      kept.push(record);
    }
  });

  return { kept, quarantined, provenance };
}
