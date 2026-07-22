/**
 * lib/document-extract/formats.mjs — shared extension sets for document extraction routing.
 *
 * Extension Sets remain valid format detectors; the quality-aware extraction ladder
 * uses them as routing signals rather than as the sole dispatch key.
 */

export const UTF8_TEXT_EXTS = new Set([
  '.md', '.txt', '.rst', '.adoc', '.json', '.yaml', '.yml', '.toml',
  '.js', '.mjs', '.ts', '.tsx', '.jsx', '.py', '.go', '.rs', '.sh', '.bash',
  '.html', '.css', '.csv', '.tsv', '.xml', '.env', '.env.example', '.conf', '.ini', '.tf', '.hcl',
  '.sql', '.log',
]);

export const TRANSCRIPT_EXTS = new Set(['.vtt', '.srt', '.lrc', '.transcript']);
export const CALENDAR_EXTS = new Set(['.ics']);
export const AUDIO_VIDEO_EXTS = new Set(['.mp3', '.wav', '.m4a', '.mp4', '.mov', '.avi', '.mkv', '.flac', '.ogg', '.webm', '.m4v']);
export const ZIP_DOCUMENT_EXTS = new Set(['.docx', '.xlsx', '.pptx', '.odt', '.ods', '.odp']);
export const RICH_TEXT_EXTS = new Set(['.doc', '.rtf']);
export const MDLS_DOCUMENT_EXTS = new Set(['.xls', '.ppt', '.pages', '.numbers', '.key']);
export const EMAIL_DOCUMENT_EXTS = new Set(['.eml', '.msg']);
export const IMAGE_DOCUMENT_EXTS = new Set(['.png', '.jpg', '.jpeg', '.tif', '.tiff', '.bmp', '.webp']);

export const EXTRACTABLE_DOCUMENT_EXTS = new Set([
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

export const OFFICE_REQUIRES_DOCLING_EXTS = new Set(['.xlsx', '.pptx', '.odt', '.ods', '.odp']);

export const DOCLING_LADDER_FORMATS = new Set([
  '.pdf',
  ...ZIP_DOCUMENT_EXTS,
  ...RICH_TEXT_EXTS,
  ...MDLS_DOCUMENT_EXTS,
  ...IMAGE_DOCUMENT_EXTS,
]);
