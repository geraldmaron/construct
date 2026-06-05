/**
 * lib/ingest/provider-extract.mjs — concrete provider-backed document extraction.
 *
 * The `provider` ingest strategy routes document understanding through the
 * configured provider/model instead of the local binary adapters. This module
 * is that route: it reads a file, builds a provider-native request, and returns
 * extracted text in the same shape `extractDocumentTextAsync` produces so every
 * caller treats adapter and provider results uniformly.
 *
 * Capability is honest, never silently degraded. Images and PDFs are sent as
 * multimodal blocks (Anthropic `image`/`document`, OpenRouter `image_url`);
 * text-class files are sent inline for faithful extraction/normalization;
 * audio/video and Office/zip documents are NOT chat-extractable and raise a
 * specific `PROVIDER_MEDIA_UNSUPPORTED` so the strategy's fallback policy — not
 * a hidden code path — decides whether the local adapter handles them. Provider
 * selection follows the resolved model (Anthropic when the provider/model is
 * Claude-family, OpenRouter otherwise); a missing key surfaces as a structured
 * `PROVIDER_KEY_MISSING` rather than an opaque HTTP failure.
 *
 * `fetchImpl` and `env` are injectable so the provider path is exercised end to
 * end against a mock provider without a live key.
 */

import { readFileSync, existsSync } from 'node:fs';
import { extname, join } from 'node:path';
import { homedir } from 'node:os';

import {
  AUDIO_VIDEO_EXTS,
  UTF8_TEXT_EXTS,
  TRANSCRIPT_EXTS,
  CALENDAR_EXTS,
} from '../document-extract.mjs';

export const PROVIDER_IMAGE_EXTS = new Set(['.png', '.jpg', '.jpeg', '.gif', '.webp']);

const IMAGE_MIME = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
};

const DEFAULT_PROMPT = 'Extract the complete textual content of this document faithfully and verbatim. Preserve headings, lists, and tables as Markdown. Do not summarize, interpret, or add commentary — output only the extracted content.';

const MAX_OUTPUT_TOKENS = 4096;

function providerError(code, reason, remediation) {
  const err = new Error(reason);
  err.code = code;
  err.remediation = remediation;
  return err;
}

function classifyMedia(filePath) {
  const ext = extname(filePath).toLowerCase();
  if (PROVIDER_IMAGE_EXTS.has(ext)) return 'image';
  if (ext === '.pdf') return 'pdf';
  if (AUDIO_VIDEO_EXTS.has(ext)) return 'audio-video';
  if (UTF8_TEXT_EXTS.has(ext) || TRANSCRIPT_EXTS.has(ext) || CALENDAR_EXTS.has(ext)) return 'text';
  return 'binary-doc';
}

function isAnthropic(provider, model) {
  return /anthropic|claude/i.test(provider || '') || /claude/i.test(model || '');
}

// Key resolution mirrors the daemon's cheap sources (env, then the two dotenv
// files) without the shell-rc/1Password walk, which belongs to long-running
// processes rather than a per-file extraction call. Ambient dotenv discovery
// only augments the real process env; a caller that injects an explicit env
// object (embedded callers, tests) is authoritative and hermetic.

function resolveKey(varName, env, allowAmbient) {
  if (env[varName] && typeof env[varName] === 'string' && env[varName].length > 0) return env[varName];
  if (!allowAmbient) return null;
  for (const file of [join(homedir(), '.construct', 'config.env'), join(homedir(), '.env')]) {
    try {
      if (!existsSync(file)) continue;
      const m = readFileSync(file, 'utf8').match(new RegExp(`^${varName}=["']?(.+?)["']?$`, 'm'));
      if (m && m[1]) return m[1].trim();
    } catch { /* unreadable dotenv is not authoritative */ }
  }
  return null;
}

async function bodyExcerpt(res) {
  try {
    const text = await res.text();
    return text.slice(0, 200);
  } catch {
    return '';
  }
}

async function callAnthropic({ model, apiKey, content, fetchImpl }) {
  const res = await fetchImpl('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: { 'x-api-key': apiKey, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
    body: JSON.stringify({
      model: model.replace(/^anthropic\//, ''),
      max_tokens: MAX_OUTPUT_TOKENS,
      messages: [{ role: 'user', content }],
    }),
  });
  if (!res.ok) {
    throw providerError('PROVIDER_EXTRACTION_FAILED', `Anthropic extraction failed (HTTP ${res.status}): ${await bodyExcerpt(res)}`, 'Verify the model id and ANTHROPIC_API_KEY, or set ingest.fallback to "adapter".');
  }
  const data = await res.json();
  return (data.content || []).filter((b) => b && b.type === 'text').map((b) => b.text).join('');
}

async function callOpenRouter({ model, apiKey, content, fetchImpl }) {
  const res = await fetchImpl('https://openrouter.ai/api/v1/chat/completions', {
    method: 'POST',
    headers: { Authorization: `Bearer ${apiKey}`, 'content-type': 'application/json', 'HTTP-Referer': 'https://github.com/geraldmaron/construct' },
    body: JSON.stringify({
      model: model.replace(/^openrouter\//, ''),
      max_tokens: MAX_OUTPUT_TOKENS,
      messages: [{ role: 'user', content }],
    }),
  });
  if (!res.ok) {
    throw providerError('PROVIDER_EXTRACTION_FAILED', `OpenRouter extraction failed (HTTP ${res.status}): ${await bodyExcerpt(res)}`, 'Verify the model id and OPENROUTER_API_KEY, or set ingest.fallback to "adapter".');
  }
  const data = await res.json();
  return data.choices?.[0]?.message?.content || '';
}

/**
 * Extract a document's text through the configured provider/model.
 *
 * @param {object} opts
 * @param {string} opts.filePath
 * @param {string} opts.model            resolved provider model id
 * @param {string} [opts.provider]       resolved provider id (selects the API)
 * @param {number} [opts.maxChars]       truncate returned text to this length
 * @param {Record<string,string>} [opts.env]
 * @param {Function} [opts.fetchImpl]    injectable fetch (for tests)
 * @param {string} [opts.prompt]
 * @returns {Promise<{text:string, extractionMethod:string, characters:number, truncated:boolean, droppedInfo:Array}>}
 */
export async function extractViaProvider({ filePath, model, provider = null, maxChars = null, env = process.env, fetchImpl = globalThis.fetch, prompt = DEFAULT_PROMPT } = {}) {
  if (!filePath) throw providerError('PROVIDER_NO_INPUT', 'No file path supplied for provider extraction.', 'Pass a readable file path.');
  if (!model) throw providerError('PROVIDER_MODEL_UNRESOLVED', 'Provider strategy selected but no provider model resolved.', 'Configure the model tier registry so the ingest tier resolves a model, or set ingest.fallback to "adapter".');
  if (typeof fetchImpl !== 'function') throw providerError('PROVIDER_NO_FETCH', 'No fetch implementation available for provider extraction.', 'Run on a runtime with global fetch (Node 18+) or inject fetchImpl.');

  const media = classifyMedia(filePath);
  if (media === 'audio-video') {
    throw providerError('PROVIDER_MEDIA_UNSUPPORTED', `Provider chat extraction does not transcribe audio/video (${extname(filePath)}).`, 'Use the adapter strategy (whisper ASR) for audio/video, or set ingest.fallback to "adapter".');
  }
  if (media === 'binary-doc') {
    throw providerError('PROVIDER_MEDIA_UNSUPPORTED', `Provider chat extraction does not accept ${extname(filePath) || 'this type'} directly.`, 'Use the adapter strategy for Office/zip documents, or set ingest.fallback to "adapter".');
  }

  const anthropic = isAnthropic(provider, model);
  const keyVar = anthropic ? 'ANTHROPIC_API_KEY' : 'OPENROUTER_API_KEY';
  const apiKey = resolveKey(keyVar, env, env === process.env);
  if (!apiKey) {
    throw providerError('PROVIDER_KEY_MISSING', `No API key for ${anthropic ? 'Anthropic' : 'OpenRouter'} provider extraction.`, `Set ${keyVar}, or set ingest.fallback to "adapter".`);
  }

  let text;
  if (media === 'text') {
    const raw = readFileSync(filePath, 'utf8');
    const promptText = `${prompt}\n\n---\n${raw}`;
    text = anthropic
      ? await callAnthropic({ model, apiKey, fetchImpl, content: [{ type: 'text', text: promptText }] })
      : await callOpenRouter({ model, apiKey, fetchImpl, content: promptText });
  } else {
    const base64 = readFileSync(filePath).toString('base64');
    if (anthropic) {
      const mediaBlock = media === 'image'
        ? { type: 'image', source: { type: 'base64', media_type: IMAGE_MIME[extname(filePath).toLowerCase()], data: base64 } }
        : { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: base64 } };
      text = await callAnthropic({ model, apiKey, fetchImpl, content: [mediaBlock, { type: 'text', text: prompt }] });
    } else if (media === 'pdf') {
      throw providerError('PROVIDER_MEDIA_UNSUPPORTED', 'PDF provider extraction requires an Anthropic-family model in this build.', 'Select an Anthropic ingest model, or set ingest.fallback to "adapter".');
    } else {
      const dataUrl = `data:${IMAGE_MIME[extname(filePath).toLowerCase()]};base64,${base64}`;
      text = await callOpenRouter({ model, apiKey, fetchImpl, content: [{ type: 'text', text: prompt }, { type: 'image_url', image_url: { url: dataUrl } }] });
    }
  }

  text = text || '';
  let truncated = false;
  if (maxChars && text.length > maxChars) {
    text = text.slice(0, maxChars);
    truncated = true;
  }

  return {
    text,
    extractionMethod: `provider:${anthropic ? 'anthropic' : 'openrouter'}:${model}`,
    characters: text.length,
    truncated,
    droppedInfo: [],
  };
}
