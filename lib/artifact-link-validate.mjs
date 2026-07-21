/**
 * lib/artifact-link-validate.mjs — extract and verify http(s) citation URLs in
 * typed artifacts. Confirms each URL resolves (2xx/3xx) within a short timeout
 * so citationLint can refuse broken or non-material links before publish.
 */

const URL_RE = /\bhttps?:\/\/[^\s)\]>'"<>]+/gi;

function stripTrailingPunctuation(url) {
  return String(url || '').replace(/[).,;:]+$/g, '');
}

export function extractHttpUrls(markdown = '') {
  const text = String(markdown || '')
    .replace(/```[\s\S]*?```/g, '\n')
    .replace(/`[^`]*`/g, '');
  const found = new Set();
  for (const match of text.match(URL_RE) || []) {
    const cleaned = stripTrailingPunctuation(match);
    if (/^https?:\/\//i.test(cleaned)) found.add(cleaned);
  }
  return [...found];
}

export function urlsMissingInlineMarkdownLinks(markdown = '') {
  const text = String(markdown || '');
  const urls = extractHttpUrls(text);
  const missing = [];
  for (const url of urls) {
    const escaped = url.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const asMdLink = new RegExp(`\\[[^\\]]+\\]\\(${escaped}\\)`);
    if (!asMdLink.test(text)) missing.push(url);
  }
  return missing;
}

async function probeUrl(url, { fetchImpl = globalThis.fetch, timeoutMs = 8000 } = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    let res = await fetchImpl(url, {
      method: 'HEAD',
      redirect: 'follow',
      signal: controller.signal,
      headers: { 'user-agent': 'construct-artifact-link-validate/1.0' },
    });
    if (res.status === 405 || res.status === 403 || res.status === 501) {
      res = await fetchImpl(url, {
        method: 'GET',
        redirect: 'follow',
        signal: controller.signal,
        headers: { 'user-agent': 'construct-artifact-link-validate/1.0' },
      });
    }
    if (res.status >= 200 && res.status < 400) {
      return { ok: true, status: res.status, url: res.url || url };
    }
    return { ok: false, status: res.status, url, error: `HTTP ${res.status}` };
  } catch (err) {
    return { ok: false, status: 0, url, error: err?.name === 'AbortError' ? 'timeout' : (err?.message || 'fetch failed') };
  } finally {
    clearTimeout(timer);
  }
}

export async function validateArtifactLinks(markdown, {
  fetchImpl = globalThis.fetch,
  timeoutMs = 8000,
  requireInlineMarkdownLinks = false,
} = {}) {
  const urls = extractHttpUrls(markdown);
  const errors = [];
  const warnings = [];
  const results = [];

  if (requireInlineMarkdownLinks) {
    for (const url of urlsMissingInlineMarkdownLinks(markdown)) {
      errors.push(`citation: URL appears without an inline markdown link [label](url): ${url}`);
    }
  }

  for (const url of urls) {
    const result = await probeUrl(url, { fetchImpl, timeoutMs });
    results.push(result);
    if (!result.ok) {
      errors.push(`citation: link failed (${result.error}): ${url}`);
    }
  }

  return {
    ok: errors.length === 0,
    errors,
    warnings,
    checked: urls.length,
    results,
  };
}
