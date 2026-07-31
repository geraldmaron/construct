/**
 * lib/oracle/invariants/cross-process-state-has-one-authoritative-location.mjs — Layer 1
 * deterministic invariant: the set of functions that independently derive "which project
 * is this" must stay exactly the known, documented set — no new one may
 * appear undocumented, and none of the known ones may stop documenting itself.
 *
 * Triple project identity was known only because a human wrote a comment
 * about it in the code, never because a check found it. The invariant here
 * (deterministic, Layer 1) makes it mechanical. Three derivations exist today:
 * `lib/state-root.mjs`'s `deriveProjectKey` (git-origin-remote hash),
 * `lib/orchestration/store.mjs`'s
 * `projectKey` (`config.deployment.projectName || cwd`), and `lib/embed/daemon.mjs`'s
 * `resolveRootDir`/`findProjectRoot` (a capped ancestor walk for `.construct/context.md`,
 * falling back to `homedir()`). `deriveProjectKey` is the canonical one, with
 * `store.mjs` and `daemon.mjs` as execution-work targets that
 * have not converged yet. Until that convergence lands, "one authoritative location" is
 * enforced as "exactly the known, documented divergence, not a silent fourth or fifth
 * one" — `state-root.mjs` and `store.mjs` already say so in their own headers;
 * `daemon.mjs` does
 * not, which this invariant surfaces as a real, standing gap rather than papering over
 * it, since `lib/embed/**` is this repo's owned-by-another-lane boundary this wave and
 * cannot be edited here.
 *
 * A derivation site is detected by an exact exported-function-name match against a
 * short, explicit allowlist of the shapes actually named — not a
 * broad heuristic regex — so the check cannot mistake an unrelated `projectKey`-shaped
 * helper elsewhere for a new divergence; it can only ever under-detect a genuinely new
 * site that reuses none of the three known names, same trade-off
 * `tests-never-write-real-user-state.mjs` makes for its own static scan.
 */

import { readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';

export const id = 'cross-process-state-has-one-authoritative-location';
export const layer = 1;
export const description =
  'The set of independent "which project is this" derivation functions must stay exactly the known, documented set — no undocumented new site, and no known site that stops saying its derivation is one of several.';

// A known site proves it is documented by saying, in its own words, that its
// derivation is one of several rather than the only one. Matching the claim
// instead of a tracker id keeps the check readable from the source alone and
// keeps it working when the tracker item is closed.

const DIVERGENCE_MARKERS = [
  /\bderivation\b/i,
  /\bproject[- ]identity\b/i,
  /\bcanonical\b[^\n]*\bproject\b/i,
];

export const KNOWN_DERIVATION_SITES = [
  { file: 'lib/state-root.mjs', functionName: 'deriveProjectKey' },
  { file: 'lib/orchestration/store.mjs', functionName: 'projectKey' },
  { file: 'lib/embed/daemon.mjs', functionName: 'resolveRootDir' },
];

const DERIVATION_NAME_RE = /\bexport\s+function\s+(deriveProjectKey|projectKey|resolveRootDir|resolveProjectIdentity|deriveProjectId)\s*\(/g;

function walkMjsFiles(dir, out = []) {
  let entries;
  try {
    entries = readdirSync(dir);
  } catch {
    return out;
  }
  for (const entry of entries) {
    if (entry === 'node_modules' || entry.startsWith('.')) continue;
    const p = path.join(dir, entry);
    let st;
    try {
      st = statSync(p);
    } catch {
      continue;
    }
    if (st.isDirectory()) walkMjsFiles(p, out);
    else if (entry.endsWith('.mjs')) out.push(p);
  }
  return out;
}

/**
 * @param {string} libDir absolute path to the `lib/` tree to scan
 * @returns {{file: string, functionName: string}[]} every match of the derivation-name allowlist
 */
export function scanForDerivationSites(libDir) {
  const found = [];
  for (const file of walkMjsFiles(libDir)) {
    const source = readFileSync(file, 'utf8');
    DERIVATION_NAME_RE.lastIndex = 0;
    let m;
    while ((m = DERIVATION_NAME_RE.exec(source))) {
      found.push({ file: path.relative(path.dirname(libDir), file), functionName: m[1] });
    }
  }
  return found;
}

function siteKey(site) {
  return `${site.file}::${site.functionName}`;
}

/**
 * @param {{cwd?: string, libDir?: string, knownSites?: typeof KNOWN_DERIVATION_SITES}} [opts]
 */
export async function check({
  cwd = process.cwd(),
  libDir = path.join(cwd, 'lib'),
  knownSites = KNOWN_DERIVATION_SITES,
} = {}) {
  let found;
  try {
    found = scanForDerivationSites(libDir);
  } catch (err) {
    return {
      status: 'collection-error',
      detail: `failed to scan lib/ for project-identity derivation sites: ${err.message || err}`,
      evaluated: 0,
      violations: [],
      unresolved: [],
      results: [],
    };
  }

  const knownKeys = new Set(knownSites.map(siteKey));
  const foundKeys = new Set(found.map(siteKey));
  const results = [];
  const unresolved = [];

  const unexpected = found.filter((site) => !knownKeys.has(siteKey(site)));
  for (const site of unexpected) {
    results.push({
      site: siteKey(site),
      status: 'failed',
      violation: true,
      detail: `${site.file} exports '${site.functionName}', an undocumented project-identity derivation site — exactly ${knownSites.length} sites are documented, and this is not one of them`,
    });
  }

  for (const known of knownSites) {
    const key = siteKey(known);
    if (!foundKeys.has(key)) {
      const entry = {
        site: key,
        status: 'unknown',
        detail: `${known.file} no longer exports '${known.functionName}' — the known derivation site may have moved or been renamed; this invariant needs updating rather than silently passing`,
      };
      results.push(entry);
      unresolved.push(entry);
      continue;
    }

    let source;
    try {
      source = readFileSync(path.join(cwd, known.file), 'utf8');
    } catch (err) {
      const entry = { site: key, status: 'unknown', detail: `failed to read ${known.file}: ${err.message || err}` };
      results.push(entry);
      unresolved.push(entry);
      continue;
    }

    const documented = DIVERGENCE_MARKERS.some((marker) => marker.test(source));
    results.push({
      site: key,
      status: documented ? 'passed' : 'failed',
      violation: !documented,
      detail: documented
        ? `${known.file} documents that its project-identity derivation is one of several`
        : `${known.file} exports '${known.functionName}' but its source never says the derivation is one of several — the known divergence is no longer documented at this site`,
    });
  }

  const violations = results.filter((r) => r.status === 'failed');
  let status = 'passed';
  if (violations.length > 0) status = 'failed';
  else if (unresolved.length > 0) status = 'unknown';

  return { status, evaluated: results.length, violations, unresolved, results };
}
