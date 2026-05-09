/**
 * lib/schema-infer.mjs — infer a structured field schema from extracted document text.
 *
 * Calls the model with a structured-output prompt and returns a normalised
 * SchemaInferenceResult. Works with any document type already handled by
 * lib/document-extract.mjs. Falls back gracefully when no API key is present.
 * Uses the configured fast-tier model from model-router rather than a hardcoded ID.
 *
 * Output shape (SchemaInferenceResult):
 *   {
 *     document_type: string,          // e.g. "invoice", "resume", "table", "report"
 *     fields: SchemaField[],
 *     relationships: Relationship[],  // cross-field or cross-record links
 *     confidence: number,             // 0.0 – 1.0
 *     notes: string[],                // caveats about truncation, ambiguity, etc.
 *     model: string,                  // model used for inference
 *     inferred_at: string,            // ISO timestamp
 *   }
 *
 * SchemaField:
 *   { name, type, description, required, pattern, example, enum, format, nested_fields }
 */

import { extractDocumentText } from './document-extract.mjs';
import { readCurrentModels, readOpenRouterApiKeyFromOpenCodeConfig } from './model-router.mjs';
import { getUserEnvPath } from './env-config.mjs';
import { pollFreeModels, topForTier } from './model-free-selector.mjs';
import { execSync } from 'node:child_process';

// ---------------------------------------------------------------------------
// Langfuse helpers — fire-and-forget, never throw into the caller.
// ---------------------------------------------------------------------------

function resolveSessionMeta() {
  const userId = process.env.USER || process.env.USERNAME || process.env.LOGNAME || undefined;
  const sessionId = process.env.CONSTRUCT_SESSION_ID
    || process.env.CLAUDE_SESSION_ID
    || process.env.CX_SESSION_ID
    || process.env.OPENCODE_SESSION_ID
    || undefined;
  const environment = process.env.NODE_ENV || process.env.CONSTRUCT_ENV || 'development';
  let release;
  try {
    release = execSync('git rev-parse --short HEAD', { stdio: 'pipe', timeout: 2000 }).toString().trim() || undefined;
  } catch { /* best effort */ }
  return { userId, sessionId, environment, release };
}

function langfuseAvailable() {
  return Boolean(process.env.LANGFUSE_PUBLIC_KEY && process.env.LANGFUSE_SECRET_KEY);
}

function langfuseBaseUrl() {
  return (process.env.LANGFUSE_BASEURL ?? 'https://cloud.langfuse.com').replace(/\/$/, '');
}

function langfuseHeaders() {
  const key = process.env.LANGFUSE_PUBLIC_KEY;
  const secret = process.env.LANGFUSE_SECRET_KEY;
  return {
    Authorization: `Basic ${Buffer.from(`${key}:${secret}`).toString('base64')}`,
    'Content-Type': 'application/json',
  };
}

async function lfIngest(body) {
  if (!langfuseAvailable()) return;
  try {
    await fetch(`${langfuseBaseUrl()}/api/public/ingestion`, {
      method: 'POST',
      headers: langfuseHeaders(),
      body: JSON.stringify({ batch: Array.isArray(body) ? body : [body] }),
    });
  } catch {
    // Observability must never break the caller.
  }
}

async function lfTrace({ id, name, input, metadata, sessionId, userId, release, environment }) {
  await lfIngest({
    id: crypto.randomUUID(),
    type: 'trace-create',
    timestamp: new Date().toISOString(),
    body: { id, name, input, metadata, sessionId, userId, release, environment, tags: ['schema-infer'] },
  });
}

async function lfGeneration({ traceId, id, name, model, input, output, startTime, endTime, level, statusMessage, usage }) {
  await lfIngest({
    id: crypto.randomUUID(),
    type: 'generation-create',
    timestamp: new Date().toISOString(),
    body: {
      id,
      traceId,
      name,
      model,
      input,
      output,
      startTime,
      endTime,
      level: level ?? 'DEFAULT',
      statusMessage,
      ...(usage ? { usage: { input: usage.input ?? 0, output: usage.output ?? 0, total: usage.total ?? 0, unit: 'TOKENS' } } : {}),
    },
  });
}

async function lfScore({ traceId, name, value, comment }) {
  if (!langfuseAvailable()) return;
  try {
    await fetch(`${langfuseBaseUrl()}/api/public/scores`, {
      method: 'POST',
      headers: langfuseHeaders(),
      body: JSON.stringify({
        id: crypto.randomUUID(),
        traceId,
        name,
        value,
        dataType: 'NUMERIC',
        comment,
      }),
    });
  } catch {
    // Observability must never break the caller.
  }
}

async function lfUpdateTrace({ id, output, metadata }) {
  await lfIngest({
    id: crypto.randomUUID(),
    type: 'trace-create',
    timestamp: new Date().toISOString(),
    body: { id, output, metadata },
  });
}

const SYSTEM_PROMPT = `You are a data modeling expert. Analyse the document text provided and infer a structured schema.

Return ONLY a valid JSON object matching this exact shape — no markdown fences, no commentary:

{
  "document_type": "<concise label, e.g. invoice | resume | table | report | contract | form | log | config>",
  "fields": [
    {
      "name": "<normalized snake_case field name>",
      "type": "<string | number | boolean | date | datetime | array | object | enum | unknown>",
      "description": "<what this field represents>",
      "required": <true|false>,
      "pattern": "<regex pattern if applicable, or null>",
      "example": "<representative value from the document, or null>",
      "enum": [<allowed values if finite set, or null>],
      "format": "<e.g. currency:USD | phone | email | url | iso-date | iso-datetime | or null>",
      "nested_fields": [<recursive SchemaField array for object/array types, or null>]
    }
  ],
  "relationships": [
    {
      "from_field": "<field name>",
      "to_field": "<field name>",
      "type": "<reference | composition | aggregation | derivation>",
      "description": "<what the relationship means>"
    }
  ],
  "confidence": <0.0 to 1.0>,
  "notes": ["<caveat or observation about the schema, e.g. truncation, ambiguous fields>"]
}

Rules:
- Infer field names from labels, headers, column names, or key patterns in the text.
- For tabular data (CSV, spreadsheet, table), every column becomes a top-level field.
- For structured documents (invoices, forms), identify all distinct data points.
- For narrative documents, identify the key entities and their attributes.
- Set confidence lower when the document is truncated, sparse, or ambiguous.
- Do NOT invent fields not evidenced in the text.
- Keep field names snake_case, lowercase.`;

const INFERENCE_TIMEOUT_MS = 30_000;

async function fetchWithTimeout(url, options) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), INFERENCE_TIMEOUT_MS);
  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

async function callModel(userContent, { traceId } = {}) {
  const orKey = process.env.OPENROUTER_API_KEY || readOpenRouterApiKeyFromOpenCodeConfig();
  const anthropicKey = process.env.ANTHROPIC_API_KEY;

  if (!orKey && !anthropicKey) {
    throw new Error('No API key found. Set ANTHROPIC_API_KEY or OPENROUTER_API_KEY to use schema inference.');
  }

  // Build a ranked candidate list: live free models (top 5) + configured fast tier as final fallback.
  let candidates = [];
  if (orKey) {
    const freeModels = await pollFreeModels(orKey);
    const envPath = getUserEnvPath();
    const configured = readCurrentModels(envPath, {});
    candidates = topForTier(freeModels, 'fast', 5).map((m) => m.id);

    // Append configured fast tier as final fallback if not already in the list.
    if (configured.fast && !candidates.includes(configured.fast)) {
      candidates.push(configured.fast);
    }
  }

  // If only Anthropic key available, use configured fast tier directly.
  if (candidates.length === 0 && anthropicKey) {
    const envPath = getUserEnvPath();
    candidates = [readCurrentModels(envPath, {}).fast];
  }

  let lastError;
  for (const modelId of candidates) {
    const isAnthropicDirect = /^anthropic\//.test(modelId) && !/^openrouter\//.test(modelId);
    const isOpenRouter = /^openrouter\//.test(modelId);

    const anthropicModelId = modelId.replace(/^anthropic\//, '');
    const openRouterModelId = isOpenRouter ? modelId.replace(/^openrouter\//, '') : modelId;

    const genId = crypto.randomUUID();
    const startTime = new Date().toISOString();

    try {
      if (isAnthropicDirect && anthropicKey) {
        const res = await fetchWithTimeout('https://api.anthropic.com/v1/messages', {
          method: 'POST',
          headers: {
            'x-api-key': anthropicKey,
            'anthropic-version': '2023-06-01',
            'content-type': 'application/json',
          },
          body: JSON.stringify({
            model: anthropicModelId,
            max_tokens: 4096,
            system: SYSTEM_PROMPT,
            messages: [{ role: 'user', content: userContent }],
          }),
        });
        if (res.status === 429) {
          lastError = new Error(`Anthropic rate-limited on ${modelId}`);
          void lfGeneration({ traceId, id: genId, name: 'schema-infer-attempt', model: modelId, input: userContent, startTime, endTime: new Date().toISOString(), level: 'WARNING', statusMessage: 'rate-limited' });
          continue;
        }
        if (!res.ok) throw new Error(`Anthropic API ${res.status}: ${await res.text()}`);
        const data = await res.json();
        const text = data.content[0].text;
        const usage = data.usage ? { input: data.usage.input_tokens ?? 0, output: data.usage.output_tokens ?? 0, total: (data.usage.input_tokens ?? 0) + (data.usage.output_tokens ?? 0) } : undefined;
        void lfGeneration({ traceId, id: genId, name: 'schema-infer-attempt', model: modelId, input: userContent, output: text, startTime, endTime: new Date().toISOString(), usage });
        return { text, model: modelId };
      }

      if (isOpenRouter && orKey) {
        const res = await fetchWithTimeout('https://openrouter.ai/api/v1/chat/completions', {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${orKey}`,
            'content-type': 'application/json',
            'HTTP-Referer': 'https://github.com/construct',
          },
          body: JSON.stringify({
            model: openRouterModelId,
            max_tokens: 4096,
            messages: [
              { role: 'system', content: SYSTEM_PROMPT },
              { role: 'user', content: userContent },
            ],
          }),
        });
        if (res.status === 429) {
          lastError = new Error(`OpenRouter rate-limited on ${modelId}`);
          void lfGeneration({ traceId, id: genId, name: 'schema-infer-attempt', model: modelId, input: userContent, startTime, endTime: new Date().toISOString(), level: 'WARNING', statusMessage: 'rate-limited' });
          continue;
        }
        if (!res.ok) throw new Error(`OpenRouter API ${res.status}: ${await res.text()}`);
        const data = await res.json();
        const content = data.choices?.[0]?.message?.content;
        if (!content) {
          lastError = new Error(`OpenRouter returned empty response from ${modelId}`);
          void lfGeneration({ traceId, id: genId, name: 'schema-infer-attempt', model: modelId, input: userContent, startTime, endTime: new Date().toISOString(), level: 'WARNING', statusMessage: 'empty-response' });
          continue;
        }
        const usage = data.usage ? { input: data.usage.prompt_tokens ?? 0, output: data.usage.completion_tokens ?? 0, total: data.usage.total_tokens ?? 0 } : undefined;
        void lfGeneration({ traceId, id: genId, name: 'schema-infer-attempt', model: modelId, input: userContent, output: content, startTime, endTime: new Date().toISOString(), usage });
        return { text: content, model: modelId };
      }
    } catch (err) {
      // Re-throw non-rate-limit, non-timeout errors immediately.
      if (!/rate.limit|429/i.test(err.message) && err.name !== 'AbortError') throw err;
      lastError = err.name === 'AbortError'
        ? new Error(`Timed out waiting for ${modelId} after ${INFERENCE_TIMEOUT_MS}ms`)
        : err;
      void lfGeneration({ traceId, id: genId, name: 'schema-infer-attempt', model: modelId, input: userContent, startTime, endTime: new Date().toISOString(), level: 'ERROR', statusMessage: lastError.message });
    }
  }

  throw lastError ?? new Error('All model candidates exhausted for schema inference');
}

function parseInferenceResponse(raw) {
  const text = typeof raw === 'string' ? raw.trim() : '';

  // Strip markdown fences if the model emits them despite instructions.
  const stripped = text.replace(/^```(?:json)?\s*/i, '').replace(/\s*```\s*$/, '').trim();

  try {
    const parsed = JSON.parse(stripped);
    if (!parsed || typeof parsed !== 'object') throw new Error('not an object');
    return parsed;
  } catch (err) {
    throw new Error(`Schema inference returned invalid JSON: ${err.message}\n---\n${text.slice(0, 500)}`);
  }
}

function buildUserPrompt(extracted) {
  const truncationNote = extracted.truncated
    ? `\n\n[NOTE: document was truncated to ${extracted.characters.toLocaleString()} characters]`
    : '';

  return [
    `Document path: ${extracted.filePath}`,
    `Document type hint: ${extracted.extension}`,
    `Extraction method: ${extracted.extractionMethod}`,
    '',
    '--- BEGIN DOCUMENT TEXT ---',
    extracted.text,
    '--- END DOCUMENT TEXT ---',
    truncationNote,
  ].join('\n');
}

/**
 * Infer a structured schema from a document file.
 *
 * @param {string} filePath  Absolute or relative path to the source document.
 * @param {object} opts
 * @param {number} [opts.maxChars=40000]  Characters of document text to send to the model.
 * @returns {Promise<SchemaInferenceResult>}
 */
export async function inferDocumentSchema(filePath, { maxChars = 40_000 } = {}) {
  const traceId = crypto.randomUUID();
  const traceName = 'schema-infer';
  const { userId, sessionId, environment, release } = resolveSessionMeta();

  void lfTrace({
    id: traceId,
    name: traceName,
    input: { filePath, maxChars },
    metadata: { source: 'schema-infer', filePath },
    sessionId,
    userId,
    release,
    environment,
  });

  const extracted = extractDocumentText(filePath, { maxChars });
  if (!extracted.text || extracted.text.trim().length === 0) {
    void lfUpdateTrace({ id: traceId, output: { error: 'no-text-extracted' }, metadata: { status: 'error' } });
    throw new Error(`No text could be extracted from: ${filePath}`);
  }

  const userPrompt = buildUserPrompt(extracted);

  let callResult;
  try {
    callResult = await callModel(userPrompt, { traceId });
  } catch (err) {
    void lfUpdateTrace({ id: traceId, output: { error: err.message }, metadata: { status: 'error' } });
    throw err;
  }

  const parsed = parseInferenceResponse(callResult.text);

  const result = {
    document_type: String(parsed.document_type || 'unknown'),
    fields: Array.isArray(parsed.fields) ? parsed.fields : [],
    relationships: Array.isArray(parsed.relationships) ? parsed.relationships : [],
    confidence: typeof parsed.confidence === 'number' ? Math.min(1, Math.max(0, parsed.confidence)) : 0,
    notes: Array.isArray(parsed.notes) ? parsed.notes : [],
    source_path: extracted.filePath,
    source_extension: extracted.extension,
    source_characters: extracted.characters,
    source_truncated: extracted.truncated,
    model: callResult.model,
    inferred_at: new Date().toISOString(),
  };

  void lfUpdateTrace({
    id: traceId,
    output: { document_type: result.document_type, field_count: result.fields.length, confidence: result.confidence, model: result.model },
    metadata: { status: 'success', model: result.model },
  });

  void lfScore({ traceId, name: 'confidence', value: result.confidence, comment: `${result.fields.length} fields inferred from ${result.source_extension ?? 'unknown'} document` });

  return result;
}

/**
 * Infer schemas from multiple documents and return a reconciled unified schema.
 *
 * Useful when N documents share a format (e.g. 50 invoices → one canonical schema).
 * Fields that appear in ≥ threshold fraction of documents are kept; required is set
 * to true only when required across all sampled documents.
 *
 * @param {string[]} filePaths
 * @param {object} opts
 * @param {number} [opts.maxChars=40000]
 * @param {number} [opts.sampleSize=10]    Max documents to sample.
 * @param {number} [opts.threshold=0.5]    Field inclusion threshold (0–1).
 * @returns {Promise<UnifiedSchemaResult>}
 */
export async function inferUnifiedSchema(filePaths, { maxChars = 40_000, sampleSize = 10, threshold = 0.5 } = {}) {
  if (!Array.isArray(filePaths) || filePaths.length === 0) {
    throw new Error('At least one file path is required');
  }

  const traceId = crypto.randomUUID();
  const { userId, sessionId, environment, release } = resolveSessionMeta();

  void lfTrace({
    id: traceId,
    name: 'schema-infer-unified',
    input: { filePaths, maxChars, sampleSize, threshold },
    metadata: { source: 'schema-infer', fileCount: filePaths.length },
    sessionId,
    userId,
    release,
    environment,
  });

  const sample = filePaths.slice(0, sampleSize);
  const results = await Promise.allSettled(sample.map((fp) => inferDocumentSchema(fp, { maxChars })));

  const successes = results
    .filter((r) => r.status === 'fulfilled')
    .map((r) => r.value);

  const failures = results
    .filter((r) => r.status === 'rejected')
    .map((r, i) => ({ file: sample[i], error: r.reason?.message || String(r.reason) }));

  if (successes.length === 0) {
    void lfUpdateTrace({ id: traceId, output: { error: 'all-documents-failed' }, metadata: { status: 'error' } });
    throw new Error('Schema inference failed for all sampled documents');
  }

  // Reconcile: count field occurrences across all successful inferences.
  const fieldMap = new Map();
  for (const result of successes) {
    const seen = new Set();
    for (const field of result.fields) {
      const key = field.name;
      if (!key || seen.has(key)) continue;
      seen.add(key);

      if (!fieldMap.has(key)) {
        fieldMap.set(key, { field: { ...field }, count: 0, requiredCount: 0 });
      }
      const entry = fieldMap.get(key);
      entry.count += 1;
      if (field.required) entry.requiredCount += 1;

      // Accumulate examples and enums.
      if (field.example && !entry.field.example) entry.field.example = field.example;
      if (Array.isArray(field.enum) && field.enum.length > 0) {
        entry.field.enum = [...new Set([...(entry.field.enum || []), ...field.enum])];
      }
    }
  }

  const minCount = Math.ceil(successes.length * threshold);
  const unifiedFields = [];
  for (const [, entry] of fieldMap) {
    if (entry.count >= minCount) {
      unifiedFields.push({
        ...entry.field,
        required: entry.requiredCount === successes.length,
        occurrence_rate: Math.round((entry.count / successes.length) * 100) / 100,
      });
    }
  }

  // Sort by occurrence_rate descending then name ascending.
  unifiedFields.sort((a, b) => (b.occurrence_rate - a.occurrence_rate) || a.name.localeCompare(b.name));

  const avgConfidence = successes.reduce((s, r) => s + r.confidence, 0) / successes.length;
  const documentTypes = [...new Set(successes.map((r) => r.document_type).filter(Boolean))];

  const unified = {
    document_type: documentTypes.length === 1 ? documentTypes[0] : documentTypes.join(' | '),
    document_types_seen: documentTypes,
    fields: unifiedFields,
    confidence: Math.round(avgConfidence * 100) / 100,
    sampled: sample.length,
    succeeded: successes.length,
    failed: failures.length,
    failures,
    threshold,
    inferred_at: new Date().toISOString(),
  };

  void lfUpdateTrace({
    id: traceId,
    output: { document_type: unified.document_type, field_count: unifiedFields.length, confidence: unified.confidence, succeeded: unified.succeeded, failed: unified.failed },
    metadata: { status: 'success' },
  });
  void lfScore({ traceId, name: 'confidence', value: unified.confidence, comment: `${unifiedFields.length} unified fields from ${unified.succeeded}/${sample.length} documents` });

  return unified;
}

/**
 * CLI entrypoint for `construct infer`.
 */
export async function runInferCli(argv = process.argv.slice(2), { cwd = process.cwd() } = {}) {
  const inputs = [];
  let maxChars = 40_000;
  let unified = false;
  let sampleSize = 10;
  let threshold = 0.5;

  for (const arg of argv) {
    if (arg.startsWith('--max-chars=')) maxChars = Number(arg.split('=')[1]) || 40_000;
    else if (arg.startsWith('--sample=')) sampleSize = Number(arg.split('=')[1]) || 10;
    else if (arg.startsWith('--threshold=')) threshold = Number(arg.split('=')[1]) || 0.5;
    else if (arg === '--unified') unified = true;
    else inputs.push(arg);
  }

  if (inputs.length === 0) {
    throw new Error(
      'Usage: construct infer <file> [more files] [--unified] [--max-chars=N] [--sample=N] [--threshold=0.5]'
    );
  }

  // Resolve all inputs relative to cwd.
  const { resolve: resolvePath } = await import('node:path');
  const resolved = inputs.map((p) => (p.startsWith('/') ? p : resolvePath(cwd, p)));

  if (unified || resolved.length > 1) {
    return inferUnifiedSchema(resolved, { maxChars, sampleSize, threshold });
  }

  return inferDocumentSchema(resolved[0], { maxChars });
}
