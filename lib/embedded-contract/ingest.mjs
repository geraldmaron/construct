/**
 * lib/embedded-contract/ingest.mjs — file→text resolution for embedded contracts.
 *
 * The embedded triage and workflow contracts accept either inline text or a file
 * path. A file path is resolved through Construct's real extraction pipeline
 * (`extractDocumentTextAsync`: docling for PDF/Office, whisper for audio/video,
 * transcript/calendar/email extractors) rather than read as raw bytes, so an
 * external application can hand Construct any supported artifact. Resolution is
 * honest: a missing ASR backend or an unsupported type returns a structured
 * error or a clearly-flagged best-effort fallback — never silent gibberish.
 *
 * Surfaces (CLI/MCP/SDK) own I/O and call this; the contract cores stay pure and
 * receive the resolved text plus an `ingestion` metadata block to echo back.
 */

import { readFileSync } from 'node:fs';
import { extname } from 'node:path';

import { extractDocumentTextAsync, isExtractableDocumentPath } from '../document-extract.mjs';

/**
 * Resolve contract input from inline text or a file path.
 *
 * @param {object} opts
 * @param {string} [opts.input]     Inline text (returned as-is when provided).
 * @param {string} [opts.filePath]  Path to extract when no inline text is given.
 * @param {number} [opts.maxChars]
 * @returns {Promise<{text:string, ingestion:(object|null), error:(object|null)}>}
 */
export async function resolveInput({ input = '', filePath = '', maxChars = null } = {}) {
  if (input && input.trim()) {
    return { text: input, ingestion: null, error: null };
  }
  if (!filePath) {
    return { text: '', ingestion: null, error: null };
  }

  if (isExtractableDocumentPath(filePath)) {
    try {
      const extracted = await extractDocumentTextAsync(filePath, { maxChars });
      return {
        text: extracted.text || '',
        ingestion: {
          sourcePath: filePath,
          extractionMethod: extracted.extractionMethod,
          characters: extracted.characters,
          truncated: extracted.truncated,
          droppedInfo: extracted.droppedInfo || [],
        },
        error: null,
      };
    } catch (err) {
      if (err && err.code === 'ASR_REQUIRED') {
        return { text: '', ingestion: { sourcePath: filePath, extractionMethod: 'asr-required', droppedInfo: [] }, error: { code: 'ASR_REQUIRED', reason: err.message, remediation: 'Install whisper-cli (brew install whisper-cpp) or transcribe the file before sending.' } };
      }
      if (err && /WHISPER_BINARY_MISSING/.test(String(err.message))) {
        return { text: '', ingestion: { sourcePath: filePath, extractionMethod: 'asr-required', droppedInfo: [] }, error: { code: 'ASR_REQUIRED', reason: err.message, remediation: 'Install whisper-cli (brew install whisper-cpp) to transcribe audio/video.' } };
      }
      return { text: '', ingestion: { sourcePath: filePath, extractionMethod: 'failed', droppedInfo: [] }, error: { code: 'EXTRACTION_FAILED', reason: err.message, remediation: 'Verify the file is readable and of a supported type.' } };
    }
  }

  // Extensions outside the extractor registry (e.g. .parquet, an unknown
  // suffix) fall back to a flagged raw read so plain-text data still classifies
  // rather than failing outright. Recognized text types including .csv/.tsv are
  // handled above via the extraction pipeline's UTF-8 path.
  try {
    const text = readFileSync(filePath, 'utf8');
    return {
      text,
      ingestion: { sourcePath: filePath, extractionMethod: 'raw-utf8', droppedInfo: [], note: `No structured extractor for ${extname(filePath) || 'this type'}; read as plain text.` },
      error: null,
    };
  } catch (err) {
    return { text: '', ingestion: { sourcePath: filePath, extractionMethod: 'failed', droppedInfo: [] }, error: { code: 'FILE_UNREADABLE', reason: err.message, remediation: 'Check the path and permissions.' } };
  }
}
