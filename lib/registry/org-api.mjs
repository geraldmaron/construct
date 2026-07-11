/**
 * lib/registry/org-api.mjs — No-code org authoring API (ADR-0072).
 *
 * A typed CRUD façade over the existing storage and validation layers: no new
 * file format, no new storage location, no new validation engine. Reads wrap
 * lib/registry/assemble.mjs#assembleRegistry (tier merge, builtin -> user ->
 * project). Writes wrap lib/registry/custom-scaffold.mjs's createCustomSpecialist
 * / createCustomTeam for creation, and lib/registry/custom-schema.mjs's
 * string[] validators (adapted to FieldError[] below) for patch validation.
 * Graph-consistency reads wrap lib/registry/validator.mjs#validate. Fence
 * previews wrap lib/roles/fence.mjs#computeEffectiveFence. Route previews wrap
 * lib/specialists/roster.mjs#buildSpecialistCatalog.
 *
 * `kind` is one of 'specialist' | 'team' | 'contract' | 'fence' | 'skill'.
 * `fence` is never a standalone file — every fence lives inside the owning
 * specialist record's `fence` key (ADR-0072 §1) — so fence create/update
 * resolve to a specialist-record patch under the hood, and fence has no
 * remove operation of its own. `skill` is read-only (list/get only); skill
 * *files* are prose content outside this module's write scope.
 *
 * scope: 'builtin' is refused on every write function (createEntity,
 * updateEntity, removeEntity, importOrg) — this is a hard constraint from the
 * ADR's Rejected Alternatives, not a default that can be forced open. Refusal
 * always returns { ok: false, errors: FieldError[] }, never a written file.
 *
 * Known gap (ADR-0072 Consequences): previewRoute wraps
 * lib/specialists/roster.mjs#buildSpecialistCatalog, which reads only the
 * assembled registry, not a draft. Making previewRoute genuinely draft-aware
 * requires extending buildSpecialistCatalog to accept an in-memory override —
 * out of this module's scope per the ADR. previewRoute here scores the
 * existing catalog only; a supplied draftSpecialist is not itself a
 * candidate.
 */

import fs from 'node:fs';
import path from 'node:path';

import { assembleRegistry } from './assemble.mjs';
import { customOrgDir, createCustomSpecialist, createCustomTeam } from './custom-scaffold.mjs';
import { validateCustomSpecialist, validateCustomTeam } from './custom-schema.mjs';
import { validate as validateRegistryGraph } from './validator.mjs';
import { computeEffectiveFence } from '../roles/fence.mjs';
import { buildSpecialistCatalog } from '../specialists/roster.mjs';
import { recruit, parseSignalExpr } from '../orchestration/recruiter.mjs';
import { requestSignals } from '../orchestration/flow-selection.mjs';
import { knownWatchers } from '../orchestration/routing-tables.mjs';
import { loadSignalDimensions } from '../orchestration/signal-dimensions.mjs';

const KNOWN_KINDS = ['specialist', 'team', 'contract', 'fence', 'skill'];
const KNOWN_SCOPES = ['builtin', 'user', 'project'];

const SECTION_BY_KIND = {
  specialist: 'specialists',
  team: 'teams',
  contract: 'contracts',
};

function assertKnownKind(kind) {
  if (!KNOWN_KINDS.includes(kind)) {
    throw new TypeError(`org-api: unknown kind "${kind}" — expected one of ${KNOWN_KINDS.join(', ')}`);
  }
}

function assertKnownScope(scope) {
  if (!KNOWN_SCOPES.includes(scope)) {
    throw new TypeError(`org-api: unknown scope "${scope}" — expected one of ${KNOWN_SCOPES.join(', ')}`);
  }
}

function builtinRefusal(location = '#/scope') {
  return {
    ok: false,
    errors: [{
      id: 'builtin-scope-readonly',
      severity: 'error',
      message: "scope 'builtin' is read-only through this API — write to 'user' or 'project' instead (ADR-0072 Rejected Alternatives)",
      location,
      field: 'scope',
    }],
  };
}

// === Tier directory resolution ===

// Builtin tier root is <rootDir>/specialists/org; user/project tiers are the
// same customOrgDir() custom-scaffold.mjs already writes into.

function tierOrgRoot(scope, rootDir) {
  if (scope === 'builtin') return path.join(rootDir, 'specialists', 'org');
  return customOrgDir(scope, { rootDir });
}

function sectionDirsForKind(scope, rootDir, kind) {
  const root = tierOrgRoot(scope, rootDir);
  if (kind === 'team' && scope === 'builtin') {
    // assembleRegistry() merges groups + teams into one `teams` bucket for the
    // builtin tier only — custom-scaffold.mjs never writes a "groups" file.
    return [path.join(root, 'groups'), path.join(root, 'teams')];
  }
  return [path.join(root, SECTION_BY_KIND[kind])];
}

function readJsonSafe(filePath) {
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch {
    return null;
  }
}

// Mirrors lib/registry/org-io.mjs#findOrgEntityFile's match rule (direct
// "<id>.json" then a scan for an embedded id field) but scoped to an
// arbitrary section directory rather than the builtin <root>/specialists/org
// nesting org-io.mjs assumes — the user/project tiers do not share that
// nesting (they live at .construct/org/** and ~/.construct/org/**).

function findEntityFileIn(sectionDir, id) {
  if (!fs.existsSync(sectionDir)) return null;
  const direct = path.join(sectionDir, `${id}.json`);
  if (fs.existsSync(direct)) return direct;
  for (const name of fs.readdirSync(sectionDir)) {
    if (!name.endsWith('.json')) continue;
    const filePath = path.join(sectionDir, name);
    const raw = readJsonSafe(filePath);
    if (raw && (raw.id === id || raw.name === id || name.replace(/\.json$/, '') === id)) return filePath;
  }
  return null;
}

function listEntityFiles(sectionDir) {
  if (!fs.existsSync(sectionDir)) return [];
  return fs.readdirSync(sectionDir)
    .filter((n) => n.endsWith('.json'))
    .map((n) => path.join(sectionDir, n));
}

function entityIdFromFile(filePath, raw) {
  return raw.id || path.basename(filePath, '.json');
}

function listEntitiesForScope(kind, scope, rootDir) {
  const rows = [];
  for (const sectionDir of sectionDirsForKind(scope, rootDir, kind)) {
    for (const filePath of listEntityFiles(sectionDir)) {
      const raw = readJsonSafe(filePath);
      if (!raw) continue;
      const id = entityIdFromFile(filePath, raw);
      rows.push({ id, scope, path: filePath, ...raw });
    }
  }
  return rows;
}

/**
 * List entities of one kind, merged across builtin/user/project tiers, each
 * row tagged with its source tier and file path (assembleRegistry() does not
 * carry this metadata, so this walks the same three tiers independently).
 */
export function listEntities(kind, { rootDir = process.cwd() } = {}) {
  assertKnownKind(kind);

  if (kind === 'skill') {
    const items = listSkillEntities(rootDir);
    return { items, count: items.length };
  }

  if (kind === 'fence') {
    const items = listEntitiesForScope('specialist', 'project', rootDir)
      .concat(listEntitiesForScope('specialist', 'user', rootDir))
      .concat(listEntitiesForScope('specialist', 'builtin', rootDir))
      .map((row) => ({ id: row.id, scope: row.scope, path: row.path, fence: row.fence || {} }));
    // Later tiers (project) win on id collision, matching assembleRegistry's precedence.
    const byId = new Map();
    for (const row of items.slice().reverse()) if (!byId.has(row.id)) byId.set(row.id, row);
    const merged = [...byId.values()];
    return { items: merged, count: merged.length };
  }

  const byId = new Map();
  for (const scope of ['builtin', 'user', 'project']) {
    for (const row of listEntitiesForScope(kind, scope, rootDir)) {
      byId.set(row.id, row);
    }
  }
  const items = [...byId.values()];
  return { items, count: items.length };
}

/** Read one entity by id, resolved through the same tier precedence as assembleRegistry(). */
export function getEntity(kind, id, { rootDir = process.cwd() } = {}) {
  assertKnownKind(kind);

  if (kind === 'skill') {
    return listSkillEntities(rootDir).find((row) => row.id === id) || null;
  }

  if (kind === 'fence') {
    const spec = getEntity('specialist', id, { rootDir });
    if (!spec) return null;
    return { id: spec.id, scope: spec.scope, path: spec.path, record: spec.record.fence || {} };
  }

  let winner = null;
  for (const scope of ['builtin', 'user', 'project']) {
    for (const sectionDir of sectionDirsForKind(scope, rootDir, kind)) {
      const filePath = findEntityFileIn(sectionDir, id);
      if (!filePath) continue;
      const raw = readJsonSafe(filePath);
      if (!raw) continue;
      winner = { id, scope, path: filePath, record: raw };
    }
  }
  return winner;
}

function listSkillEntities(rootDir) {
  const skillsDir = path.join(rootDir, 'skills');
  const results = [];
  const walk = (dir, prefix = '') => {
    if (!fs.existsSync(dir)) return;
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (entry.name.startsWith('.')) continue;
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(full, prefix ? `${prefix}/${entry.name}` : entry.name);
      } else if (entry.name.endsWith('.md') && entry.name !== 'routing.md') {
        const id = prefix ? `${prefix}/${entry.name.replace(/\.md$/, '')}` : entry.name.replace(/\.md$/, '');
        results.push({ id, path: full });
      }
    }
  };
  walk(skillsDir);
  return results;
}

// === FieldError adapter: custom-schema.mjs string[] -> FieldError[] ===

// Mechanical, one-time bridging layer (ADR-0072 §4) — not a rewrite of
// custom-schema.mjs's actual rules. Every message it produces is either
// "<id>: "<field>" ..." (the common case) or one of two irregular shapes
// (an indexed array item, or a field name stated as a bare word right
// before a quoted value); this covers all thirteen message templates in
// lib/registry/custom-schema.mjs as of this writing.

function toKebab(field) {
  return field
    .replace(/\[\d+\]/g, '')
    .replace(/\./g, '-')
    .replace(/([a-z0-9])([A-Z])/g, '$1-$2')
    .toLowerCase();
}

function extractFieldFromMessage(message) {
  const quotedFirst = message.match(/^"([a-zA-Z0-9_.]+)"/);
  if (quotedFirst) return quotedFirst[1];

  const arrayIndexed = message.match(/^([a-zA-Z0-9_]+)\[(\d+)\]/);
  if (arrayIndexed) return `${arrayIndexed[1]}[${arrayIndexed[2]}]`;

  const wordBeforeQuote = message.match(/^([a-zA-Z0-9_]+)\s+"/);
  if (wordBeforeQuote) return wordBeforeQuote[1];

  const inKeyword = message.match(/\bin (claudeTools)\b/);
  if (inKeyword) return inKeyword[1];

  return null;
}

/**
 * Convert one lib/registry/custom-schema.mjs error string into a FieldError
 * (ADR-0072 §4). `kind` and `entityId` are supplied by the caller (the
 * validator functions don't return a stable per-record id we can rely on).
 */
function customSchemaStringToFieldError(kind, entityId, message) {
  const colonIdx = message.indexOf(': ');
  const body = colonIdx === -1 ? message : message.slice(colonIdx + 2);
  const field = extractFieldFromMessage(body);
  const leaf = field ? field.replace(/\[\d+\]/, '').split('.').pop() : undefined;
  const section = SECTION_BY_KIND[kind];
  const pointerField = field ? field.replace(/\./g, '/').replace(/\[(\d+)\]/, '/$1') : null;
  const location = pointerField ? `#/${section}/${entityId}/${pointerField}` : `#/${section}/${entityId}`;
  return {
    id: field ? `custom-${kind}-${toKebab(field)}` : `custom-${kind}-invalid-record`,
    severity: 'error',
    message,
    location,
    ...(leaf ? { field: leaf } : {}),
  };
}

function customSchemaErrorsToFieldErrors(kind, entityId, messages) {
  return messages.map((m) => customSchemaStringToFieldError(kind, entityId, m));
}

// === Graph-consistency adapter: validator.mjs -> FieldError[] scoped to one entity ===

function addFieldToValidatorError(err) {
  const parts = err.location.split('/').filter(Boolean);
  const field = parts.length > 2 ? parts[parts.length - 1] : undefined;
  return { ...err, ...(field ? { field } : {}) };
}

/**
 * Merge a draft record into the assembled registry at rootDir and run
 * lib/registry/validator.mjs's 13-invariant graph check, filtered to errors
 * whose location falls under the entity's own JSON pointer — the
 * graph-inconsistency half of validateDraft (ADR-0072 §4).
 */
function graphCheckForDraft(kind, id, draftRecord, rootDir) {
  const registry = assembleRegistry(rootDir);
  const section = SECTION_BY_KIND[kind];
  const merged = {
    ...registry,
    [section]: { ...registry[section], [id]: { ...(registry[section][id] || {}), ...draftRecord, id } },
  };
  const result = validateRegistryGraph(merged);
  const prefix = `#/${section}/${id}`;
  const relevant = (e) => e.location === prefix || e.location.startsWith(`${prefix}/`);
  return {
    errors: result.errors.filter(relevant).map(addFieldToValidatorError),
    warnings: result.warnings.filter(relevant).map(addFieldToValidatorError),
  };
}

// === Contract shape checks (mirrors lib/contracts/validate.mjs's per-record
// rules; validateContractsFile itself always reads the global loadRegistry()
// with no rootDir override, so it cannot be scoped to an arbitrary rootDir —
// see the file header note and the final report for this gap) ===

function contractShapeErrors(id, draftRecord, rootDir) {
  const registry = assembleRegistry(rootDir);
  const specialistIds = new Set(Object.keys(registry.specialists));
  const validParties = new Set(['user', 'construct', '*', ...specialistIds]);
  const errors = [];
  const push = (field, message) => errors.push({
    id: `custom-contract-${toKebab(field)}`,
    severity: 'error',
    message,
    location: `#/contracts/${id}/${field}`,
    field,
  });

  if (!draftRecord.id || !/^[a-z0-9][a-z0-9-]*$/.test(draftRecord.id)) {
    push('id', `contract id must be kebab-case, got ${JSON.stringify(draftRecord.id)}`);
  }
  if (!draftRecord.producer) push('producer', 'contract is missing producer');
  else if (!validParties.has(draftRecord.producer)) push('producer', `producer '${draftRecord.producer}' is not a known specialist or well-known party`);
  if (!draftRecord.consumer) push('consumer', 'contract is missing consumer');
  else if (!validParties.has(draftRecord.consumer)) push('consumer', `consumer '${draftRecord.consumer}' is not a known specialist or well-known party`);
  if (!draftRecord.input) push('input', 'contract is missing input');

  const schemaRef = draftRecord.output?.schema;
  if (schemaRef && !fs.existsSync(path.join(rootDir, schemaRef))) {
    push('output.schema', `output.schema '${schemaRef}' does not exist on disk`);
  }

  return errors;
}

/**
 * Run the full validation suite against a draft entity merged into the
 * current registry, without writing (ADR-0072 §3/§4). Unions the
 * single-record shape check (custom-schema.mjs for specialist/team, a
 * mirrored shape check for contract) with the whole-graph consistency check
 * (validator.mjs), so one call surfaces both kinds of error together.
 */
export function validateDraft(kind, draftRecord = {}, { rootDir = process.cwd() } = {}) {
  assertKnownKind(kind);

  if (kind === 'skill') {
    return { ok: true, errors: [], warnings: [] };
  }

  if (kind === 'fence') {
    const specialistId = draftRecord.specialistId || draftRecord.id;
    const existing = specialistId ? getEntity('specialist', specialistId, { rootDir }) : null;
    const baseSpecialist = existing ? existing.record : { name: specialistId, fence: {} };
    const merged = { ...baseSpecialist, fence: { ...(baseSpecialist.fence || {}), ...(draftRecord.fence || draftRecord) } };
    const inner = validateDraft('specialist', merged, { rootDir });
    const isFenceField = (e) => (e.field || '').toLowerCase().includes('allowed') || (e.field || '').toLowerCase().includes('fence') || e.location.includes('/fence');
    return {
      ok: inner.errors.every((e) => !isFenceField(e)),
      errors: inner.errors.filter(isFenceField),
      warnings: inner.warnings.filter(isFenceField),
    };
  }

  const id = kind === 'specialist'
    ? (draftRecord.name && `cx-${draftRecord.name.replace(/^cx-/, '')}`) || draftRecord.id
    : draftRecord.id || draftRecord.name;

  let shapeErrors = [];
  if (kind === 'specialist') {
    const messages = validateCustomSpecialist(draftRecord, { rootDir, checkPromptFileExists: false });
    shapeErrors = customSchemaErrorsToFieldErrors('specialist', id || '(unnamed)', messages);
  } else if (kind === 'team') {
    const messages = validateCustomTeam(draftRecord);
    shapeErrors = customSchemaErrorsToFieldErrors('team', id || '(unnamed)', messages);
  } else if (kind === 'contract') {
    shapeErrors = contractShapeErrors(id || '(unnamed)', draftRecord, rootDir);
  }

  const graph = id ? graphCheckForDraft(kind, id, draftRecord, rootDir) : { errors: [], warnings: [] };

  const errors = [...shapeErrors, ...graph.errors];
  return { ok: errors.length === 0, errors, warnings: graph.warnings };
}

// === Write path: create ===

/**
 * Create an entity in the given tier. Validates before writing; throws only
 * on caller error (unrecognized kind, unrecognized scope string) — never on
 * validation failure, which returns a result object so a UI can render it
 * inline. scope: 'builtin' is a recognized value that is always refused.
 */
export function createEntity(kind, record = {}, { rootDir = process.cwd(), scope = 'project', force = false } = {}) {
  assertKnownKind(kind);
  assertKnownScope(scope);
  if (scope === 'builtin') return builtinRefusal();

  if (kind === 'skill') {
    return { ok: false, errors: [{ id: 'skill-read-only', severity: 'error', message: 'skill entities are read-only through this API — reference an existing skill bundle instead', location: '#/skill', field: 'kind' }] };
  }

  if (kind === 'fence') {
    const specialistId = record.specialistId || record.id;
    if (!specialistId) {
      return { ok: false, errors: [{ id: 'fence-missing-specialist-id', severity: 'error', message: 'fence create requires specialistId — a fence is always a sub-object of a specialist record', location: '#/fence/specialistId', field: 'specialistId' }] };
    }
    return updateEntity('specialist', specialistId, { fence: record.fence || record }, { rootDir, scope });
  }

  if (kind === 'contract') {
    const validation = validateDraft('contract', record, { rootDir });
    if (!validation.ok) return { ok: false, errors: validation.errors };
    const orgDir = customOrgDir(scope, { rootDir });
    const contractsDir = path.join(orgDir, 'contracts');
    const filePath = path.join(contractsDir, `${record.id}.json`);
    if (fs.existsSync(filePath) && !force) {
      return { ok: false, errors: [{ id: 'contract-already-exists', severity: 'error', message: `${filePath} already exists — pass force to overwrite`, location: `#/contracts/${record.id}`, field: 'id' }] };
    }
    fs.mkdirSync(contractsDir, { recursive: true });
    fs.writeFileSync(filePath, JSON.stringify(record, null, 2) + '\n');
    return { ok: true, path: filePath, record };
  }

  try {
    if (kind === 'specialist') {
      const shortId = (record.id || record.name || '').replace(/^cx-/, '');
      const result = createCustomSpecialist({ ...record, id: shortId, rootDir, scope, force });
      return { ok: true, path: result.path, record: result.record };
    }
    // kind === 'team'
    const result = createCustomTeam({ ...record, rootDir, scope, force });
    return { ok: true, path: result.path, record: result.record };
  } catch (err) {
    return { ok: false, errors: thrownErrorToFieldErrors(kind, record, err) };
  }
}

// createCustomSpecialist/createCustomTeam throw a single Error whose message
// is either "<id> failed validation:\n  <line>\n  <line>..." (the exact
// custom-schema.mjs string[] output, joined) or a single-line caller-input
// error (bad id shape, file exists, unknown team). Both are converted to
// FieldError[] here rather than duplicating the record-construction logic
// that produces the validated shape.

function thrownErrorToFieldErrors(kind, record, err) {
  const message = err.message || String(err);
  const marker = 'failed validation:\n  ';
  const idx = message.indexOf(marker);
  const entityId = (record.name || record.id || '(unnamed)').replace(/^cx-/, kind === 'specialist' ? '' : '');
  if (idx !== -1) {
    const lines = message.slice(idx + marker.length).split('\n  ').filter(Boolean);
    return customSchemaErrorsToFieldErrors(kind, kind === 'specialist' ? `cx-${entityId}` : entityId, lines);
  }
  return [{
    id: `${kind}-create-failed`,
    severity: 'error',
    message,
    location: `#/${SECTION_BY_KIND[kind]}/${entityId}`,
  }];
}

// === Write path: update ===

/**
 * Patch-update an entity's fields in place (only 'user' or 'project' tier —
 * builtin entities are read-only through this API). Operates on the file
 * already materialized in the target tier; an entity only present in a lower
 * tier (builtin/user) must be created in the target tier first via
 * createEntity before it can be patched here — no partial-override file is
 * synthesized on first update.
 */
export function updateEntity(kind, id, patch = {}, { rootDir = process.cwd(), scope = 'project' } = {}) {
  assertKnownKind(kind);
  assertKnownScope(scope);
  if (scope === 'builtin') return builtinRefusal();

  if (kind === 'skill') {
    return { ok: false, errors: [{ id: 'skill-read-only', severity: 'error', message: 'skill entities are read-only through this API', location: '#/skill', field: 'kind' }] };
  }

  if (kind === 'fence') {
    return updateEntity('specialist', id, { fence: { ...(getEntity('specialist', id, { rootDir })?.record?.fence || {}), ...(patch.fence || patch) } }, { rootDir, scope });
  }

  const orgDir = customOrgDir(scope, { rootDir });
  const sectionDir = path.join(orgDir, SECTION_BY_KIND[kind]);
  const filePath = findEntityFileIn(sectionDir, id);
  if (!filePath) {
    return { ok: false, errors: [{ id: `${kind}-not-found-in-tier`, severity: 'error', message: `no ${kind} "${id}" found in ${scope} tier at ${sectionDir} — create it first with createEntity`, location: `#/${SECTION_BY_KIND[kind]}/${id}` }] };
  }
  const existing = readJsonSafe(filePath) || {};
  const merged = { ...existing, ...patch, id: existing.id || id };
  if (patch.fence && existing.fence) merged.fence = { ...existing.fence, ...patch.fence };

  const validation = validateDraft(kind, kind === 'specialist' ? { ...merged, name: existing.name || merged.name } : merged, { rootDir });
  if (!validation.ok) return { ok: false, errors: validation.errors };

  fs.writeFileSync(filePath, JSON.stringify(merged, null, 2) + '\n');
  return { ok: true, path: filePath, record: merged };
}

// === Write path: remove ===

function findReferencesToSpecialist(registry, id) {
  const refs = [];
  for (const [specId, spec] of Object.entries(registry.specialists)) {
    if (specId !== id && Array.isArray(spec.handoffCandidates) && spec.handoffCandidates.includes(id)) {
      refs.push(`specialist ${specId} lists it in handoffCandidates`);
    }
  }
  for (const [contractId, contract] of Object.entries(registry.contracts)) {
    if (contract.producer === id || contract.consumer === id) {
      refs.push(`contract ${contractId} references it as ${contract.producer === id ? 'producer' : 'consumer'}`);
    }
  }
  const target = registry.specialists[id];
  if (target) {
    for (const [teamId, team] of Object.entries(registry.teams)) {
      if (team.owner === target.role) {
        const otherOwners = Object.values(registry.specialists).some((s) => s.team === teamId && s.role === team.owner && s !== target);
        if (!otherOwners) refs.push(`team ${teamId} has no other specialist holding its owner role`);
      }
    }
  }
  return refs;
}

function findReferencesToTeam(registry, id) {
  const refs = [];
  for (const [specId, spec] of Object.entries(registry.specialists)) {
    if (spec.team === id || spec.teamId === id) refs.push(`specialist ${specId} is assigned to it`);
  }
  for (const [contractId, contract] of Object.entries(registry.contracts)) {
    const boundary = contract.teamBoundary || {};
    if (boundary.producerTeam === id || boundary.consumerTeam === id) refs.push(`contract ${contractId} teamBoundary references it`);
  }
  return refs;
}

/**
 * Remove an entity from a writable tier. Refuses if other entities still
 * reference it (e.g. a team with specialists still assigned) unless force.
 */
export function removeEntity(kind, id, { rootDir = process.cwd(), scope = 'project', force = false } = {}) {
  assertKnownKind(kind);
  assertKnownScope(scope);
  if (scope === 'builtin') return builtinRefusal();

  if (kind === 'skill') {
    return { ok: false, errors: [{ id: 'skill-read-only', severity: 'error', message: 'skill entities are read-only through this API', location: '#/skill', field: 'kind' }] };
  }
  if (kind === 'fence') {
    return { ok: false, errors: [{ id: 'fence-not-removable', severity: 'error', message: 'fence is not a standalone file — patch it to an empty allowedPaths via updateEntity instead', location: `#/specialists/${id}/fence`, field: 'fence' }] };
  }

  if (!force) {
    const registry = assembleRegistry(rootDir);
    const refs = kind === 'specialist' ? findReferencesToSpecialist(registry, id)
      : kind === 'team' ? findReferencesToTeam(registry, id)
      : [];
    if (refs.length > 0) {
      return {
        ok: false,
        errors: refs.map((message) => ({
          id: `${kind}-still-referenced`,
          severity: 'error',
          message: `cannot remove ${kind} "${id}": ${message} — pass force to remove anyway`,
          location: `#/${SECTION_BY_KIND[kind]}/${id}`,
        })),
      };
    }
  }

  const orgDir = customOrgDir(scope, { rootDir });
  const sectionDir = path.join(orgDir, SECTION_BY_KIND[kind]);
  const filePath = findEntityFileIn(sectionDir, id);
  if (!filePath) {
    return { ok: false, errors: [{ id: `${kind}-not-found-in-tier`, severity: 'error', message: `no ${kind} "${id}" found in ${scope} tier at ${sectionDir}`, location: `#/${SECTION_BY_KIND[kind]}/${id}` }] };
  }
  fs.unlinkSync(filePath);
  return { ok: true };
}

// === Import / export ===

function readSection(sectionDir) {
  const out = {};
  for (const filePath of listEntityFiles(sectionDir)) {
    const raw = readJsonSafe(filePath);
    if (!raw) continue;
    const id = entityIdFromFile(filePath, raw);
    out[id] = { id, ...raw };
  }
  return out;
}

/** Export one tier's org state as a single JSON payload — the read side of a round-trip. */
export function exportOrg({ rootDir = process.cwd(), scope = 'project' } = {}) {
  assertKnownScope(scope);
  const orgDir = tierOrgRoot(scope, rootDir);
  const teams = scope === 'builtin'
    ? { ...readSection(path.join(orgDir, 'groups')), ...readSection(path.join(orgDir, 'teams')) }
    : readSection(path.join(orgDir, 'teams'));
  return {
    scope,
    exportedAt: new Date().toISOString(),
    teams,
    specialists: readSection(path.join(orgDir, 'specialists')),
    contracts: readSection(path.join(orgDir, 'contracts')),
    policies: readSection(path.join(orgDir, 'policies')),
  };
}

function validateExportedEntity(kind, id, record, rootDir) {
  if (kind === 'specialist') {
    return customSchemaErrorsToFieldErrors('specialist', id, validateCustomSpecialist(record, { rootDir, checkPromptFileExists: false }));
  }
  if (kind === 'team') {
    return customSchemaErrorsToFieldErrors('team', id, validateCustomTeam(record));
  }
  if (kind === 'contract') {
    return contractShapeErrors(id, record, rootDir);
  }
  return [];
}

/**
 * Validate and write a full org payload back to one tier, atomically per
 * entity (each entity file is validated before any file is written; on any
 * failure, nothing is written — no partial import).
 */
export function importOrg(payload = {}, { rootDir = process.cwd(), scope = 'project', dryRun = false } = {}) {
  assertKnownScope(scope);
  if (scope === 'builtin') return builtinRefusal();

  const plan = [];
  const errors = [];

  for (const [kind, sectionKey] of [['specialist', 'specialists'], ['team', 'teams'], ['contract', 'contracts']]) {
    const section = payload[sectionKey] || {};
    for (const [id, record] of Object.entries(section)) {
      const recordErrors = validateExportedEntity(kind, id, record, rootDir);
      if (recordErrors.length > 0) {
        errors.push(...recordErrors);
        continue;
      }
      plan.push({ kind, id, record });
    }
  }

  for (const [id, record] of Object.entries(payload.policies || {})) {
    if (!record || typeof record !== 'object') {
      errors.push({ id: 'custom-policy-invalid-record', severity: 'error', message: `policy "${id}" must be an object`, location: `#/policies/${id}` });
      continue;
    }
    plan.push({ kind: 'policy', id, record });
  }

  if (errors.length > 0) return { ok: false, errors };
  if (dryRun) return { ok: true, written: [] };

  const orgDir = customOrgDir(scope, { rootDir });
  const written = [];
  for (const { kind, id, record } of plan) {
    const sectionDir = path.join(orgDir, kind === 'policy' ? 'policies' : SECTION_BY_KIND[kind]);
    fs.mkdirSync(sectionDir, { recursive: true });
    const filePath = path.join(sectionDir, `${id}.json`);
    fs.writeFileSync(filePath, JSON.stringify(record, null, 2) + '\n');
    written.push(filePath);
  }
  return { ok: true, written };
}

// === Read-only previews ===

function tokenize(text) {
  return String(text || '').toLowerCase().match(/[a-z0-9]+/g) || [];
}

/**
 * Preview which specialist(s) orchestration_policy would route a given
 * description/skill-set to. Wraps buildSpecialistCatalog(), which reads only
 * existing (already-written) specialists — see this file's header for the
 * draft-awareness gap this leaves.
 */
export function previewRoute({ rootDir = process.cwd(), draftSpecialist = null, description = '' } = {}) {
  const catalog = buildSpecialistCatalog({ rootDir });
  const wantTokens = new Set([
    ...tokenize(description),
    ...tokenize(draftSpecialist?.description),
    ...(draftSpecialist?.skills || []).flatMap((s) => tokenize(s)),
  ]);
  const candidates = catalog
    .map((entry) => {
      const entryTokens = new Set(tokenize(entry.whenToUse));
      const overlap = [...wantTokens].filter((t) => entryTokens.has(t));
      return { id: entry.id, whenToUse: entry.whenToUse, overlap };
    })
    .filter((c) => c.overlap.length > 0)
    .sort((a, b) => b.overlap.length - a.overlap.length)
    .map((c) => ({ id: c.id, whenToUse: c.whenToUse, matchReason: `keyword overlap: ${c.overlap.join(', ')}` }));

  return { candidates };
}

/**
 * Preview the effective fence for a specialist given its own fence and its
 * team's forbiddenDecisions, without writing anything. Wraps
 * lib/roles/fence.mjs#computeEffectiveFence against a draft (possibly
 * unsaved) specialist + team pair, via a synthetic persona id spliced into a
 * cloned registry so the team lookup inside computeEffectiveFence resolves
 * without requiring the draft to already be on disk.
 */
export function previewEffectiveFence({ rootDir = process.cwd(), draftSpecialist = {}, teamId } = {}) {
  const registry = assembleRegistry(rootDir);
  const team = registry.teams[teamId];
  if (!team) {
    return { allowedPaths: [], allowedCommands: [], allowedBdLabels: [], approvalRequired: [], deniedActions: [] };
  }
  const syntheticId = '__org-api-preview__';
  const syntheticRegistry = {
    ...registry,
    teams: { ...registry.teams, [teamId]: { ...team, roles: [...(team.roles || []), syntheticId] } },
  };
  return computeEffectiveFence(syntheticId, draftSpecialist.fence || {}, syntheticRegistry);
}

// === Participation rules (ADR-0070, construct-pteo2.15) ===

// participationRules are not standalone files — each array lives on the owning
// specialist/team registry entry (schemas/participation-rules.schema.json), so
// participation CRUD is a targeted patch of the owning entry. assembleRegistry's
// overlay merge is per-field shallow, which cuts both ways: a project drop-in
// { id, participationRules } attaches rules to a builtin entry without copying
// it, but any tier write REPLACES the whole participationRules key — so every
// write below starts from the assembled (effective) rules, never from the tier
// file's own subset, or an upsert would silently drop inherited rules.

const PARTICIPATION_ROLES = ['author', 'reviewer', 'advisor'];
const PARTICIPATION_GATES = ['advisory', 'enforced'];
const PARTICIPATION_DIMENSIONS = ['legal-compliance', 'security', 'quality', 'product', 'operations', 'architecture'];
const RULE_ID_PATTERN = /^[a-z][a-z0-9-]{1,60}$/;
const CORE_BOOLEAN_SIGNALS = ['hasSuccessMetric', 'hasNamedConstraints', 'authOrPayments', 'visualDeliverable'];

function normalizeParticipationRules(declared) {
  if (Array.isArray(declared)) return declared;
  if (declared && Array.isArray(declared.rules)) return declared.rules;
  return [];
}

function participationOwner(registry, ownerId) {
  if (registry.specialists[ownerId]) return { ownerKind: 'specialist', entry: registry.specialists[ownerId] };
  if (registry.teams[ownerId]) return { ownerKind: 'team', entry: registry.teams[ownerId] };
  return null;
}

// The tier whose file actually declares the effective participationRules value
// (later tiers win, mirroring assembleRegistry's precedence) — list rows carry
// the source tier so a UI can show where the rule came from.

function participationSourceFor(ownerId, ownerKind, rootDir) {
  let winner = null;
  for (const scope of ['builtin', 'user', 'project']) {
    for (const sectionDir of sectionDirsForKind(scope, rootDir, ownerKind)) {
      const filePath = findEntityFileIn(sectionDir, ownerId);
      if (!filePath) continue;
      const raw = readJsonSafe(filePath);
      if (raw && raw.participationRules !== undefined) winner = { scope, path: filePath };
    }
  }
  return winner;
}

/** List every declared participation rule across all tiers, flattened with owner metadata. */
export function listParticipationRules({ rootDir = process.cwd() } = {}) {
  const registry = assembleRegistry(rootDir);
  const items = [];
  for (const [ownerKind, section] of [['specialist', 'specialists'], ['team', 'teams']]) {
    for (const [ownerId, entry] of Object.entries(registry[section] || {})) {
      const rules = normalizeParticipationRules(entry.participationRules);
      if (!rules.length) continue;
      const source = participationSourceFor(ownerId, ownerKind, rootDir);
      for (const rule of rules) {
        items.push({ owner: ownerId, ownerKind, scope: source?.scope ?? 'builtin', path: source?.path ?? null, rule });
      }
    }
  }
  return { items, count: items.length };
}

/**
 * Validate one participation rule draft against the same structural contract
 * the registry-wide audit gate enforces (tests/participation-coverage.test.mjs,
 * schemas/participation-rules.schema.json): id shape, registry-wide id
 * uniqueness, evaluable `when` (declared watcher or closed-grammar signalExpr),
 * known recruit targets, role/gate/dimension enums, enforced-needs-scope, and
 * the legal-compliance -> cx-security binding (ADR-0070's no-13th-role rule).
 * Unknown signal keys and a not-yet-opted-in enforcement team are warnings:
 * both are schema-valid rules that simply cannot fire/block until the
 * referenced data exists.
 */
export function validateParticipationRule(ownerId, rule = {}, { rootDir = process.cwd() } = {}) {
  const registry = assembleRegistry(rootDir);
  const errors = [];
  const warnings = [];
  const ruleId = typeof rule?.id === 'string' ? rule.id : '(unnamed)';
  const loc = (suffix = '') => `#/participation/${ownerId}/${ruleId}${suffix}`;
  const err = (id, field, message, severity = 'error') =>
    (severity === 'error' ? errors : warnings).push({ id, severity, message, location: loc(field ? `/${field}` : ''), ...(field ? { field } : {}) });

  const owner = participationOwner(registry, ownerId);
  if (!owner) err('participation-owner-unknown', 'owner', `"${ownerId}" is not a known specialist or team — a participation rule attaches to an existing registry entry`);

  if (!rule || typeof rule !== 'object' || Array.isArray(rule)) {
    errors.push({ id: 'participation-rule-invalid', severity: 'error', message: 'rule must be an object', location: loc() });
    return { ok: false, errors, warnings };
  }

  if (!RULE_ID_PATTERN.test(rule.id || '')) {
    err('participation-rule-id-shape', 'id', `rule id must match ${RULE_ID_PATTERN} , got ${JSON.stringify(rule.id)}`);
  } else {
    for (const existing of listParticipationRules({ rootDir }).items) {
      if (existing.rule?.id === rule.id && existing.owner !== ownerId) {
        err('participation-rule-id-duplicate', 'id', `rule id "${rule.id}" is already declared on ${existing.ownerKind} "${existing.owner}" — rule ids are unique registry-wide`);
      }
    }
  }

  const when = rule.when;
  if (!when || typeof when !== 'object' || (!when.watchCondition && !when.signalExpr)) {
    err('participation-when-missing', 'when', 'rule needs an evaluable when: a watchCondition naming a declared watcher, or a signalExpr');
  } else {
    if (when.watchCondition !== undefined && !knownWatchers().includes(when.watchCondition)) {
      err('participation-watcher-unknown', 'when', `watchCondition "${when.watchCondition}" is not a declared watcher (specialists/org/watchers.json) — declared: ${knownWatchers().join(', ')}`);
    }
    if (when.signalExpr !== undefined) {
      const terms = parseSignalExpr(when.signalExpr);
      if (!terms) {
        err('participation-signal-expr-grammar', 'when', `signalExpr "${when.signalExpr}" is outside the closed grammar (bare key, !key, && conjunction) and would fail closed`);
      } else {
        const known = new Set([...loadSignalDimensions().map((d) => d.key), ...CORE_BOOLEAN_SIGNALS]);
        for (const { key } of terms) {
          if (!known.has(key)) err('participation-signal-key-unknown', 'when', `signalExpr references "${key}", which no declared signal dimension or core boolean signal produces — the rule will never fire until that signal exists`, 'warning');
        }
      }
    }
  }

  const recruitSpecialists = rule.recruit?.specialists ?? [];
  const recruitTeams = rule.recruit?.teams ?? [];
  if (recruitSpecialists.length + recruitTeams.length === 0) {
    err('participation-recruit-empty', 'recruit', 'rule must recruit at least one specialist or team');
  }
  for (const target of recruitSpecialists) {
    if (!registry.specialists[target]) err('participation-recruit-specialist-unknown', 'recruit', `recruit target "${target}" is not a known specialist — the roster is fixed (ADR-0070)`);
  }
  for (const target of recruitTeams) {
    if (!registry.teams[target]) err('participation-recruit-team-unknown', 'recruit', `recruit target "${target}" is not a known team`);
  }

  if (!PARTICIPATION_ROLES.includes(rule.role)) {
    err('participation-role-enum', 'role', `role must be one of ${PARTICIPATION_ROLES.join(', ')}, got ${JSON.stringify(rule.role)}`);
  }
  if (!PARTICIPATION_GATES.includes(rule.gate)) {
    err('participation-gate-enum', 'gate', `gate must be one of ${PARTICIPATION_GATES.join(', ')}, got ${JSON.stringify(rule.gate)}`);
  }
  if (rule.gate === 'enforced') {
    const scope = rule.enforcementScope;
    if (!scope?.team || !scope?.decisionRight) {
      err('participation-enforcement-scope-missing', 'enforcementScope', 'gate "enforced" requires enforcementScope naming a team and decisionRight (ADR-0070 opt-in-per-team)');
    } else {
      const team = registry.teams[scope.team];
      if (!team) {
        err('participation-enforcement-team-unknown', 'enforcementScope', `enforcementScope.team "${scope.team}" is not a known team`);
      } else if ((team.forbiddenDecisions || []).includes(scope.decisionRight)) {
        err('participation-enforcement-forbidden', 'enforcementScope', `team "${scope.team}" forbids decision "${scope.decisionRight}" (forbiddenDecisions) — it can never block on it`);
      } else if (!(team.decisionRights || []).includes(scope.decisionRight)) {
        err('participation-enforcement-not-opted-in', 'enforcementScope', `team "${scope.team}" does not list "${scope.decisionRight}" in its decisionRights — the rule stays advisory-in-effect until the team opts in`, 'warning');
      }
    }
  }

  if (rule.dimension !== undefined && !PARTICIPATION_DIMENSIONS.includes(rule.dimension)) {
    err('participation-dimension-enum', 'dimension', `dimension must be one of ${PARTICIPATION_DIMENSIONS.join(', ')}, got ${JSON.stringify(rule.dimension)}`);
  }
  if (rule.dimension === 'legal-compliance' && !recruitSpecialists.includes('cx-security')) {
    err('participation-legal-compliance-binding', 'recruit', 'a legal-compliance rule must recruit cx-security — the dimension binds to the existing role, never a 13th (ADR-0070)');
  }
  if (rule.reason !== undefined && (typeof rule.reason !== 'string' || rule.reason.length > 200)) {
    err('participation-reason-too-long', 'reason', 'reason must be a string of at most 200 characters');
  }

  return { ok: errors.length === 0, errors, warnings };
}

function participationTierWrite(ownerId, ownerKind, rules, { rootDir, scope }) {
  const orgDir = customOrgDir(scope, { rootDir });
  const sectionDir = path.join(orgDir, SECTION_BY_KIND[ownerKind]);
  const filePath = findEntityFileIn(sectionDir, ownerId) ?? path.join(sectionDir, `${ownerId}.json`);
  const existing = readJsonSafe(filePath) || { id: ownerId };
  const record = { ...existing, id: existing.id || ownerId, participationRules: { schemaVersion: 1, rules } };
  fs.mkdirSync(sectionDir, { recursive: true });
  fs.writeFileSync(filePath, JSON.stringify(record, null, 2) + '\n');
  return { path: filePath, record };
}

/**
 * Create or replace (by rule id) one participation rule on an owning
 * specialist/team entry. Writes a minimal partial drop-in when the owner has
 * no file in the target tier — assembleRegistry's per-field merge attaches
 * the rules to the builtin entry without copying it.
 */
export function upsertParticipationRule(ownerId, rule = {}, { rootDir = process.cwd(), scope = 'project' } = {}) {
  assertKnownScope(scope);
  if (scope === 'builtin') return builtinRefusal(`#/participation/${ownerId}`);

  const validation = validateParticipationRule(ownerId, rule, { rootDir });
  if (!validation.ok) return { ok: false, errors: validation.errors, warnings: validation.warnings };

  const registry = assembleRegistry(rootDir);
  const { ownerKind, entry } = participationOwner(registry, ownerId);
  const effective = normalizeParticipationRules(entry.participationRules);
  const rules = effective.some((r) => r?.id === rule.id)
    ? effective.map((r) => (r?.id === rule.id ? rule : r))
    : [...effective, rule];

  const { path: filePath } = participationTierWrite(ownerId, ownerKind, rules, { rootDir, scope });
  return { ok: true, path: filePath, rule, rules, warnings: validation.warnings };
}

/** Remove one rule by id from an owner's effective rule set, writing the remainder to the target tier. */
export function removeParticipationRule(ownerId, ruleId, { rootDir = process.cwd(), scope = 'project' } = {}) {
  assertKnownScope(scope);
  if (scope === 'builtin') return builtinRefusal(`#/participation/${ownerId}`);

  const registry = assembleRegistry(rootDir);
  const owner = participationOwner(registry, ownerId);
  if (!owner) {
    return { ok: false, errors: [{ id: 'participation-owner-unknown', severity: 'error', message: `"${ownerId}" is not a known specialist or team`, location: `#/participation/${ownerId}` }] };
  }
  const effective = normalizeParticipationRules(owner.entry.participationRules);
  if (!effective.some((r) => r?.id === ruleId)) {
    return { ok: false, errors: [{ id: 'participation-rule-not-found', severity: 'error', message: `no rule "${ruleId}" declared on ${owner.ownerKind} "${ownerId}"`, location: `#/participation/${ownerId}/${ruleId}` }] };
  }
  const rules = effective.filter((r) => r?.id !== ruleId);
  const { path: filePath } = participationTierWrite(ownerId, owner.ownerKind, rules, { rootDir, scope });
  return { ok: true, path: filePath, rules };
}

/**
 * Preview the recruited set for a sample request: derive requestSignals from
 * the text exactly as routeRequest does, then run the live recruiter over the
 * assembled registry at rootDir — the same evaluator the run path uses, so
 * the preview never disagrees with real dispatch.
 */
export function previewParticipation({ rootDir = process.cwd(), request = '', kind = 'review', exclude = [] } = {}) {
  const signals = requestSignals(request);
  const recruited = recruit({ signals, kind, exclude, registry: assembleRegistry(rootDir), cwd: rootDir });
  return { signals, recruited };
}

/** Palette + enum vocabulary an authoring surface needs to build a rule editor without hardcoding it. */
export function participationEditorMeta({ rootDir = process.cwd() } = {}) {
  const registry = assembleRegistry(rootDir);
  return {
    watchers: knownWatchers(),
    signalKeys: [...loadSignalDimensions().map((d) => d.key), ...CORE_BOOLEAN_SIGNALS],
    roles: PARTICIPATION_ROLES,
    gates: PARTICIPATION_GATES,
    dimensions: PARTICIPATION_DIMENSIONS,
    specialists: Object.keys(registry.specialists),
    teams: Object.keys(registry.teams || {}),
  };
}
