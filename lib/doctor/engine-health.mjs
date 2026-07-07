/**
 * lib/doctor/engine-health.mjs — doctor checks for the document-export toolchain.
 *
 * lib/document-export.mjs's detect() already probes pandoc/typst/libreoffice/
 * pptxgenjs per export format and returns binary presence, version, and an
 * install hint (ADR-0024). This module turns those probes into one doctor-shaped
 * finding per engine — binary presence, version, and a degradation message naming
 * the missing binary and the export formats it owns — so `construct doctor`
 * predicts whether a pdf/doc/pptx export will work before a workflow relies on
 * it (LMCP-K3), mirroring lib/doctor/sidecar-providers.mjs's pattern of a pure,
 * directly-testable function rather than inline probe logic in the CLI
 * entrypoint or the consistency watcher.
 *
 * branding: 'plain' isolates the pandoc/typst/libreoffice probes from bundled
 * distribution-template presence (construct-pdf.typ, construct-web.html), which
 * is a separate, already-surfaced doctor concern. pptxgenjs is probed with the
 * default 'construct' branding because detect() only selects the pptxgenjs
 * engine (vs. pandoc's native pptx writer) outside of 'plain' branding.
 */
import { detect, installHint } from '../document-export.mjs';

export const EXPORT_ENGINES = [
  {
    id: 'pandoc',
    format: 'html',
    branding: 'plain',
    owningWorkflow: 'document-export (pdf, docx, doc, deck, html, rtf, odt, epub, tex, txt formats)',
  },
  {
    id: 'typst',
    format: 'pdf',
    branding: 'plain',
    owningWorkflow: 'document-export (pdf format, pandoc --pdf-engine)',
  },
  {
    id: 'libreoffice',
    format: 'doc',
    branding: 'plain',
    owningWorkflow: 'document-export (doc format, docx-to-doc down-conversion)',
  },
  {
    id: 'pptxgenjs',
    format: 'pptx',
    branding: 'construct',
    owningWorkflow: 'document-export (pptx format)',
  },
];

/**
 * checkEngineHealthForDoctor(engineId, opts) — one export engine's doctor-shaped finding.
 *
 * Absence is reported as an optional (non-fatal) finding carrying the same
 * install hint `detect()` returns to export preflight, so the message a user
 * sees in `construct doctor` and the message export preflight refuses with
 * are the same string.
 *
 * @param {string} engineId 'pandoc' | 'typst' | 'libreoffice' | 'pptxgenjs'
 * @param {object} [opts]
 * @param {NodeJS.ProcessEnv} [opts.env] injectable PATH/env for tests
 * @param {Function} [opts.detectFn] injectable seam for lib/document-export.mjs detect()
 * @returns {{ ok: boolean, installed: boolean, label: string, optional: boolean }}
 */
export function checkEngineHealthForDoctor(engineId, opts = {}) {
  const probe = EXPORT_ENGINES.find((p) => p.id === engineId);
  if (!probe) throw new Error(`Unknown export engine: ${engineId}`);

  const { env = process.env, detectFn = detect } = opts;
  const result = detectFn(probe.format, env, { branding: probe.branding });
  const installed = !result.missing.includes(engineId);

  if (installed) {
    const status = result.binaries?.find((b) => b.name === engineId);
    const version = status?.version ? ` ${status.version}` : '';
    return { ok: true, installed: true, label: `Export engine '${engineId}'${version} — ${probe.owningWorkflow}`, optional: true };
  }

  return {
    ok: true,
    installed: false,
    label: `Export engine '${engineId}' not installed — ${probe.owningWorkflow} degrades. ${installHint(engineId)}`,
    optional: true,
  };
}

/**
 * checkEngineHealthAllForDoctor(opts) — pandoc + typst + libreoffice + pptxgenjs findings.
 *
 * @param {object} [opts] forwarded per-engine to checkEngineHealthForDoctor
 * @returns {Array<{ ok: boolean, installed: boolean, label: string, optional: boolean }>}
 */
export function checkEngineHealthAllForDoctor(opts = {}) {
  return EXPORT_ENGINES.map((p) => checkEngineHealthForDoctor(p.id, opts));
}
