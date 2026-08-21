/**
 * kernel/extract/ladder.ts — quality-aware extraction tier selection.
 *
 * Ported from the predecessor's extraction ladder; the exact v2 source path is
 * cited in scripts/capture-legacy-ladder-golden.mjs. This is the one module in
 * the harvest that could not be transcribed, so it is worth saying plainly what
 * changed and why.
 *
 * v2's ladder was one async function that interleaved decisions with effects:
 * it stat'd the file, read process.env and process.platform, shelled out to
 * `unzip` to peek inside a DOCX, probed for a Docling install, dynamically
 * imported the email extractor, and awaited each provider — deciding the next
 * rung from what came back. That is untestable without a real Docling venv, and
 * it is why v2's own coverage here leaned on injected extractor functions.
 *
 * The port splits the two halves. The kernel PLANS: given routing signals, it
 * returns the ordered rungs to attempt, the rule for accepting each rung's
 * output, and what to report if every rung is exhausted. The host EXECUTES:
 * probing, spawning, reading files, calling providers. Every decision v2 made
 * is still made here; none of the effects are. Probe results that v2 gathered
 * inline (is Docling installed, does this DOCX contain a table) become declared
 * inputs, which is what makes the decision layer testable at all.
 *
 * One deliberate behavior change, flagged rather than hidden: v2 THREW for an
 * audio/video file with no ASR available. A planner cannot throw a routing
 * decision — so an unavailable requirement is returned as an `unavailable`
 * outcome carrying v2's code, message, and extension. A host that wants v2's
 * exception raises it from that outcome. The information is identical; only who
 * decides to throw has moved.
 */

import {
  AUDIO_VIDEO_EXTS,
  CALENDAR_EXTS,
  DIAGRAM_EXTS,
  DOCLING_LADDER_FORMATS,
  EMAIL_DOCUMENT_EXTS,
  EXTRACTABLE_DOCUMENT_EXTS,
  IMAGE_DOCUMENT_EXTS,
  MDLS_DOCUMENT_EXTS,
  OFFICE_REQUIRES_DOCLING_EXTS,
  RICH_TEXT_EXTS,
  TRANSCRIPT_EXTS,
  UTF8_TEXT_EXTS,
} from './formats.ts';

export const EXTRACTION_TIERS = [
  'native-structured',
  'lightweight-parser',
  'docling-local',
  'docling-remote',
  'unsupported',
] as const;

export type ExtractionTier = (typeof EXTRACTION_TIERS)[number];

export type PrivacyPosture = 'local-only' | 'remote-allowed';

/**
 * How to judge a rung's output. v2 made these decisions inline, right after
 * each await; naming them lets the host ask the kernel instead of reimplementing
 * the rule.
 *
 *   always            take the output if the provider returned anything
 *   digital-text-pdf  accept only if isDigitalTextPdf() passes, else escalate
 *   docx-lightweight  accept only if there is text AND no structure signal
 *                     forces an escalation at the requested fidelity
 */
export type AcceptRule = 'always' | 'digital-text-pdf' | 'docx-lightweight';

export interface PlanStep {
  readonly tier: ExtractionTier;
  /** The provider the host should call for this rung. */
  readonly provider:
    | 'sync'
    | 'email'
    | 'whisper'
    | 'unpdf'
    | 'mammoth'
    | 'docling-local'
    | 'docling-remote';
  readonly accept: AcceptRule;
  /** The extractionMethod to record when this rung succeeds, when v2 pinned one. */
  readonly method?: string;
}

export interface Exhaustion {
  readonly reason: string;
  /**
   * v2's PDF rung reported a different reason depending on whether the
   * lightweight parser RETURNED anything — note that a result whose text is
   * empty still counts as returning, and selects this reason. "No usable text"
   * and "text too sparse to trust" are different diagnoses for the reader.
   */
  readonly reasonWhenLightweightReturned?: string;
  readonly remediation: string;
}

export interface Unavailable {
  readonly code: string;
  readonly message: string;
  readonly extension: string;
}

export interface ExtractionPlan {
  readonly extension: string;
  /** Rungs to attempt in order. Empty means nothing can be tried. */
  readonly steps: readonly PlanStep[];
  /** Reported when every step is exhausted (or when there are none). */
  readonly exhausted: Exhaustion | null;
  /**
   * A hard requirement the environment does not meet. v2 threw here; a host
   * that wants that behavior throws from this. Null when the plan is runnable.
   */
  readonly unavailable: Unavailable | null;
}

export interface RoutingSignals {
  readonly format: string;
  readonly requestedFidelity: 'high' | 'fast';
  readonly needsLayoutPreservation: boolean;
  readonly privacyPosture: PrivacyPosture;
  readonly doclingLocalAvailable: boolean;
  readonly doclingRemoteAvailable: boolean;
}

export interface PlanInput {
  /** Lowercased file extension including the dot, e.g. '.pdf'. */
  readonly extension: string;
  readonly highFidelity?: boolean;
  readonly privacyPosture?: PrivacyPosture;
  /** Whether a local Docling install was found. Probing is the host's job. */
  readonly doclingLocalAvailable?: boolean;
  /** Whether a remote Docling Serve endpoint is configured AND reachable. */
  readonly doclingServeConfigured?: boolean;
  /** Whether the host can read plain/native formats itself. */
  readonly syncExtractAvailable?: boolean;
  /** Whether an ASR backend is available for audio/video. */
  readonly whisperAvailable?: boolean;
  /** v2 read process.platform; the mdls rung is macOS-only. */
  readonly platform?: string;
}

const REMEDIATION_DOCLING =
  'Install Docling so `docling --version` answers on PATH (pip install docling), or set DOCLING_SERVE_URL with CONSTRUCT_EXTRACTION_PRIVACY=remote-ok.';

/**
 * Derive the routing signals for a file. Pure: everything v2 sniffed from the
 * environment arrives as an argument.
 *
 * A remote Docling rung requires BOTH a configured endpoint and a privacy
 * posture that permits leaving the machine — v2 folded that check in here, and
 * it stays here so no caller can accidentally route a local-only document to a
 * remote service by reading only one of the two flags.
 */
export function resolveRoutingSignals(input: PlanInput): RoutingSignals {
  const extension = String(input.extension ?? '').toLowerCase();
  const highFidelity = input.highFidelity ?? true;
  const posture: PrivacyPosture = input.privacyPosture ?? 'local-only';
  return {
    format: extension,
    requestedFidelity: highFidelity ? 'high' : 'fast',
    needsLayoutPreservation: highFidelity && DOCLING_LADDER_FORMATS.has(extension),
    privacyPosture: posture,
    doclingLocalAvailable: input.doclingLocalAvailable ?? false,
    doclingRemoteAvailable: posture === 'remote-allowed' && (input.doclingServeConfigured ?? false),
  };
}

function doclingSteps(signals: RoutingSignals): PlanStep[] {
  const steps: PlanStep[] = [];
  if (signals.doclingLocalAvailable) {
    steps.push({
      tier: 'docling-local',
      provider: 'docling-local',
      accept: 'always',
      method: 'docling',
    });
  }
  if (signals.doclingRemoteAvailable) {
    steps.push({
      tier: 'docling-remote',
      provider: 'docling-remote',
      accept: 'always',
      method: 'docling-remote',
    });
  }
  return steps;
}

function unsupported(extension: string, exhausted: Exhaustion): ExtractionPlan {
  return { extension, steps: [], exhausted, unavailable: null };
}

/**
 * Is this a format the host reads natively, without any parser rung?
 *
 * `.doc` is excluded despite being a rich-text extension — it is a binary
 * format that needs Docling, and v2 carved it out here for exactly that reason.
 * The mdls formats are macOS-only; elsewhere they fall through to the host's
 * generic reader, which is v2's behavior and not obviously intentional, but it
 * is behavior, so it is preserved.
 */
function isNativeFormat(extension: string, platform: string): boolean {
  return (
    UTF8_TEXT_EXTS.has(extension) ||
    TRANSCRIPT_EXTS.has(extension) ||
    CALENDAR_EXTS.has(extension) ||
    (RICH_TEXT_EXTS.has(extension) && extension !== '.doc') ||
    (MDLS_DOCUMENT_EXTS.has(extension) && platform === 'darwin')
  );
}

/**
 * Plan the extraction ladder for one file. Pure and total: it always returns a
 * plan, never throws, and never touches the filesystem, env, or a subprocess.
 */
export function planExtraction(input: PlanInput): ExtractionPlan {
  const extension = String(input.extension ?? '').toLowerCase();
  const highFidelity = input.highFidelity ?? true;
  const platform = input.platform ?? 'linux';
  const signals = resolveRoutingSignals({ ...input, extension, highFidelity });
  const docling = doclingSteps(signals);

  if (DIAGRAM_EXTS.has(extension)) {
    return unsupported(extension, {
      reason:
        `You asked to extract ${extension} — a diagram/vector format. No rung reads it: ` +
        'there is no lightweight parser for vector diagrams, and Docling extracts document ' +
        'and image content, not vector graphics, so installing it would not help either.',
      remediation:
        'Describe the diagram in prose yourself, or export a rendered raster (PNG) so an ' +
        'image-capable rung — Docling OCR, once installed — has pixels to read instead of vectors.',
    });
  }

  if (!EXTRACTABLE_DOCUMENT_EXTS.has(extension)) {
    return unsupported(extension, {
      reason: `Unsupported document type: ${extension || 'unknown'}`,
      remediation:
        'Convert the file to a supported format (PDF, DOCX, plain text, or email) before ingest.',
    });
  }

  if (AUDIO_VIDEO_EXTS.has(extension)) {
    if (!input.whisperAvailable) {
      return {
        extension,
        steps: [],
        exhausted: null,
        unavailable: {
          code: 'ASR_REQUIRED',
          message:
            'Audio/video extraction requires ASR. Install a local whisper ASR (brew install whisper-cpp).',
          extension,
        },
      };
    }
    return {
      extension,
      steps: [
        { tier: 'native-structured', provider: 'whisper', accept: 'always', method: 'whisper' },
      ],
      exhausted: null,
      unavailable: null,
    };
  }

  if (EMAIL_DOCUMENT_EXTS.has(extension)) {
    return {
      extension,
      steps: [{ tier: 'native-structured', provider: 'email', accept: 'always' }],
      exhausted: null,
      unavailable: null,
    };
  }

  if (isNativeFormat(extension, platform) && input.syncExtractAvailable) {
    return {
      extension,
      steps: [{ tier: 'native-structured', provider: 'sync', accept: 'always' }],
      exhausted: null,
      unavailable: null,
    };
  }

  if (extension === '.pdf') {
    return {
      extension,
      steps: [
        { tier: 'lightweight-parser', provider: 'unpdf', accept: 'digital-text-pdf', method: 'unpdf' },
        ...docling,
      ],
      exhausted: {
        reason: 'PDF extraction requires unpdf or Docling; neither produced usable text.',
        reasonWhenLightweightReturned:
          'PDF text density below calibrated corpus threshold suggests scanned or image-heavy content; Docling is unavailable.',
        remediation:
          'Install Docling for local OCR so `docling --version` answers on PATH (pip install docling), set DOCLING_SERVE_URL with CONSTRUCT_EXTRACTION_PRIVACY=remote-ok for shared Docling Serve, or transcribe manually.',
      },
      unavailable: null,
    };
  }

  if (extension === '.docx') {
    return {
      extension,
      steps: [
        {
          tier: 'lightweight-parser',
          provider: 'mammoth',
          accept: 'docx-lightweight',
          method: 'mammoth',
        },
        ...docling,
      ],
      exhausted: {
        reason: 'DOCX extraction requires mammoth or Docling; neither produced usable text.',
        remediation:
          'Install Docling so `docling --version` answers on PATH (pip install docling), ensure mammoth is installed, or convert the document manually.',
      },
      unavailable: null,
    };
  }

  if (
    OFFICE_REQUIRES_DOCLING_EXTS.has(extension) ||
    IMAGE_DOCUMENT_EXTS.has(extension) ||
    extension === '.doc'
  ) {
    return {
      extension,
      steps: docling,
      exhausted: {
        reason: `${extension} has no lightweight parser; Docling is unavailable.`,
        remediation: REMEDIATION_DOCLING,
      },
      unavailable: null,
    };
  }

  if (input.syncExtractAvailable) {
    return {
      extension,
      steps: [{ tier: 'native-structured', provider: 'sync', accept: 'always' }],
      exhausted: null,
      unavailable: null,
    };
  }

  return unsupported(extension, {
    reason: `No extraction tier matched for ${extension || 'unknown'}.`,
    remediation: 'Verify the file type is supported and required backends are installed.',
  });
}

/**
 * Pick the exhaustion reason once the host knows whether the lightweight rung
 * returned a result — the one piece of v2's reporting that depended on an
 * outcome rather than on the routing signals.
 */
export function resolveExhaustion(
  plan: ExtractionPlan,
  context: { lightweightReturnedResult?: boolean } = {},
): Exhaustion | null {
  const exhausted = plan.exhausted;
  if (!exhausted) return null;
  if (context.lightweightReturnedResult && exhausted.reasonWhenLightweightReturned) {
    return { ...exhausted, reason: exhausted.reasonWhenLightweightReturned };
  }
  return exhausted;
}

export interface UnsupportedResult {
  readonly filePath: string;
  readonly extension: string;
  readonly extractionMethod: 'unsupported';
  readonly routingTier: 'unsupported';
  readonly unsupported: true;
  readonly manualRecovery: true;
  readonly text: '';
  readonly characters: 0;
  readonly truncated: false;
  readonly droppedInfo: readonly {
    kind: string;
    count: number;
    reason: string;
    recoverable: boolean;
  }[];
  readonly remediation: string;
  readonly structured: null;
}

/** Build the envelope a caller gets when no rung could produce text. */
export function makeUnsupportedResult(
  filePath: string,
  extension: string,
  exhausted: Exhaustion,
): UnsupportedResult {
  return {
    filePath,
    extension,
    extractionMethod: 'unsupported',
    routingTier: 'unsupported',
    unsupported: true,
    manualRecovery: true,
    text: '',
    characters: 0,
    truncated: false,
    droppedInfo: [
      { kind: 'unsupported-format', count: 1, reason: exhausted.reason, recoverable: true },
    ],
    remediation: exhausted.remediation,
    structured: null,
  };
}
