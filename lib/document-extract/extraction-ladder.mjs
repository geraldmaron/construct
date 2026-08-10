/**
 * lib/document-extract/extraction-ladder.mjs — quality-aware extraction tier selection.
 *
 * Replaces extension-only dispatch with a ladder evaluated against routing signals
 * (format, requested fidelity, text yield, privacy posture, provider availability).
 * Tiers: native-structured -> lightweight-parser (unpdf/mammoth) -> docling-local ->
 * docling-remote (privacy-permitting) -> explicit unsupported/manual-recovery.
 *
 * Digital-vs-scanned PDF routing uses unpdf text-layer presence (empty yield implies
 * scanned/image content). Multi-page density uses the docling sidecar's 50 chars/page
 * heuristic until document-corpus-pdf-docx-benchmark lands calibrated numbers.
 */

import { extname, resolve } from 'node:path';
import { existsSync } from 'node:fs';
import { execFileSync } from 'node:child_process';

import { makeDropInfo } from '../extractors/shared/drop-info.mjs';
import { resolveDoclingServeUrl } from '../ingest/docling-remote.mjs';
import { probeInstall } from '../ingest/sidecar-providers.mjs';
import { isDigitalTextPdf, ROUTING_THRESHOLDS } from './routing-thresholds.mjs';
import {
  UTF8_TEXT_EXTS,
  TRANSCRIPT_EXTS,
  CALENDAR_EXTS,
  AUDIO_VIDEO_EXTS,
  RICH_TEXT_EXTS,
  MDLS_DOCUMENT_EXTS,
  EMAIL_DOCUMENT_EXTS,
  IMAGE_DOCUMENT_EXTS,
  EXTRACTABLE_DOCUMENT_EXTS,
  OFFICE_REQUIRES_DOCLING_EXTS,
  DOCLING_LADDER_FORMATS,
} from './formats.mjs';
import { extractPdfWithUnpdf, unpdfAvailable } from './providers/unpdf-provider.mjs';
import { extractDocxWithMammoth, mammothAvailable } from './providers/mammoth-provider.mjs';

export { isDigitalTextPdf } from './routing-thresholds.mjs';

export const EXTRACTION_TIERS = Object.freeze([
  'native-structured',
  'lightweight-parser',
  'docling-local',
  'docling-remote',
  'unsupported',
]);

/**
 * Surface routing signals for ingest strategy resolution and ladder evaluation.
 *
 * @param {object} opts
 * @param {string} opts.filePath
 * @param {Record<string,string>} [opts.env]
 * @param {boolean} [opts.highFidelity]
 * @param {string} [opts.privacyPosture]  'local-only' | 'remote-allowed'
 * @returns {object}
 */
export function resolveExtractionRoutingSignals({
  filePath,
  env = process.env,
  highFidelity = true,
  privacyPosture = null,
} = {}) {
  const extension = extname(filePath).toLowerCase();
  const posture = privacyPosture
    || (String(env.CONSTRUCT_EXTRACTION_PRIVACY || '').trim().toLowerCase() === 'remote-ok'
      ? 'remote-allowed'
      : 'local-only');

  return {
    format: extension,
    requestedFidelity: highFidelity ? 'high' : 'fast',
    needsLayoutPreservation: highFidelity && DOCLING_LADDER_FORMATS.has(extension),
    privacyPosture: posture,
    doclingLocalAvailable: probeInstall('docling').installed,
    doclingRemoteAvailable: posture === 'remote-allowed' && !!resolveDoclingServeUrl(env),
    lightweightPdfAvailable: null,
    lightweightDocxAvailable: null,
    priorFailure: null,
  };
}

export function makeUnsupportedExtractionResult(resolvedPath, extension, { reason, remediation }) {
  return {
    filePath: resolvedPath,
    extension,
    extractionMethod: 'unsupported',
    routingTier: 'unsupported',
    unsupported: true,
    manualRecovery: true,
    text: '',
    characters: 0,
    truncated: false,
    droppedInfo: [
      makeDropInfo({
        kind: 'unsupported-format',
        count: 1,
        reason,
        recoverable: true,
      }),
    ],
    remediation,
    structured: null,
  };
}

function finalizeLadderResult(resolvedPath, extension, extracted, routingTier, maxChars) {
  const text = extracted.markdown ?? extracted.text ?? '';
  const limit = Number.isFinite(Number(maxChars)) && Number(maxChars) > 0
    ? Math.min(Number(maxChars), 200_000)
    : null;
  const truncated = limit !== null && text.length > limit;
  return {
    filePath: resolvedPath,
    extension,
    extractionMethod: extracted.extractionMethod ?? extracted.method ?? routingTier,
    routingTier,
    text: truncated ? `${text.slice(0, limit)}\n` : text,
    markdown: extracted.markdown ?? null,
    metadata: extracted.metadata ?? null,
    truncated,
    characters: text.length,
    droppedInfo: extracted.droppedInfo ?? [],
    structured: extracted.structured ?? null,
    providerRepresentation: extracted.providerRepresentation ?? null,
    attachments: extracted.attachments ?? undefined,
    attachmentProvenance: extracted.attachmentProvenance ?? undefined,
    skipped: extracted.skipped ?? undefined,
    unsupported: false,
    manualRecovery: false,
  };
}

async function runDoclingLocal(resolvedPath, { doclingExtract }) {
  const out = await doclingExtract(resolvedPath);
  return {
    ...out,
    extractionMethod: out.extractionMethod || 'docling',
  };
}

async function runDoclingRemote(resolvedPath, { doclingRemoteExtract, maxChars, env }) {
  const out = await doclingRemoteExtract({ filePath: resolvedPath, maxChars, env });
  return {
    ...out,
    extractionMethod: out.extractionMethod || 'docling-remote',
  };
}

async function tryLightweightPdf(resolvedPath, { lightweightExtract }) {
  if (typeof lightweightExtract === 'function') {
    return lightweightExtract(resolvedPath);
  }
  if (!(await unpdfAvailable())) return null;
  return extractPdfWithUnpdf(resolvedPath);
}

async function tryLightweightDocx(resolvedPath, { lightweightDocxExtract }) {
  if (typeof lightweightDocxExtract === 'function') {
    return lightweightDocxExtract(resolvedPath);
  }
  if (!(await mammothAvailable())) return null;
  return extractDocxWithMammoth(resolvedPath);
}

function probeDocxStructureSignals(docxPath) {
  try {
    const xml = execFileSync('unzip', ['-p', docxPath, 'word/document.xml'], { encoding: 'utf8' });
    return {
      hasTable: /<w:tbl\b/.test(xml),
      hasEmbeddedImage: /<w:drawing\b|<pic:pic\b|<a:blip\b/.test(xml),
    };
  } catch {
    return { hasTable: false, hasEmbeddedImage: false };
  }
}

function docxRequiresDoclingEscalation(docxPath, { highFidelity = true } = {}) {
  if (!highFidelity) return false;
  const structure = probeDocxStructureSignals(docxPath);
  return ROUTING_THRESHOLDS.docx.escalateToDoclingWhenHighFidelityAnd
    .some((signal) => Boolean(structure[signal]));
}

/**
 * Run the quality-aware extraction ladder for one file.
 *
 * Injectable extractors keep functional tests hermetic (no real docling venv).
 *
 * @param {string} filePath
 * @param {object} [opts]
 * @param {number} [opts.maxChars]
 * @param {boolean} [opts.highFidelity]
 * @param {Record<string,string>} [opts.env]
 * @param {Function} [opts.syncExtract] sync path for native-structured formats
 * @param {Function} [opts.doclingExtract]
 * @param {Function} [opts.doclingRemoteExtract]
 * @param {Function} [opts.whisperExtract]
 * @param {Function} [opts.lightweightExtract] injectable unpdf probe
 * @param {Function} [opts.lightweightDocxExtract] injectable mammoth probe
 * @returns {Promise<object>}
 */
export async function extractViaExtractionLadder(filePath, {
  maxChars = null,
  highFidelity = true,
  env = process.env,
  syncExtract = null,
  doclingExtract = null,
  doclingRemoteExtract = null,
  whisperExtract = null,
  lightweightExtract = null,
  lightweightDocxExtract = null,
  installProbeImpl = probeInstall,
  forceDoclingLocal = false,
} = {}) {
  const resolvedPath = resolve(filePath);
  if (!existsSync(resolvedPath)) throw new Error(`File not found: ${resolvedPath}`);

  const extension = extname(resolvedPath).toLowerCase();
  if (!EXTRACTABLE_DOCUMENT_EXTS.has(extension)) {
    return makeUnsupportedExtractionResult(resolvedPath, extension, {
      reason: `Unsupported document type: ${extension || 'unknown'}`,
      remediation: 'Convert the file to a supported format (PDF, DOCX, plain text, or email) before ingest.',
    });
  }

  const signals = resolveExtractionRoutingSignals({ filePath: resolvedPath, env, highFidelity });
  const doclingLocalReady = forceDoclingLocal
    || signals.doclingLocalAvailable
    || typeof doclingExtract === 'function';

  if (AUDIO_VIDEO_EXTS.has(extension)) {
    if (typeof whisperExtract !== 'function') {
      const err = new Error(
        'Audio/video extraction requires ASR. Install a local whisper ASR (brew install whisper-cpp).',
      );
      err.code = 'ASR_REQUIRED';
      err.extension = extension;
      throw err;
    }
    const out = await whisperExtract(resolvedPath);
    return finalizeLadderResult(resolvedPath, extension, { ...out, extractionMethod: 'whisper' }, 'native-structured', maxChars);
  }

  if (EMAIL_DOCUMENT_EXTS.has(extension)) {
    const { extractEmlAsync: extractEmail } = await import('./email-extract.mjs');
    const extracted = await extractEmail(resolvedPath);
    return finalizeLadderResult(resolvedPath, extension, extracted, 'native-structured', maxChars);
  }

  const nativeFormats = UTF8_TEXT_EXTS.has(extension)
    || TRANSCRIPT_EXTS.has(extension)
    || CALENDAR_EXTS.has(extension)
    || (RICH_TEXT_EXTS.has(extension) && extension !== '.doc')
    || (MDLS_DOCUMENT_EXTS.has(extension) && process.platform === 'darwin');

  if (nativeFormats && typeof syncExtract === 'function') {
    const syncResult = syncExtract(resolvedPath, { maxChars });
    return {
      ...syncResult,
      routingTier: 'native-structured',
      unsupported: false,
      manualRecovery: false,
    };
  }

  if (extension === '.pdf') {
    let lightweight = null;
    try {
      lightweight = await tryLightweightPdf(resolvedPath, { lightweightExtract });
    } catch {
      lightweight = null;
    }

    if (lightweight && isDigitalTextPdf(lightweight)) {
      return finalizeLadderResult(
        resolvedPath,
        extension,
        { text: lightweight.text, extractionMethod: 'unpdf', droppedInfo: [] },
        'lightweight-parser',
        maxChars,
      );
    }

    if (doclingLocalReady && typeof doclingExtract === 'function') {
      try {
        const out = await runDoclingLocal(resolvedPath, { doclingExtract });
        return finalizeLadderResult(resolvedPath, extension, out, 'docling-local', maxChars);
      } catch { /* fall through */ }
    }

    if (signals.doclingRemoteAvailable && typeof doclingRemoteExtract === 'function') {
      try {
        const out = await runDoclingRemote(resolvedPath, { doclingRemoteExtract, maxChars, env });
        return finalizeLadderResult(resolvedPath, extension, out, 'docling-remote', maxChars);
      } catch { /* fall through */ }
    }

    return makeUnsupportedExtractionResult(resolvedPath, extension, {
      reason: lightweight
        ? 'PDF text density below calibrated corpus threshold suggests scanned or image-heavy content; Docling is unavailable.'
        : 'PDF extraction requires unpdf or Docling; neither produced usable text.',
      remediation: 'Run `construct install --with-docling` for local OCR, set DOCLING_SERVE_URL with CONSTRUCT_EXTRACTION_PRIVACY=remote-ok for shared Docling Serve, or transcribe manually.',
    });
  }

  if (extension === '.docx') {
    let lightweight = null;
    try {
      lightweight = await tryLightweightDocx(resolvedPath, { lightweightDocxExtract });
    } catch {
      lightweight = null;
    }

    if (lightweight?.text && !docxRequiresDoclingEscalation(resolvedPath, { highFidelity })) {
      return finalizeLadderResult(
        resolvedPath,
        extension,
        { text: lightweight.text, extractionMethod: 'mammoth', droppedInfo: [] },
        'lightweight-parser',
        maxChars,
      );
    }

    if (doclingLocalReady && typeof doclingExtract === 'function') {
      try {
        const out = await runDoclingLocal(resolvedPath, { doclingExtract });
        return finalizeLadderResult(resolvedPath, extension, out, 'docling-local', maxChars);
      } catch { /* fall through */ }
    }

    if (signals.doclingRemoteAvailable && typeof doclingRemoteExtract === 'function') {
      try {
        const out = await runDoclingRemote(resolvedPath, { doclingRemoteExtract, maxChars, env });
        return finalizeLadderResult(resolvedPath, extension, out, 'docling-remote', maxChars);
      } catch { /* fall through */ }
    }

    return makeUnsupportedExtractionResult(resolvedPath, extension, {
      reason: 'DOCX extraction requires mammoth or Docling; neither produced usable text.',
      remediation: 'Run `construct install --with-docling`, ensure mammoth is installed, or convert the document manually.',
    });
  }

  if (OFFICE_REQUIRES_DOCLING_EXTS.has(extension) || IMAGE_DOCUMENT_EXTS.has(extension) || extension === '.doc') {
    if (doclingLocalReady && typeof doclingExtract === 'function') {
      try {
        const out = await runDoclingLocal(resolvedPath, { doclingExtract });
        return finalizeLadderResult(resolvedPath, extension, out, 'docling-local', maxChars);
      } catch { /* fall through */ }
    }

    if (signals.doclingRemoteAvailable && typeof doclingRemoteExtract === 'function') {
      try {
        const out = await runDoclingRemote(resolvedPath, { doclingRemoteExtract, maxChars, env });
        return finalizeLadderResult(resolvedPath, extension, out, 'docling-remote', maxChars);
      } catch { /* fall through */ }
    }

    return makeUnsupportedExtractionResult(resolvedPath, extension, {
      reason: `${extension} has no lightweight parser; Docling is unavailable.`,
      remediation: 'Run `construct install --with-docling` or set DOCLING_SERVE_URL with CONSTRUCT_EXTRACTION_PRIVACY=remote-ok.',
    });
  }

  if (typeof syncExtract === 'function') {
    const syncResult = syncExtract(resolvedPath, { maxChars });
    return {
      ...syncResult,
      routingTier: 'native-structured',
      unsupported: false,
      manualRecovery: false,
    };
  }

  return makeUnsupportedExtractionResult(resolvedPath, extension, {
    reason: `No extraction tier matched for ${extension || 'unknown'}.`,
    remediation: 'Verify the file type is supported and required backends are installed.',
  });
}
