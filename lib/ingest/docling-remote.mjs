/**
 * lib/ingest/docling-remote.mjs — opt-in remote document conversion via Docling Serve.
 *
 * The `docling-remote` ingest strategy sends the document to a
 * user-configured Docling Serve API instead of the offline Python sidecar —
 * for zero-local-footprint installs that accept remote conversion. The endpoint
 * contract is Docling Serve's `POST /v1/convert/file` (multipart field `files`,
 * markdown at `document.md_content`).
 *
 * The serve URL must be configured (DOCLING_SERVE_URL); a missing URL fails loud —
 * the user explicitly chose remote, so silently degrading to the sidecar would
 * hide the misconfiguration. The call is bounded by the same timeout knob as the
 * sidecar (CONSTRUCT_DOCLING_TIMEOUT_MS, default 600s).
 */
import fs from 'node:fs';
import path from 'node:path';
import { resolveNonNegativeSetting } from '../env-config.mjs';

const DEFAULT_TIMEOUT_MS = 600_000;
const DEFAULT_HEALTH_TIMEOUT_MS = 15_000;
const HEALTH_PATHS = ['/health', '/v1/health'];

export function resolveDoclingServeUrl(env = process.env) {
  const raw = (env.DOCLING_SERVE_URL || '').trim();
  return raw ? raw.replace(/\/+$/, '') : null;
}

export function resolveDoclingServeAuthHeaders(env = process.env) {
  const bearer = (env.DOCLING_SERVE_BEARER_TOKEN || env.DOCLING_SERVE_AUTH_TOKEN || '').trim();
  if (!bearer) return {};
  return { Authorization: bearer.startsWith('Bearer ') ? bearer : `Bearer ${bearer}` };
}

function makeDegradedError(message, { reason, health = null } = {}) {
  const err = new Error(message);
  err.code = 'DOCLING_REMOTE_DEGRADED';
  err.degraded = true;
  err.reason = reason;
  err.health = health;
  return err;
}

function buildServeFetchInit({ env, signal, method = 'GET', body = undefined, contentType = undefined } = {}) {
  const headers = {
    ...resolveDoclingServeAuthHeaders(env),
    ...(contentType ? { 'content-type': contentType } : {}),
  };
  return {
    method,
    headers,
    signal,
    ...(body != null ? { body } : {}),
  };
}

/**
 * Probe Docling Serve reachability before a conversion request.
 *
 * @returns {Promise<{ ok: boolean, degraded: boolean, reason: string|null, endpoint: string|null }>}
 */
export async function checkDoclingServeHealth({
  env = process.env,
  fetchImpl = globalThis.fetch,
  timeoutMs = DEFAULT_HEALTH_TIMEOUT_MS,
} = {}) {
  const baseUrl = resolveDoclingServeUrl(env);
  if (!baseUrl) {
    return {
      ok: false,
      degraded: true,
      reason: 'DOCLING_SERVE_URL is not configured',
      endpoint: null,
    };
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    for (const healthPath of HEALTH_PATHS) {
      const endpoint = `${baseUrl}${healthPath}`;
      try {
        const res = await fetchImpl(endpoint, buildServeFetchInit({ env, signal: controller.signal }));
        if (res.ok) {
          return { ok: true, degraded: false, reason: null, endpoint };
        }
      } catch {
        /* try next health path */
      }
    }
    return {
      ok: false,
      degraded: true,
      reason: 'Docling Serve health probe failed for all known endpoints',
      endpoint: `${baseUrl}${HEALTH_PATHS[0]}`,
    };
  } catch (err) {
    const reason = err.name === 'AbortError'
      ? `Docling Serve health probe timed out after ${timeoutMs}ms`
      : (err.message || 'Docling Serve health probe failed');
    return { ok: false, degraded: true, reason, endpoint: `${baseUrl}${HEALTH_PATHS[0]}` };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Convert one local file through Docling Serve. Returns the shared extractor
 * contract ({ text, extractionMethod, characters, truncated, droppedInfo }).
 * Throws (fail-loud) on missing URL, HTTP error, non-success status, or timeout.
 */
export async function extractViaDoclingRemote({
  filePath,
  maxChars = null,
  env = process.env,
  timeoutMs = null,
  skipHealthCheck = false,
  fetchImpl = globalThis.fetch,
} = {}) {
  const baseUrl = resolveDoclingServeUrl(env);
  if (!baseUrl) {
    const err = new Error(
      "ingest.strategy is 'docling-remote' but DOCLING_SERVE_URL is not set. " +
      "Point it at a Docling Serve instance, or switch ingest.strategy back to 'adapter' (offline sidecar).",
    );
    err.code = 'DOCLING_REMOTE_UNCONFIGURED';
    throw err;
  }

  if (!skipHealthCheck) {
    const health = await checkDoclingServeHealth({ env, fetchImpl });
    if (!health.ok) {
      throw makeDegradedError(
        health.reason || 'Docling Serve is unreachable',
        { reason: health.reason, health },
      );
    }
  }

  const budget = timeoutMs ?? resolveNonNegativeSetting(env, 'CONSTRUCT_DOCLING_TIMEOUT_MS', DEFAULT_TIMEOUT_MS);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), budget);
  try {
    const form = new FormData();
    const bytes = fs.readFileSync(filePath);
    form.append('files', new Blob([bytes]), path.basename(filePath));

    const res = await fetchImpl(`${baseUrl}/v1/convert/file`, buildServeFetchInit({
      env,
      signal: controller.signal,
      method: 'POST',
      body: form,
    }));
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
