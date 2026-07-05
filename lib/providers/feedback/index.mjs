/**
 * lib/providers/feedback/index.mjs — Feedback / customer-input data-source provider.
 *
 * Reads a drop-directory of JSONL or CSV files (survey exports, support-ticket
 * dumps, user-research notes) and normalizes every row into a `feedback-item`
 * record: { id, text, author, date, source, tags, provenance }. Field mapping
 * is caller-configured so arbitrary export schemas can map onto the same
 * shape; only `id` and `text` are required in the mapping, the rest default
 * to null/empty when unmapped or absent.
 *
 * Capabilities: read, search.
 *
 * Config (per call):
 *   - root: absolute or relative path to the drop-directory (required)
 *   - format: 'jsonl' | 'csv' (required)
 *   - fields: { id, text, author?, date?, source?, tags? } column/key mapping (required)
 *
 * Malformed rows (missing required mapped fields, unparsable JSON/CSV lines)
 * are skipped, never thrown — each skip increments a per-file counter and a
 * single warning summarizing the count is emitted per file via console.warn.
 *
 * Trust: feedback content originates from external, unauthenticated sources
 * (customers, survey respondents) with no authorship verification available
 * to Construct. Every item is stamped EXTERNAL_UNAUTHENTICATED per the N1
 * trust taxonomy (lib/security/trust.mjs) — highest injection risk, must be
 * wrapped before entering model context.
 */

import { existsSync, statSync, readdirSync, readFileSync } from 'node:fs';
import { resolve, isAbsolute, join, extname } from 'node:path';
import { TRUST_LEVELS, stampTrust } from '../../security/trust.mjs';

/**
 * Resolve and validate the configured drop-directory root.
 */
function resolveRoot(root) {
  if (!root) return { ok: false, reason: 'config.root required' };
  const rootPath = isAbsolute(root) ? root : resolve(process.cwd(), root);
  if (!existsSync(rootPath)) {
    return { ok: false, reason: `root does not exist: ${rootPath}` };
  }
  const stat = statSync(rootPath);
  if (!stat.isDirectory()) {
    return { ok: false, reason: `root is not a directory: ${rootPath}` };
  }
  return { ok: true, path: rootPath };
}

/**
 * List files under root matching the configured format's extension.
 */
function listFormatFiles(rootPath, format) {
  const ext = format === 'csv' ? '.csv' : '.jsonl';
  let entries;
  try {
    entries = readdirSync(rootPath, { withFileTypes: true });
  } catch {
    return [];
  }
  return entries
    .filter((e) => e.isFile() && extname(e.name).toLowerCase() === ext)
    .map((e) => e.name)
    .sort();
}

/**
 * Minimal RFC-4180-ish CSV line splitter supporting quoted fields, escaped
 * quotes (""), and commas/newlines within quotes. No external dependency —
 * the repo has none for CSV, and drop-dir exports are expected to be simple.
 */
function parseCsv(content) {
  const rows = [];
  let row = [];
  let field = '';
  let inQuotes = false;
  let i = 0;

  while (i < content.length) {
    const ch = content[i];

    if (inQuotes) {
      if (ch === '"') {
        if (content[i + 1] === '"') {
          field += '"';
          i += 2;
          continue;
        }
        inQuotes = false;
        i += 1;
        continue;
      }
      field += ch;
      i += 1;
      continue;
    }

    if (ch === '"') {
      inQuotes = true;
      i += 1;
      continue;
    }
    if (ch === ',') {
      row.push(field);
      field = '';
      i += 1;
      continue;
    }
    if (ch === '\r') {
      i += 1;
      continue;
    }
    if (ch === '\n') {
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
      i += 1;
      continue;
    }
    field += ch;
    i += 1;
  }

  if (field.length > 0 || row.length > 0) {
    row.push(field);
    rows.push(row);
  }

  return rows;
}

/**
 * Extract a mapped field from a source object; returns undefined when the
 * mapping key is unset or the source object lacks that key.
 */
function mapField(sourceObj, mappingKey) {
  if (!mappingKey) return undefined;
  return sourceObj[mappingKey];
}

/**
 * Normalize a raw mapped row into the canonical feedback-item shape, minus
 * provenance and trust (added by the caller). Returns null when required
 * fields (id, text) are missing — caller counts this as a skip.
 */
function normalizeRow(rawObj, fields) {
  const id = mapField(rawObj, fields.id);
  const text = mapField(rawObj, fields.text);

  if (id === undefined || id === null || String(id).trim() === '') return null;
  if (text === undefined || text === null || String(text).trim() === '') return null;

  const author = mapField(rawObj, fields.author);
  const date = mapField(rawObj, fields.date);
  const source = mapField(rawObj, fields.source);
  const rawTags = fields.tags ? mapField(rawObj, fields.tags) : undefined;

  let tags = [];
  if (Array.isArray(rawTags)) {
    tags = rawTags.map(String);
  } else if (typeof rawTags === 'string' && rawTags.trim() !== '') {
    tags = rawTags.split(/[;,|]/).map((t) => t.trim()).filter(Boolean);
  }

  return {
    id: String(id),
    text: String(text),
    author: author != null ? String(author) : null,
    date: date != null ? String(date) : null,
    source: source != null ? String(source) : null,
    tags,
  };
}

/**
 * Parse a single JSONL file into feedback-items. Malformed lines (unparsable
 * JSON, missing required fields) are skipped; the count is returned so the
 * caller can emit one warning per file.
 */
function readJsonlFile(filePath, fields) {
  const items = [];
  let skipped = 0;
  const content = readFileSync(filePath, 'utf8');
  const lines = content.split(/\r?\n/);

  for (let lineNo = 0; lineNo < lines.length; lineNo++) {
    const line = lines[lineNo].trim();
    if (line === '') continue;

    let parsed;
    try {
      parsed = JSON.parse(line);
    } catch {
      skipped += 1;
      continue;
    }

    if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
      skipped += 1;
      continue;
    }

    const normalized = normalizeRow(parsed, fields);
    if (!normalized) {
      skipped += 1;
      continue;
    }

    items.push({ ...normalized, row: lineNo + 1 });
  }

  return { items, skipped };
}

/**
 * Parse a single CSV file into feedback-items. First row is the header.
 * Malformed rows (column-count mismatch, missing required fields) are
 * skipped; the count is returned so the caller can emit one warning per file.
 */
function readCsvFile(filePath, fields) {
  const items = [];
  let skipped = 0;
  const content = readFileSync(filePath, 'utf8');
  const rows = parseCsv(content);

  if (rows.length === 0) return { items, skipped };

  const header = rows[0];

  for (let rowNo = 1; rowNo < rows.length; rowNo++) {
    const row = rows[rowNo];
    if (row.length === 1 && row[0] === '') continue;

    if (row.length !== header.length) {
      skipped += 1;
      continue;
    }

    const rawObj = {};
    for (let c = 0; c < header.length; c++) {
      rawObj[header[c]] = row[c];
    }

    const normalized = normalizeRow(rawObj, fields);
    if (!normalized) {
      skipped += 1;
      continue;
    }

    items.push({ ...normalized, row: rowNo + 1 });
  }

  return { items, skipped };
}

/**
 * Validate the required config shape shared by read/search.
 */
function validateConfig(config) {
  const root = config?.root;
  const format = config?.format;
  const fields = config?.fields;

  const resolved = resolveRoot(root);
  if (!resolved.ok) throw new Error(`feedback: ${resolved.reason}`);

  if (format !== 'jsonl' && format !== 'csv') {
    throw new Error(`feedback: config.format must be 'jsonl' or 'csv' (got '${format}')`);
  }

  if (!fields || typeof fields !== 'object' || !fields.id || !fields.text) {
    throw new Error('feedback: config.fields.id and config.fields.text are required');
  }

  return { rootPath: resolved.path, format, fields };
}

/**
 * Read every file of the configured format under root, normalize rows to
 * feedback-items, stamp provenance + N1 trust, and warn once per file with
 * any skipped-row count.
 */
async function readAllFeedback(config) {
  const { rootPath, format, fields } = validateConfig(config);

  const files = listFormatFiles(rootPath, format);
  const results = [];

  for (const fileName of files) {
    const filePath = join(rootPath, fileName);
    const { items, skipped } = format === 'csv'
      ? readCsvFile(filePath, fields)
      : readJsonlFile(filePath, fields);

    if (skipped > 0) {
      console.warn(`feedback provider: skipped ${skipped} malformed row(s) in ${fileName}`);
    }

    for (const item of items) {
      const { row, ...rest } = item;
      results.push(stampTrust(
        {
          ...rest,
          provenance: { file: fileName, row },
        },
        TRUST_LEVELS.EXTERNAL_UNAUTHENTICATED,
        `feedback:${fileName}`,
      ));
    }
  }

  return results;
}

/**
 * Search feedback-item text for a substring match (case-insensitive).
 */
async function searchFeedback(config, query) {
  if (!query || typeof query !== 'string') {
    throw new Error('feedback.search: query required (substring)');
  }

  const items = await readAllFeedback(config);
  const needle = query.toLowerCase();
  return items.filter((item) => item.text.toLowerCase().includes(needle));
}

export function create({ env = process.env } = {}) {
  return {
    meta: {
      id: 'feedback',
      displayName: 'Feedback / Customer Input',
      capabilities: ['read', 'search'],
      description: 'Read and search customer feedback exports (JSONL/CSV) from a drop-directory.',
    },

    configSchema: {
      $schema: 'https://json-schema.org/draft/2020-12/schema',
      type: 'object',
      properties: {
        root: {
          type: 'string',
          description: 'Path to the feedback drop-directory (absolute or relative to cwd)',
        },
        format: {
          type: 'string',
          enum: ['jsonl', 'csv'],
          description: 'Format of files to read from the drop-directory',
        },
        fields: {
          type: 'object',
          description: 'Field mapping from source column/key names to feedback-item shape',
          properties: {
            id: { type: 'string', description: 'Source key/column mapped to feedback-item id' },
            text: { type: 'string', description: 'Source key/column mapped to feedback-item text' },
            author: { type: 'string', description: 'Source key/column mapped to feedback-item author' },
            date: { type: 'string', description: 'Source key/column mapped to feedback-item date' },
            source: { type: 'string', description: 'Source key/column mapped to feedback-item source' },
            tags: { type: 'string', description: 'Source key/column mapped to feedback-item tags' },
          },
          required: ['id', 'text'],
        },
      },
      required: ['root', 'format', 'fields'],
    },

    async health(config) {
      const root = config?.root;
      if (!root) {
        return { ok: false, detail: 'config.root not set' };
      }

      const resolved = resolveRoot(root);
      if (!resolved.ok) {
        return { ok: false, detail: resolved.reason };
      }

      try {
        const format = config?.format === 'csv' ? 'csv' : 'jsonl';
        const files = listFormatFiles(resolved.path, format);
        return { ok: true, detail: `drop-directory readable (${files.length} ${format} file(s))` };
      } catch (err) {
        return { ok: false, detail: err.message };
      }
    },

    read: readAllFeedback,
    search: searchFeedback,
  };
}

export default create;
