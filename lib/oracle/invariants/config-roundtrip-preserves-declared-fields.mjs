/**
 * lib/oracle/invariants/config-roundtrip-preserves-declared-fields.mjs — Layer 1
 * deterministic invariant: every field `FIELD_RULES` declares must survive a real
 * `writeProjectConfig()` / `loadProjectConfig()` roundtrip unchanged, or a config write
 * silently drops or mutates a value the schema promises to preserve.
 *
 * Per the oracle-miss-report's rows 9-11 ("duplicate schema key + FIELD_RULES gap",
 * "dropped `watch` field, dual polling models"): "a `config-roundtrip-preserves-
 * declared-fields` invariant" (deterministic, Layer 1). Exercises the real production
 * write/load path (`lib/config/project-config.mjs`'s `writeProjectConfig`/
 * `loadProjectConfig`) against a real file in a hermetic tmpdir — not a mock — with a
 * representative value populated at every leaf `FIELD_RULES` declares, then diffs the
 * loaded config back against what was written. A `passed` result here is itself
 * evidence, not a tautology: it certifies the write/load path (`deepMerge` in
 * `loadProjectConfig`, `JSON.stringify` in `writeProjectConfig`) still does what its own
 * "unknown fields will be ignored" warning implies it should for every declared field,
 * a property that is easy to break silently (e.g. a future field-allowlist filter added
 * to `writeProjectConfig` for the stated-but-currently-unenforced "ignored" behavior).
 *
 * `deepMerge` (`lib/config/project-config.mjs:63-71`) recursively unions an object-typed
 * override onto `DEFAULT_PROJECT_CONFIG`'s own nested defaults for that key rather than
 * replacing the whole subtree — intentional, since a FIELD_RULES leaf with no declared
 * `.fields` (e.g. `resources`, whose default already carries `disk`/`process`) is meant
 * to accept a partial override without restating every default sub-key. A whole-object
 * equality check would misreport that union as a dropped-field violation, so such leaves
 * are checked by marker-key survival (does the value this invariant wrote still read
 * back intact somewhere under that path) rather than exact equality of the entire
 * subtree.
 */

import { mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { isDeepStrictEqual } from 'node:util';

import { FIELD_RULES, CONFIG_SCHEMA_VERSION } from '../../config/schema.mjs';
import { writeProjectConfig, loadProjectConfig } from '../../config/project-config.mjs';

export const id = 'config-roundtrip-preserves-declared-fields';
export const layer = 1;
export const description =
  'Every FIELD_RULES-declared config field must survive a real writeProjectConfig()/loadProjectConfig() roundtrip unchanged.';

/**
 * Fields guarded by a semantic validator that rejects synthetic markers
 * (writeProjectConfig refuses the whole config if they fail) get a real,
 * validator-passing representative value instead of an __invariantProbe
 * marker, and are compared by exact deep equality rather than marker
 * survival. writes.policy: validateWritePolicyConfig requires
 * "<knownProvider>.<writeKind>": "auto"|"approval"|"deny" entries.
 */
export const SEMANTIC_PROBE_OVERRIDES = Object.freeze({
  'writes.policy': Object.freeze({ 'atlassian-jira.comment': 'auto' }),
});

/**
 * Builds a distinct, representative value per FIELD_RULES leaf so a roundtrip that
 * silently swaps or drops one field's value is detectable rather than coincidentally
 * matching a shared default.
 */
export function representativeValue(rule, keyPath, counter) {
  if (SEMANTIC_PROBE_OVERRIDES[keyPath]) return SEMANTIC_PROBE_OVERRIDES[keyPath];
  if (rule.fields) {
    const obj = {};
    for (const [key, sub] of Object.entries(rule.fields)) {
      obj[key] = representativeValue(sub, `${keyPath}.${key}`, counter);
    }
    return obj;
  }
  if (rule.enum) return rule.enum[0];

  const types = Array.isArray(rule.type) ? rule.type : [rule.type];
  const t = types[0];
  if (t === 'number') return keyPath === 'version' ? CONFIG_SCHEMA_VERSION : (counter.n += 1);
  if (t === 'boolean') return true;
  if (t === 'array') return [];
  if (t === 'null') return null;
  if (t === 'object') return { __invariantProbe: `${keyPath}-probe` };
  return `${keyPath}-probe-value`;
}

export function buildRepresentativeConfig() {
  const counter = { n: 0 };
  const config = {};
  for (const [key, rule] of Object.entries(FIELD_RULES)) {
    config[key] = representativeValue(rule, key, counter);
  }
  return config;
}

/**
 * Flattens FIELD_RULES to the leaves a roundtrip must preserve — an object rule with no
 * `fields` (e.g. `providers`, `resources`) is itself a leaf, since FIELD_RULES declares
 * no sub-shape to check; it is tagged `isObjectMarker` so the caller compares it by
 * marker-key survival instead of whole-subtree equality (see the module header).
 */
export function collectLeaves(fieldRules, prefix = '') {
  const leaves = [];
  for (const [key, rule] of Object.entries(fieldRules)) {
    const p = prefix ? `${prefix}.${key}` : key;
    if (SEMANTIC_PROBE_OVERRIDES[p]) {
      leaves.push({ path: p, isObjectMarker: false });
      continue;
    }
    if (rule.fields) {
      leaves.push(...collectLeaves(rule.fields, p));
      continue;
    }
    const types = Array.isArray(rule.type) ? rule.type : [rule.type];
    leaves.push({ path: p, isObjectMarker: !rule.enum && types[0] === 'object' });
  }
  return leaves;
}

function getByPath(obj, dotted) {
  return dotted.split('.').reduce((o, k) => (o == null ? undefined : o[k]), obj);
}

/**
 * Pure diff between a representative config and whatever a real
 * writeProjectConfig()/loadProjectConfig() roundtrip produced, isolated from the file
 * I/O so the comparison rules (object-marker leaves vs. exact equality) are unit-
 * testable without a real filesystem roundtrip.
 */
export function compareRoundtrip(original, roundtrippedConfig, fieldRules = FIELD_RULES) {
  return collectLeaves(fieldRules).map(({ path: p, isObjectMarker }) => {
    const originalValue = getByPath(original, p);
    const roundtripped = getByPath(roundtrippedConfig, p);
    const preserved = isObjectMarker
      ? roundtripped != null && typeof roundtripped === 'object' && roundtripped.__invariantProbe === originalValue.__invariantProbe
      : isDeepStrictEqual(originalValue, roundtripped);
    return {
      field: p,
      status: preserved ? 'passed' : 'failed',
      violation: !preserved,
      detail: preserved
        ? `'${p}' survives the write+load roundtrip`
        : `'${p}' changed across the roundtrip: wrote ${JSON.stringify(originalValue)}, loaded ${JSON.stringify(roundtripped)}`,
    };
  });
}

function defaultTmpDir() {
  return mkdtempSync(path.join(os.tmpdir(), 'cx-invariant-config-roundtrip-'));
}

/**
 * @param {{cwd?: string, tmpDirFactory?: () => string}} [opts]
 */
export async function check({ tmpDirFactory = defaultTmpDir } = {}) {
  const dir = tmpDirFactory();
  try {
    const config = buildRepresentativeConfig();
    const configPath = path.join(dir, 'construct.config.json');

    try {
      writeProjectConfig(configPath, config, { silent: true });
    } catch (err) {
      return {
        status: 'collection-error',
        detail: `writeProjectConfig() rejected the representative config: ${err.message || err}`,
        evaluated: 0,
        violations: [],
        unresolved: [],
        results: [],
      };
    }

    let loaded;
    try {
      loaded = loadProjectConfig(dir);
    } catch (err) {
      return {
        status: 'collection-error',
        detail: `loadProjectConfig() threw: ${err.message || err}`,
        evaluated: 0,
        violations: [],
        unresolved: [],
        results: [],
      };
    }
    if (loaded.errors.length) {
      return {
        status: 'collection-error',
        detail: `loadProjectConfig() reported errors reading back what writeProjectConfig() just wrote: ${loaded.errors.join('; ')}`,
        evaluated: 0,
        violations: [],
        unresolved: [],
        results: [],
      };
    }

    const results = compareRoundtrip(config, loaded.config);
    const violations = results.filter((r) => r.status === 'failed');
    return {
      status: violations.length > 0 ? 'failed' : 'passed',
      evaluated: results.length,
      violations,
      unresolved: [],
      results,
    };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}
