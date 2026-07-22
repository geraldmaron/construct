/**
 * lib/doctor/export-engines.mjs — compact document-export toolchain lines for doctor.
 *
 * Pandoc, Typst, LibreOffice, and pptxgenjs are optional until a workflow
 * exports a document. Default doctor emits one skip line; --verbose-export expands
 * to per-engine install hints (Chrome/LibreOffice messaging included).
 */

import { checkEngineHealthAllForDoctor } from './engine-health.mjs';

/**
 * @param {{ verbose?: boolean, detectFn?: Function, env?: NodeJS.ProcessEnv }} [opts]
 * @returns {Array<{ pass: boolean, optional: boolean, label: string }>}
 */
export function buildExportEngineChecks(opts = {}) {
  const { verbose = false, ...engineOpts } = opts;
  const findings = checkEngineHealthAllForDoctor(engineOpts);
  const missing = findings.filter((f) => !f.installed);

  if (missing.length === 0) {
    if (verbose) {
      return findings.map((f) => ({ pass: true, optional: true, label: f.label }));
    }
    const names = findings
      .map((f) => f.label.match(/^Export engine '([^']+)'/)?.[1])
      .filter(Boolean);
    return [{
      pass: true,
      optional: true,
      label: `Document export engines: ready (${names.join(', ')})`,
    }];
  }

  if (verbose) {
    return findings.map((f) => ({
      pass: f.installed,
      optional: true,
      label: f.label,
    }));
  }

  const names = missing.map((f) => f.label.match(/^Export engine '([^']+)'/)?.[1]).filter(Boolean);
  return [{
    pass: true,
    optional: true,
    label: `Document export engines: optional, not installed (${names.join(', ')}) — PDF/DOCX/PPTX export unavailable until installed; run \`construct tools detect\` for install hints`,
  }];
}
