/**
 * lib/ingest/docling-remote.mjs — opt-in remote document conversion via Docling Serve.
 *
 * The `docling-remote` ingest strategy (ADR-0036) sends the document to a
 * user-configured Docling Serve API instead of the offline Python sidecar —
 * for zero-local-footprint installs that accept remote conversion. The endpoint
 * contract is Docling Serve's `POST /v1/convert/file` (multipart field `files`,
 * markdown at `document.md_content`, per docling-serve docs/usage.md).
 *
 * The serve URL must be configured (DOCLING_SERVE_URL); a missing URL fails loud —
 * the user explicitly chose remote, so silently degrading to the sidecar would
 * hide the misconfiguration. The call is bounded by the same timeout knob as the
 * sidecar (CONSTRUCT_DOCLING_TIMEOUT_MS, default 600s).
 */
import fs from 'node:fs';
import path from 'node:path';
import { resolveMsSetting } from '../env-config.mjs';

const DEFAULT_TIMEOUT_MS = 600_000;

export function resolveDoclingServeUrl(env = process.env) {
  const raw = (env.DOCLING_SERVE_URL || '').trim();
  return raw ? raw.replace(/\/+$/, '') : null;
}

/**
 * Convert one local file through Docling Serve. Returns the shared extractor
 * contract ({ text, extractionMethod, characters, truncated, droppedInfo }).
 * Throws (fail-loud) on missing URL, HTTP error, non-success status, or timeout.
 */
export async function extractViaDoclingRemote({ filePath, maxChars = null, env = process.env, timeoutMs = null } = {}) {
  const baseUrl = resolveDoclingServeUrl(env);
  if (!baseUrl) {
    const err = new Error(
      "ingest.strategy is 'docling-remote' but DOCLING_SERVE_URL is not set. " +
      "Point it at a Docling Serve instance, or switch ingest.strategy back to 'adapter' (offline sidecar).",
    );
    err.code = 'DOCLING_REMOTE_UNCONFIGURED';
    throw err;
  }

  const budget = timeoutMs ?? resolveMsSetting(env, 'CONSTRUCT_DOCLING_TIMEOUT_MS', DEFAULT_TIMEOUT_MS);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), budget);
  try {
    const form = new FormData();
    const bytes = fs.readFileSync(filePath);
    form.append('files', new Blob([bytes]), path.basename(filePath));

    const res = await fetch(`${baseUrl}/v1/convert/file`, {
      method: 'POST',
      body: form,
      signal: controller.signal,
    });
    if (!res.ok) {
      const err = new Error(`Docling Serve returned HTTP ${res.status} for ${path.basename(filePath)}`);
      err.code = 'DOCLING_REMOTE_HTTP';
      throw err;
    }
    const data = await res.json();
    const status = data?.status;
    const markdown = data?.document?.md_content;
    if ((status && status !== 'success' && status !== 'partial_success') || typeof markdown !== 'string') {
      const detail = Array.isArray(data?.errors) && data.errors.length ? `: ${JSON.stringify(data.errors).slice(0, 200)}` : '';
      const err = new Error(`Docling Serve conversion ${status || 'returned no markdown'}${detail}`);
      err.code = 'DOCLING_REMOTE_FAILED';
      throw err;
    }

    const truncated = maxChars != null && markdown.length > maxChars;
    const text = truncated ? markdown.slice(0, maxChars) : markdown;
    return {
      text,
      extractionMethod: 'docling-remote',
      characters: text.length,
      truncated,
      droppedInfo: status === 'partial_success'
        ? [{ type: 'partial-conversion', count: 1, reason: 'Docling Serve reported partial_success', recoverable: true }]
        : [],
    };
  } catch (err) {
    if (err.name === 'AbortError') {
      const e = new Error(`Docling Serve conversion timed out after ${budget}ms`);
      e.code = 'DOCLING_REMOTE_TIMEOUT';
      throw e;
    }
    throw err;
  } finally {
    clearTimeout(timer);
  }
}
