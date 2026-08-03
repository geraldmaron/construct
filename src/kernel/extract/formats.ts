/**
 * kernel/extract/formats.ts — extension sets used as routing signals by the
 * extraction ladder. Ported verbatim from the predecessor's format module; the
 * exact v2 source path is cited in scripts/capture-legacy-ladder-golden.mjs.
 *
 * These are format detectors, not the dispatch key: the ladder routes on
 * (format, requested fidelity, text yield, privacy posture, backend
 * availability), and membership here is one input among those.
 *
 * The derived sets are computed rather than listed, exactly as v2 did, so a new
 * extension added to a base set cannot be forgotten in a derived one.
 */

export const UTF8_TEXT_EXTS: ReadonlySet<string> = new Set([
  '.md', '.txt', '.rst', '.adoc', '.json', '.yaml', '.yml', '.toml',
  '.js', '.mjs', '.ts', '.tsx', '.jsx', '.py', '.go', '.rs', '.sh', '.bash',
  '.html', '.css', '.csv', '.tsv', '.xml', '.env', '.env.example', '.conf', '.ini', '.tf', '.hcl',
  '.sql', '.log',
]);

export const TRANSCRIPT_EXTS: ReadonlySet<string> = new Set(['.vtt', '.srt', '.lrc', '.transcript']);

export const CALENDAR_EXTS: ReadonlySet<string> = new Set(['.ics']);

export const AUDIO_VIDEO_EXTS: ReadonlySet<string> = new Set([
  '.mp3', '.wav', '.m4a', '.mp4', '.mov', '.avi', '.mkv', '.flac', '.ogg', '.webm', '.m4v',
]);

export const ZIP_DOCUMENT_EXTS: ReadonlySet<string> = new Set([
  '.docx', '.xlsx', '.pptx', '.odt', '.ods', '.odp',
]);

export const RICH_TEXT_EXTS: ReadonlySet<string> = new Set(['.doc', '.rtf']);

/** Formats v2 could only read through macOS Spotlight metadata (`mdls`). */
export const MDLS_DOCUMENT_EXTS: ReadonlySet<string> = new Set([
  '.xls', '.ppt', '.pages', '.numbers', '.key',
]);

export const EMAIL_DOCUMENT_EXTS: ReadonlySet<string> = new Set(['.eml', '.msg']);

export const IMAGE_DOCUMENT_EXTS: ReadonlySet<string> = new Set([
  '.png', '.jpg', '.jpeg', '.tif', '.tiff', '.bmp', '.webp',
]);

export const EXTRACTABLE_DOCUMENT_EXTS: ReadonlySet<string> = new Set([
  ...UTF8_TEXT_EXTS,
  ...TRANSCRIPT_EXTS,
  ...CALENDAR_EXTS,
  ...AUDIO_VIDEO_EXTS,
  ...ZIP_DOCUMENT_EXTS,
  ...RICH_TEXT_EXTS,
  ...MDLS_DOCUMENT_EXTS,
  ...EMAIL_DOCUMENT_EXTS,
  ...IMAGE_DOCUMENT_EXTS,
  '.pdf',
]);

/** Office formats with no lightweight parser — Docling or nothing. */
export const OFFICE_REQUIRES_DOCLING_EXTS: ReadonlySet<string> = new Set([
  '.xlsx', '.pptx', '.odt', '.ods', '.odp',
]);

/** Formats where high fidelity means layout preservation matters. */
export const DOCLING_LADDER_FORMATS: ReadonlySet<string> = new Set([
  '.pdf',
  ...ZIP_DOCUMENT_EXTS,
  ...RICH_TEXT_EXTS,
  ...MDLS_DOCUMENT_EXTS,
  ...IMAGE_DOCUMENT_EXTS,
]);
