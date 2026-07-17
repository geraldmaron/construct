/**
 * lib/providers/binary-health.mjs — version-identity health check for `kind: 'binary'`
 * Provider Cards (construct-tsyfe.10.3).
 *
 * Extends the presence-only probing lib/ingest/sidecar-providers.mjs already
 * does for docling/whisper to the user-installed binaries construct shells
 * out to (pandoc, typst, d2, dot, soffice, vhs, ffmpeg — see
 * registry/provider-cards.json). Runs the Provider Card's declared
 * healthCheck.command/args, extracts a dotted version number from
 * stdout/stderr, and compares it against the card's
 * versionPolicy.expectedVersion.
 *
 * A missing binary is `installed:false, healthy:false` (mirroring
 * sidecar-providers.mjs's probe shape). A present-but-mismatched version is
 * `healthy:true, versionMatch:false` with a non-null `warning` — never a
 * hard failure, since these binaries are user-managed, not
 * Construct-bundled; this module only adds a warning layer on top of the
 * existing presence check, it does not change any degradation behavior.
 *
 * Accepts an injectable `execImpl` seam (mirrors sidecar-providers.mjs's
 * pattern) so tests exercise present/absent/mismatch paths without
 * depending on real binaries being installed on the test machine.
 */
import { spawnSync } from 'node:child_process';

const VERSION_PATTERN = /\d+(?:\.\d+){1,3}/;

/**
 * Extract the first dotted version number (e.g. `3.10`, `15.0.0`) from a
 * health-check subprocess's output. Returns null if none is found.
 */
export function extractVersion(output) {
  if (!output) return null;
  const match = String(output).match(VERSION_PATTERN);
  return match ? match[0] : null;
}

/**
 * Run a single `kind: 'binary'` Provider Card's subprocess-version health
 * check and report version identity alongside presence/health.
 *
 * @param {object} card a Provider Card with kind:'binary' and
 *   healthCheck.kind:'subprocess-version'
 * @param {object} [opts]
 * @param {Function} [opts.execImpl] injectable spawnSync (fake probes)
 * @returns {{ ok: boolean, installed: boolean, healthy: boolean,
 *   versionMatch: (boolean|null), actualVersion: (string|null),
 *   expectedVersion: (string|null), warning: (string|null), detail: string }}
 */
export function checkBinaryVersion(card, { execImpl = spawnSync } = {}) {
  if (!card || card.kind !== 'binary') {
    return {
      ok: false, installed: false, healthy: false, versionMatch: null,
      actualVersion: null, expectedVersion: null, warning: null,
      detail: `checkBinaryVersion requires a 'binary' kind Provider Card, got '${card?.kind}'`,
    };
  }
  const check = card.healthCheck;
  if (!check || check.kind !== 'subprocess-version') {
    return {
      ok: false, installed: false, healthy: false, versionMatch: null,
      actualVersion: null, expectedVersion: null, warning: null,
      detail: `provider '${card.id}' healthCheck.kind must be 'subprocess-version', got '${check?.kind}'`,
    };
  }

  const result = execImpl(check.command, check.args || [], { encoding: 'utf8', timeout: check.timeoutMs });

  if (result.error) {
    const notFound = result.error.code === 'ENOENT';
    return {
      ok: true,
      installed: !notFound,
      healthy: false,
      versionMatch: null,
      actualVersion: null,
      expectedVersion: card.versionPolicy?.expectedVersion || null,
      warning: null,
      detail: notFound
        ? `${card.id} not found on PATH`
        : `${card.id} health check failed to spawn: ${result.error.message}`,
    };
  }
  if (result.status !== 0) {
    return {
      ok: true,
      installed: true,
      healthy: false,
      versionMatch: null,
      actualVersion: null,
      expectedVersion: card.versionPolicy?.expectedVersion || null,
      warning: null,
      detail: `${card.id} health check exited ${result.status}: ${(result.stderr || result.stdout || '').trim().slice(0, 200)}`,
    };
  }

  const output = (result.stdout || result.stderr || '').trim();
  const actualVersion = extractVersion(output);
  const expectedVersion = card.versionPolicy?.expectedVersion || null;
  const versionMatch = expectedVersion && actualVersion ? actualVersion === expectedVersion : null;

  // A mismatch warns; it never flips healthy to false. These binaries are
  // user-installed and legitimately vary by machine (decision (a),
  // construct-tsyfe.10.3) — the binary working at all is what "healthy" means.

  const warning = expectedVersion && actualVersion && !versionMatch
    ? `${card.id} version mismatch: expected ${expectedVersion}, found ${actualVersion} (warning only — the installed binary is user-managed, not Construct-bundled)`
    : null;

  return {
    ok: true,
    installed: true,
    healthy: true,
    versionMatch,
    actualVersion,
    expectedVersion,
    warning,
    detail: output.split('\n')[0] || `${card.id} healthy`,
  };
}
