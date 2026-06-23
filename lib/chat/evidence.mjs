/** Per-turn evidence provenance for chat surfaces. */

export const EVIDENCE_SCHEMA_VERSION = 1;

const REPO_EVIDENCE_TOOLS = new Set(['read', 'grep', 'glob']);
const GLOB_META_RE = /[*?\[\]{}]/;

function freeze(value) {
  if (Array.isArray(value)) value.forEach(freeze);
  else if (value && typeof value === 'object') Object.values(value).forEach(freeze);
  return Object.freeze(value);
}

function concreteTarget(value) {
  if (typeof value !== 'string' || !value.trim() || GLOB_META_RE.test(value)) return null;
  return value;
}

function toolResult(tool = {}) {
  const result = tool.content ?? tool.result;
  return result && typeof result === 'object' ? result : null;
}

function concreteTargets(tool = {}) {
  const result = toolResult(tool);
  const name = String(tool.title || tool.kind || '');
  if (!result) return [];
  if (name === 'read') return [concreteTarget(result.path || tool.input?.path)].filter(Boolean);

  // grep/glob requests describe a search, not a source. Only the concrete files
  // returned by a successful result become evidence records.
  const matches = Array.isArray(result.matches) ? result.matches : [];
  return [...new Set(matches.map((match) => concreteTarget(typeof match === 'string' ? match : match?.file || match?.path)).filter(Boolean))];
}

export function evidenceTarget(tool = {}) {
  return concreteTargets(tool)[0] || null;
}

export function isSuccessfulEvidenceTool(tool = {}) {
  if (!REPO_EVIDENCE_TOOLS.has(String(tool.title || tool.kind || ''))) return false;
  if (tool.status !== 'completed') return false;
  const result = toolResult(tool);
  return Boolean(result && result.ok !== false && result.denied !== true && !result.error && concreteTargets(tool).length);
}

export function evidenceRecords(tools = [], { turnId = null } = {}) {
  const records = [];
  for (const tool of tools) {
    if (!isSuccessfulEvidenceTool(tool)) continue;
    for (const target of concreteTargets(tool)) {
      records.push(freeze({
        schemaVersion: EVIDENCE_SCHEMA_VERSION,
        recordId: `${turnId || 'turn'}:${String(tool.id || '')}:${target}`,
        turnId: turnId ? String(turnId) : null,
        toolId: String(tool.id || ''),
        tool: String(tool.title || tool.kind),
        requestedTarget: String(tool.input?.path || tool.input?.glob || tool.input?.pattern || ''),
        target,
        sourceId: `repo:${target}`,
        completion: 'completed',
        result: 'success',
      }));
    }
  }
  return freeze(records);
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export function citationMatches(text, record) {
  const target = String(record?.target || '');
  const sourceId = String(record?.sourceId || '');
  if (!target) return false;
  const escapedTarget = escapeRegExp(target);
  const targetPattern = new RegExp(`(^|[^A-Za-z0-9_./-])${escapedTarget}(?=$|[^A-Za-z0-9_./-])`);
  const sourcePattern = sourceId
    ? new RegExp(`\\[source:\\s*${escapeRegExp(sourceId)}\\s*\\]`, 'i')
    : null;
  return targetPattern.test(text) || Boolean(sourcePattern?.test(text));
}

function verdict({ status, records = [], citations = [], reasonCodes = [] }) {
  return freeze({
    schemaVersion: EVIDENCE_SCHEMA_VERSION,
    status,
    records: [...records],
    citations: [...new Set(citations)],
    reasonCodes: [...reasonCodes],
  });
}

export function deriveEvidenceVerdict({ id = null, overlay = null, tools = [], assistant = '', evidenceVisible = true, migration = false } = {}) {
  const required = overlay?.assumptionsBlocked || overlay?.externalResearch?.required;
  const migrationCode = migration ? ['legacy_snapshot_without_evidence'] : [];
  if (!required) return verdict({ status: 'not_applicable', reasonCodes: ['evidence_not_required', ...migrationCode] });
  if (!evidenceVisible) return verdict({ status: 'insufficient_evidence', reasonCodes: ['evidence_layer_hidden', ...migrationCode] });

  const records = evidenceRecords(tools, { turnId: id });
  if (!records.length) return verdict({ status: 'insufficient_evidence', records, reasonCodes: ['no_successful_concrete_evidence', ...migrationCode] });
  const text = String(assistant || '');
  const citations = records.filter((record) => citationMatches(text, record)).map((record) => record.target);
  if (!citations.length) return verdict({ status: 'uncited_evidence', records, citations, reasonCodes: ['evidence_not_cited', ...migrationCode] });
  return verdict({
    status: citations.length === records.length ? 'verified' : 'partially_verified',
    records,
    citations,
    reasonCodes: [citations.length === records.length ? 'all_recorded_evidence_cited' : 'some_recorded_evidence_uncited', ...migrationCode],
  });
}

export function migrateEvidenceVerdict(turn = {}) {
  if (turn.evidence?.schemaVersion === EVIDENCE_SCHEMA_VERSION) return turn.evidence;
  if (turn.evidence?.status) {
    const records = (turn.evidence.records || []).map((record, index) => freeze({
      schemaVersion: EVIDENCE_SCHEMA_VERSION,
      recordId: record.recordId || `${turn.id || 'turn'}:${record.toolId || ''}:${record.target || index}`,
      turnId: record.turnId || turn.id || null,
      toolId: record.toolId || '',
      tool: record.tool || 'unknown',
      requestedTarget: record.requestedTarget || record.target || '',
      target: record.target || '',
      sourceId: record.sourceId || `repo:${record.target || ''}`,
      completion: record.completion || 'completed',
      result: record.result || 'success',
    })).filter((record) => record.target);
    return verdict({
      status: turn.evidence.status,
      records,
      citations: turn.evidence.citations || [],
      reasonCodes: [...(turn.evidence.reasonCodes || []), 'legacy_evidence_unversioned'],
    });
  }
  return deriveEvidenceVerdict({ ...turn, migration: true });
}

export function evidenceNotice(verdict) {
  if (!verdict || verdict.status === 'not_applicable' || verdict.status === 'verified') return null;
  if (verdict.reasonCodes?.includes('evidence_layer_hidden')) return 'Evidence tools were hidden for this turn, so no source was verified';
  if (verdict.status === 'uncited_evidence') return 'Evidence was read but the answer does not cite its recorded paths — treat claims as unverified';
  if (verdict.status === 'partially_verified') return 'Only some recorded evidence paths are cited — treat uncited claims as unverified';
  return 'Answer produced without successful recorded repo evidence — treat as unverified';
}
