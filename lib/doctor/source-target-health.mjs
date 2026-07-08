/**
 * lib/doctor/source-target-health.mjs — health of registered source targets
 * (bead construct-760c.8, epic closer for multi-project context targets).
 *
 * Filesystem- and env-only: it resolves the project's `sources.targets[]` and
 * reports three classes of problem without ever opening a socket, so the default
 * `construct doctor` keeps its zero-outbound-fetch invariant (deep connectivity
 * probes stay behind `--probe-providers`):
 *   - a directory target whose path does not resolve,
 *   - a corpus target whose local cache is missing or older than its TTL
 *     (actionable: `construct sources sync <id>`),
 *   - a network-backed target whose credential env var is not present (a
 *     presence check only, surfaced as a soft notice).
 *
 * With no targets configured it returns an empty finding set — the caller emits
 * nothing, so a project that never registered a target sees no source-target
 * noise (R2).
 */

import { statSync } from 'node:fs';

import { loadProjectConfig } from '../config/project-config.mjs';
import { getSourceTargetDescriptor } from '../config/source-target-registry.mjs';
import { expandTilde, resolveEffectiveSourceTargetsFromConfig } from '../config/source-targets.mjs';
import { isCorpusTarget, corpusFreshness, DEFAULT_CORPUS_TTL_MS } from '../sources/repo-cache.mjs';

// Credential env var per network-backed provider — presence-only, never read for
// its value. Directory targets need none and are absent from the map.
const CREDENTIAL_ENV = {
  github: 'GITHUB_TOKEN',
  jira: 'JIRA_API_TOKEN',
  confluence: 'CONFLUENCE_API_TOKEN',
  slack: 'SLACK_BOT_TOKEN',
  linear: 'LINEAR_API_KEY',
};

function directoryFinding(target) {
  const descriptor = getSourceTargetDescriptor(target.provider);
  const raw = target.selector?.[descriptor.selector.field];
  const dir = expandTilde(String(raw ?? ''));
  let ok = false;
  try { ok = statSync(dir).isDirectory(); } catch { ok = false; }
  return ok
    ? { label: `Source target ${target.id} (directory) path resolves`, ok: true }
    : { label: `Source target ${target.id} (directory) path missing: ${dir} — fix the path or run \`construct sources remove ${target.id}\``, ok: false };
}

function corpusFinding(target, { cwd, ttlMs, now }) {
  const f = corpusFreshness(target, { projectRoot: cwd, ttlMs, now });
  if (!f.cached) {
    return { label: `Source target ${target.id} (corpus) not yet cached — run \`construct sources sync ${target.id}\``, ok: false, optional: true };
  }
  if (f.stale) {
    return { label: `Source target ${target.id} (corpus) cache is stale — run \`construct sources sync ${target.id}\``, ok: false, optional: true };
  }
  return { label: `Source target ${target.id} (corpus) cache is fresh`, ok: true };
}

function credentialFinding(target, env) {
  const varName = CREDENTIAL_ENV[target.provider];
  if (!varName) return null;
  const present = typeof env[varName] === 'string' && env[varName].trim() !== '';
  return present
    ? null
    : { label: `Source target ${target.id} (${target.provider}) credential not detected (${varName}) — presence check only`, ok: false, optional: true };
}

/**
 * Evaluate source-target health. Returns { configured, findings } where each
 * finding is { label, ok, optional? }. An empty findings array (configured 0)
 * means the caller should stay silent.
 *
 * @param {object} [opts]
 * @param {string} [opts.cwd]
 * @param {object} [opts.env]
 * @param {number} [opts.ttlMs]  corpus staleness threshold
 * @param {number} [opts.now]    injectable clock (ms) for testing
 */
export function checkSourceTargetHealth({ cwd = process.cwd(), env = process.env, ttlMs = DEFAULT_CORPUS_TTL_MS, now = Date.now() } = {}) {
  // Read the DECLARED targets from raw config, not the validated `config` — a
  // directory target whose path was deleted fails config validation and would
  // otherwise be sanitized away to an empty set, hiding the very problem this
  // watcher exists to flag. `raw` preserves what the user actually registered.
  const loaded = loadProjectConfig(cwd, env);
  const sourceConfig = loaded.raw ?? loaded.config;
  const targets = resolveEffectiveSourceTargetsFromConfig(sourceConfig, env);
  if (!targets.length) return { configured: 0, findings: [] };

  const findings = [];
  for (const target of targets) {
    const descriptor = getSourceTargetDescriptor(target.provider);
    if (descriptor?.selector?.existsAs === 'directory') {
      findings.push(directoryFinding(target));
    } else if (isCorpusTarget(target)) {
      findings.push(corpusFinding(target, { cwd, ttlMs, now }));
    }
    const cred = credentialFinding(target, env);
    if (cred) findings.push(cred);
  }
  return { configured: targets.length, findings };
}
