/**
 * lib/providers/filter-schema.mjs — provider filter block JSON schema (ADR-0060).
 *
 * Ships the normalized filter grammar every provider kind may accept:
 * `scope` (per-kind container allowlist), `predicates` (portable field-level
 * filter core), and `nativeQuery` (provider-native passthrough escape hatch).
 * Per-kind manifest `configSchema` fields reference this via `$ref`; per-kind
 * `SCOPE_FIELDS_BY_PROVIDER` in `lib/providers/contract.mjs` declares which
 * `scope` keys a given provider kind actually honors.
 *
 * Data-only module (schema + enums), consumed by `validateFilterConfig()`
 * in `lib/providers/contract.mjs`. No JSON-Schema engine runs here — the
 * shape below is the source of truth the hand-rolled validator checks
 * against, keeping schema and validator from drifting silently apart.
 */

export const FILTER_SCHEMA = Object.freeze({
  $id: 'construct:provider-filter',
  type: 'object',
  additionalProperties: false,
  properties: {
    scope: {
      type: 'object',
      additionalProperties: false,
      properties: {
        projects: { type: 'array', items: { type: 'string' } },
        repos: { type: 'array', items: { type: 'string' } },
        repoGlob: { type: 'array', items: { type: 'string' } },
        channels: { type: 'array', items: { type: 'string' } },
        spaces: { type: 'array', items: { type: 'string' } },
      },
    },
    predicates: {
      type: 'object',
      additionalProperties: false,
      properties: {
        assignee: { type: 'array', items: { type: 'string' } },
        statusCategory: { type: 'array', items: { enum: ['to-do', 'in-progress', 'done'] } },
        priority: { type: 'array', items: { type: 'string' } },
        label: { type: 'array', items: { type: 'string' } },
        updatedSince: { type: 'string' },
      },
    },
    nativeQuery: { type: 'string' },
  },
});

export const SCOPE_KEYS = Object.freeze(['projects', 'repos', 'repoGlob', 'channels', 'spaces']);

export const PREDICATE_KEYS = Object.freeze(['assignee', 'statusCategory', 'priority', 'label', 'updatedSince']);

export const STATUS_CATEGORIES = Object.freeze(['to-do', 'in-progress', 'done']);

export const TOP_LEVEL_KEYS = Object.freeze(['scope', 'predicates', 'nativeQuery']);
