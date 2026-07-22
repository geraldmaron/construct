/**
 * lib/oracle/invariants/config-schema-has-no-shadowed-properties.mjs — Layer 1
 * deterministic invariant: `schemas/project-config.schema.json` (the committed,
 * documented schema for `construct.config.json`) and `lib/config/schema.mjs`'s
 * `FIELD_RULES` (the runtime validator) must agree on every property they both
 * describe, or one silently shadows the other with a contradicting definition.
 *
 * Per the oracle-miss-report's row 9 (directive scaffolding + duplicate schema key +
 * FIELD_RULES gap): "no invariant checks schema-key uniqueness or config-field/
 * FIELD_RULES parity... a `config-schema-has-no-shadowed-properties`... invariant"
 * (deterministic, Layer 1). A live diff of the two real schema sources (2026-07-16)
 * found the drift the report warned about is not hypothetical:
 *
 *   - `orchestration.workerBackend`: `FIELD_RULES`'s `ORCHESTRATION_WORKER_BACKENDS`
 *     (`lib/config/schema.mjs:30`) is `['inline', 'provider', 'host']`; the JSON schema's
 *     enum (`schemas/project-config.schema.json:64`) is `["inline", "provider"]` —
 *     `'host'` silently validates in FIELD_RULES but is undocumented in the committed
 *     schema.
 *   - `ingest.strategy`: `INGEST_STRATEGIES` (`lib/config/schema.mjs:26`) is
 *     `['adapter', 'provider', 'docling-remote']`; the JSON schema's enum
 *     (`schemas/project-config.schema.json:106`) is `["adapter", "provider"]` — same gap
 *     for `'docling-remote'`.
 *   - `models.visibility.mode`: the JSON schema declares `"default": "all_configured"`
 *     (`schemas/project-config.schema.json:183`); `DEFAULT_PROJECT_CONFIG.models.
 *     visibility.mode` (`lib/config/schema.mjs:84`) is `'tier_defaults'` — the two
 *     schema sources disagree on which value a fresh config actually gets.
 *   - `costs` and `hooks`: both are real, validated top-level fields in `FIELD_RULES`
 *     (`lib/config/schema.mjs:119,186,194`) with no corresponding entry anywhere in
 *     `schemas/project-config.schema.json`'s `properties` — the committed "source of
 *     truth for project-level Construct settings" (the schema file's own `description`)
 *     documents neither.
 *
 * Scope is deliberately narrow: comparing the two hand-maintained schema *sources* for
 * the same config file, not general JSON-schema linting — literal duplicate JSON keys
 * are a parse-time fact the report separately assigns to standard JSON linting.
 */

import { readFileSync } from 'node:fs';
import path from 'node:path';

import { FIELD_RULES, DEFAULT_PROJECT_CONFIG } from '../../config/schema.mjs';

export const id = 'config-schema-has-no-shadowed-properties';
export const layer = 1;
export const description =
  "schemas/project-config.schema.json and lib/config/schema.mjs's FIELD_RULES must agree on every property they both describe (enum values, presence, declared defaults).";

function getByPath(obj, dotted) {
  return dotted.split('.').reduce((o, k) => (o == null ? undefined : o[k]), obj);
}

/**
 * Recursively compares one FIELD_RULES node against the corresponding JSON-schema node,
 * appending a result per compared property.
 */
export function compareNode(fieldRule, jsonNode, pathStr, results) {
  if (!jsonNode) {
    results.push({
      path: pathStr,
      status: 'failed',
      violation: true,
      detail: `'${pathStr}' is declared in FIELD_RULES but absent from schemas/project-config.schema.json's properties`,
    });
  } else {
    if (fieldRule.enum) {
      const jsonEnum = jsonNode.enum;
      if (!jsonEnum) {
        results.push({
          path: pathStr,
          status: 'failed',
          violation: true,
          detail: `'${pathStr}': FIELD_RULES declares enum ${JSON.stringify(fieldRule.enum)} but the JSON schema has no enum constraint`,
        });
      } else {
        const jsonSet = new Set(jsonEnum);
        const jsSet = new Set(fieldRule.enum);
        const missingInJson = fieldRule.enum.filter((v) => !jsonSet.has(v));
        const missingInJs = jsonEnum.filter((v) => !jsSet.has(v));
        if (missingInJson.length || missingInJs.length) {
          results.push({
            path: pathStr,
            status: 'failed',
            violation: true,
            detail: `'${pathStr}': enum mismatch — FIELD_RULES has ${JSON.stringify(fieldRule.enum)}, JSON schema has ${JSON.stringify(jsonEnum)} (missing from JSON schema: ${JSON.stringify(missingInJson)}; missing from FIELD_RULES: ${JSON.stringify(missingInJs)})`,
          });
        } else {
          results.push({ path: pathStr, status: 'passed', detail: `'${pathStr}': enum matches` });
        }
      }
    } else {
      results.push({ path: pathStr, status: 'passed', detail: `'${pathStr}': present in both schema sources` });
    }

    if (jsonNode.default !== undefined) {
      const actualDefault = getByPath(DEFAULT_PROJECT_CONFIG, pathStr);
      if (actualDefault !== undefined && actualDefault !== jsonNode.default) {
        results.push({
          path: `${pathStr}#default`,
          status: 'failed',
          violation: true,
          detail: `'${pathStr}': JSON schema declares default ${JSON.stringify(jsonNode.default)} but DEFAULT_PROJECT_CONFIG's actual value is ${JSON.stringify(actualDefault)}`,
        });
      } else if (actualDefault !== undefined) {
        results.push({ path: `${pathStr}#default`, status: 'passed', detail: `'${pathStr}': default matches` });
      }
    }
  }

  if (fieldRule.fields) {
    for (const [key, sub] of Object.entries(fieldRule.fields)) {
      compareNode(sub, jsonNode?.properties?.[key], `${pathStr}.${key}`, results);
    }
  }
}

/**
 * @param {{cwd?: string, schemaPath?: string}} [opts]
 */
export async function check({
  cwd = process.cwd(),
  schemaPath = path.join(cwd, 'schemas', 'project-config.schema.json'),
} = {}) {
  let jsonSchema;
  try {
    jsonSchema = JSON.parse(readFileSync(schemaPath, 'utf8'));
  } catch (err) {
    return {
      status: 'collection-error',
      detail: `failed to read/parse ${schemaPath}: ${err.message || err}`,
      evaluated: 0,
      violations: [],
      unresolved: [],
      results: [],
    };
  }

  const results = [];
  for (const [key, rule] of Object.entries(FIELD_RULES)) {
    compareNode(rule, jsonSchema.properties?.[key], key, results);
  }

  const violations = results.filter((r) => r.status === 'failed');
  return {
    status: violations.length > 0 ? 'failed' : 'passed',
    evaluated: results.length,
    violations,
    unresolved: [],
    results,
  };
}
