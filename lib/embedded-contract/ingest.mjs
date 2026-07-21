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
 * receive the resolved text plus an `ingestion` metadata block to echo back. The
 * `ingestion` block records the resolved strategy (adapter | provider) and the
 * provider/model when one was selected, so the extraction choice is never opaque.
 */

import { readFileSync } from 'node:fs';
import { extname } from 'node:path';

import { extractDocumentTextAsync, isExtractableDocumentPath } from '../document-extract.mjs';
import { loadProjectConfig } from '../config/project-config.mjs';
import { resolveIngestStrategy } from '../ingest/strategy.mjs';
import { extractViaProvider } from '../ingest/provider-extract.mjs';

/**
 * Resolve contract input from inline text or a file path.
 *
 * @param {object} opts
 * @param {string} [opts.input]     Inline text (returned as-is when provided).
 * @param {string} [opts.filePath]  Path to extract when no inline text is given.
 * @param {number} [opts.maxChars]
 * @param {object} [opts.config]    Loaded project config (for strategy resolution).
 * @param {Record<string,string>} [opts.env]
 * @param {string} [opts.strategy]  Explicit strategy override.
 * @param {string} [opts.cwd]       Working directory for locating project config.
 * @param {Function} [opts.fetchImpl] Injectable fetch for provider extraction (tests).
 * @returns {Promise<{text:string, ingestion:(object|null), error:(object|null)}>}
 */
export async function resolveInput({ input = '', filePath = '', maxChars = null, config = null, env = process.env, strategy = null, cwd = process.cwd(), fetchImpl = undefined } = {}) {
  if (input && input.trim()) {
    return { text: input, ingestion: null, error: null };
  }
  if (!filePath) {
    return { text: '', ingestion: null, error: null };
  }

  const projectConfig = config || loadProjectConfig(cwd, env).config;
  const resolved = resolveIngestStrategy({ config: projectConfig, env, override: strategy });
  const strategyMeta = { strategy: resolved.strategy, fallback: resolved.fallback, model: resolved.model, provider: resolved.provider };

  // Provider strategy runs a concrete provider-backed extraction. On failure
  // the fallback policy decides: `adapter` routes to the local extractor and
  // records the fallback; any other policy surfaces the structured provider
  // error rather than silently masking the strategy mismatch.

  let providerFallback = null;
  if (resolved.strategy === 'provider') {
    try {
      const extracted = await extractViaProvider({ filePath, model: resolved.model, provider: resolved.provider, maxChars, env, ...(fetchImpl ? { fetchImpl } : {}) });
      return {
        text: extracted.text || '',
        ingestion: {
          sourcePath: filePath,
          extractionMethod: extracted.extractionMethod,
          characters: extracted.characters,
          truncated: extracted.truncated,
          droppedInfo: extracted.droppedInfo || [],
          ...strategyMeta,
          fallbackApplied: null,
        },
        error: null,
      };
    } catch (providerErr) {
      if (resolved.fallback !== 'adapter') {
        return {
          text: '',
          ingestion: { sourcePath: filePath, extractionMethod: 'provider-failed', droppedInfo: [], ...strategyMeta },
          error: {
            code: providerErr.code || 'PROVIDER_EXTRACTION_FAILED',
            reason: providerErr.message,
            remediation: providerErr.remediation || 'Set ingest.fallback to "adapter" to use the local extractor, or select the adapter strategy.',
          },
        };
      }
      providerFallback = { from: 'provider', to: 'adapter', reason: providerErr.message, code: providerErr.code || 'PROVIDER_EXTRACTION_FAILED' };
    }
  }

  if (isExtractableDocumentPath(filePath)) {
    try {
      const extracted = await extractDocumentTextAsync(filePath, { maxChars });
      if (extracted.unsupported) {
        return {
          text: '',
          ingestion: {
            sourcePath: filePath,
            extractionMethod: extracted.extractionMethod,
            routingTier: extracted.routingTier,
            unsupported: true,
            manualRecovery: true,
            characters: 0,
            truncated: false,
            droppedInfo: extracted.droppedInfo || [],
            ...strategyMeta,
            fallbackApplied: providerFallback,
          },
          error: {
            code: 'EXTRACTION_UNSUPPORTED',
            reason: extracted.droppedInfo?.[0]?.reason || 'No extraction tier matched this document.',
            remediation: extracted.remediation || 'Install docling or convert the document manually.',
          },
        };
      }
      return {
        text: extracted.text || '',
        ingestion: {
          sourcePath: filePath,
          extractionMethod: extracted.extractionMethod,
          routingTier: extracted.routingTier ?? null,
          characters: extracted.characters,
          truncated: extracted.truncated,
          droppedInfo: extracted.droppedInfo || [],
          ...strategyMeta,
          fallbackApplied: providerFallback,
        },
        error: null,
      };
    } catch (err) {
      if (err && err.code === 'ASR_REQUIRED') {
        return { text: '', ingestion: { sourcePath: filePath, extractionMethod: 'asr-required', droppedInfo: [], ...strategyMeta }, error: { code: 'ASR_REQUIRED', reason: err.message, remediation: 'Install whisper-cli (brew install whisper-cpp) or transcribe the file before sending.' } };
      }
      if (err && /WHISPER_BINARY_MISSING/.test(String(err.message))) {
        return { text: '', ingestion: { sourcePath: filePath, extractionMethod: 'asr-required', droppedInfo: [], ...strategyMeta }, error: { code: 'ASR_REQUIRED', reason: err.message, remediation: 'Install whisper-cli (brew install whisper-cpp) to transcribe audio/video.' } };
      }
      return { text: '', ingestion: { sourcePath: filePath, extractionMethod: 'failed', droppedInfo: [], ...strategyMeta }, error: { code: 'EXTRACTION_FAILED', reason: err.message, remediation: 'Verify the file is readable and of a supported type.' } };
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
      ingestion: { sourcePath: filePath, extractionMethod: 'raw-utf8', droppedInfo: [], note: `No structured extractor for ${extname(filePath) || 'this type'}; read as plain text.`, ...strategyMeta, fallbackApplied: providerFallback },
      error: null,
    };
  } catch (err) {
    return { text: '', ingestion: { sourcePath: filePath, extractionMethod: 'failed', droppedInfo: [], ...strategyMeta }, error: { code: 'FILE_UNREADABLE', reason: err.message, remediation: 'Check the path and permissions.' } };
  }
}
