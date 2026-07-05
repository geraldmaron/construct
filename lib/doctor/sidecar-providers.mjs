/**
 * lib/doctor/sidecar-providers.mjs — doctor checks for governed ingestion sidecars.
 *
 * docling and whisper are declared as `ingestion-provider` manifests
 * (lib/extensions/manifests/docling.manifest.json, whisper.manifest.json) with
 * an install probe, a health check, and a degradation chain. This module turns
 * those probes into doctor-shaped findings so `construct doctor` reports
 * install+health accurately whether or not the sidecar is present — mirroring
 * lib/doctor/project-adapters.mjs's pattern of a pure, directly-testable
 * function rather than inline logic in the CLI entrypoint.
 */
import { probeHealth } from '../ingest/sidecar-providers.mjs';

/**
 * checkSidecarProviderForDoctor(id, opts) — one provider's doctor-shaped finding.
 *
 * Absence is reported as an optional (non-fatal) finding with an actionable
 * label; presence with a failing health check is reported as a non-optional
 * finding since an installed-but-broken sidecar is a real defect, not an
 * expected absence.
 *
 * @param {string} id 'docling' | 'whisper'
 * @param {object} [opts] forwarded to lib/ingest/sidecar-providers.mjs probeHealth (injectable seams for fake probes)
 * @returns {{ ok: boolean, label: string, optional: boolean }}
 */
export function checkSidecarProviderForDoctor(id, opts = {}) {
  const health = probeHealth(id, opts);

  if (!health.ok) {
    return { ok: false, label: `Ingestion provider '${id}': check failed (${health.detail})`, optional: false };
  }
  if (!health.installProbe.installed) {
    return {
      ok: true,
      label: `Ingestion provider '${id}': not installed (${health.detail}) — ingest degrades per its declared fallback chain`,
      optional: true,
    };
  }
  if (!health.healthy) {
    return { ok: false, label: `Ingestion provider '${id}': installed but unhealthy (${health.detail})`, optional: false };
  }
  return { ok: true, label: `Ingestion provider '${id}': ${health.detail}`, optional: true };
}

/**
 * checkSidecarProvidersForDoctor(opts) — docling + whisper doctor findings.
 *
 * @param {object} [opts] forwarded per-provider to checkSidecarProviderForDoctor
 * @returns {Array<{ ok: boolean, label: string, optional: boolean }>}
 */
export function checkSidecarProvidersForDoctor(opts = {}) {
  return [
    checkSidecarProviderForDoctor('docling', opts),
    checkSidecarProviderForDoctor('whisper', opts),
  ];
}
