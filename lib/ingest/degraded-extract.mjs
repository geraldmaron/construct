/**
 * lib/ingest/degraded-extract.mjs — manifest-governed extraction with a declared fallback chain.
 *
 * lib/document-ingest.mjs already bounds a docling attempt with a timeout and
 * falls back to the node-native extractor on any failure; extractWithChain adds
 * the governance piece LMCP-K2 requires — the fallback path comes from the
 * docling ingestion-provider manifest's `degradation.chain` (docling ->
 * node-native -> refuse) rather than being implicit in the calling code, and
 * every result is stamped `degraded` so a caller can tell "docling ran" from
 * "docling was unavailable and a lower-fidelity extractor stood in." A file
 * type outside the node-native backend's coverage (xlsx/pptx/odt/ods) walks the
 * chain straight to `refuse` and throws, per the manifest's terminal step.
 */
import { degradationChain, probeInstall } from './sidecar-providers.mjs';

const NODE_NATIVE_EXTS = new Set(['.pdf', '.docx']);

function degradedResult(extracted, { chainStep, reason }) {
  return {
    ...extracted,
    degraded: true,
    degradationStep: chainStep,
    droppedInfo: [
      ...(extracted.droppedInfo ?? []),
      {
        kind: 'ingestion-provider-degraded',
        count: 1,
        reason,
        recoverable: true,
      },
    ],
  };
}

/**
 * extractWithChain(filePath, opts) — run docling extraction governed by the
 * docling manifest's declared degradation chain.
 *
 * @param {object} opts
 * @param {string} opts.extension lowercased file extension (drives node-native eligibility)
 * @param {Function} opts.doclingExtract async (filePath) => extraction result; throws on failure
 * @param {Function} [opts.nodeNativeExtract] async (filePath) => extraction result; throws on failure
 * @param {Function} [opts.installProbeImpl] injectable probeInstall (fake probes for tests)
 * @param {boolean} [opts.skipInstallProbe] when true, always attempts doclingExtract
 *        regardless of the install probe (used when the caller already knows
 *        docling ran, e.g. contract-test doubles)
 * @returns {Promise<object>} extraction result; `degraded: true` when the chain fell through
 */
export async function extractWithChain(filePath, {
  extension,
  doclingExtract,
  nodeNativeExtract = null,
  installProbeImpl = probeInstall,
  skipInstallProbe = false,
} = {}) {
  const chain = degradationChain('docling');
  if (!chain) {
    throw new Error('docling ingestion-provider manifest is missing or has no degradation chain declared');
  }

  const installed = skipInstallProbe || installProbeImpl('docling').installed;
  if (installed) {
    try {
      const extracted = await doclingExtract(filePath);
      return { ...extracted, degraded: false, degradationStep: 'docling' };
    } catch (err) {
      return fallToNodeNative(filePath, { extension, nodeNativeExtract, reason: `docling extraction failed: ${err.message}` });
    }
  }

  return fallToNodeNative(filePath, { extension, nodeNativeExtract, reason: 'docling is not installed' });
}

async function fallToNodeNative(filePath, { extension, nodeNativeExtract, reason }) {
  const nodeNativeEligible = NODE_NATIVE_EXTS.has(extension) && typeof nodeNativeExtract === 'function';
  if (!nodeNativeEligible) {
    const err = new Error(
      `${reason}; no node-native fallback covers '${extension}' — refusing per the docling degradation chain. ` +
      'Run `construct provider test docling` for diagnosis, or `construct install --with-docling`.',
    );
    err.code = 'INGESTION_PROVIDER_REFUSED';
    err.chainStep = 'refuse';
    throw err;
  }

  try {
    const extracted = await nodeNativeExtract(filePath);
    return degradedResult(extracted, { chainStep: 'node-native', reason: `${reason}; used the node-native extractor (${extracted.extractionMethod}).` });
  } catch (err) {
    const refuseErr = new Error(`${reason}; node-native fallback also failed: ${err.message} — refusing.`);
    refuseErr.code = 'INGESTION_PROVIDER_REFUSED';
    refuseErr.chainStep = 'refuse';
    refuseErr.cause = err;
    throw refuseErr;
  }
}
