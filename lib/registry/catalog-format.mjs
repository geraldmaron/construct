/**
 * Shared formatting helpers for registry catalog CLI commands.
 *
 * Keeps list/show error messaging consistent across workspace-preset,
 * worker-profile, and other registry nouns.
 *
 * Worker Profile display contract:
 * - `id` is the CLI selector and list key.
 * - List labels are derived from `id` at render time (see humanizeId).
 * - `displayName` / optional `tagline` hold the perspective tagline for show
 *   surfaces, not the compact list label.
 */

export function recordId(record) {
  return record?.id || record?.name || '';
}

export function humanizeId(id) {
  return String(id || '')
    .split('-')
    .filter(Boolean)
    .map((part) => (part.length <= 2
      ? part.toUpperCase()
      : `${part.charAt(0).toUpperCase()}${part.slice(1)}`))
    .join(' ');
}

export function workerProfileListLabel(record) {
  return humanizeId(recordId(record));
}

export function workerProfileTagline(record) {
  const raw = record?.tagline || record?.displayName || '';
  const normalized = String(raw || '').replace(/\s+/g, ' ').trim();
  if (!normalized) return '';
  const label = workerProfileListLabel(record);
  const id = recordId(record);
  if (normalized.toLowerCase() === label.toLowerCase()) return '';
  if (normalized.toLowerCase() === id.toLowerCase()) return '';
  return normalized;
}

export function formatWorkerProfileListLine(record, { idWidth, labelWidth, taglineMax = 56, showSource = false } = {}) {
  const id = recordId(record);
  const label = workerProfileListLabel(record);
  const tagline = truncate(workerProfileTagline(record), taglineMax);
  const parts = [id.padEnd(idWidth), label.padEnd(labelWidth)];
  if (tagline) parts.push(tagline);
  if (showSource && record.source && record.source !== 'registry') {
    parts.push(`[${record.source}]`);
  }
  return parts.join(' ').trimEnd();
}

export function grepFilter(records, query) {
  if (!query) return records;
  const needle = query.toLowerCase();
  return records.filter((record) => {
    const haystack = [
      recordId(record),
      record.displayName,
      record.name,
      record.description,
      record.tagline,
      record.whenToUse,
      record.when_to_use,
    ]
      .filter(Boolean)
      .join(' ')
      .toLowerCase();
    return haystack.includes(needle);
  });
}

export function suggestIds(query, ids, { limit = 5 } = {}) {
  const known = ids.filter(Boolean);
  if (!query || !known.length) return [];
  const needle = query.toLowerCase();
  const scored = known
    .filter(Boolean)
    .map((id) => {
      const lower = id.toLowerCase();
      if (lower === needle) return { id, score: 0 };
      if (lower.startsWith(needle)) return { id, score: 1 };
      if (lower.includes(needle)) return { id, score: 2 };
      return null;
    })
    .filter(Boolean)
    .sort((a, b) => a.score - b.score || a.id.localeCompare(b.id));
  return scored.slice(0, limit).map((entry) => entry.id);
}

export function formatNotFoundError(label, id, availableIds, { println, errorln } = {}) {
  const suggestions = suggestIds(id, availableIds);
  errorln(`${label} not found: ${id}`);
  if (suggestions.length) {
    errorln(`Did you mean: ${suggestions.join(', ')}?`);
  }
  errorln(`Available: ${availableIds.join(', ')}`);
  errorln(`Run \`construct ${label.toLowerCase().replace(/ /g, '-')} list\` to browse the catalog.`);
}

export function truncate(text, max = 72) {
  const value = String(text || '').replace(/\s+/g, ' ').trim();
  if (value.length <= max) return value;
  return `${value.slice(0, max - 1)}…`;
}

export function listColumnWidth(records, { extra = 0 } = {}) {
  const ids = records.map((record) => recordId(record));
  return Math.max(...ids.map((id) => id.length), 8) + extra;
}
