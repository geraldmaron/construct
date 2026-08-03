/**
 * kernel/extract/envelope.ts — the shared extraction-result envelope and its
 * validator. Ported from the predecessor's extraction-result module; the exact
 * v2 source path is cited in scripts/capture-legacy-ladder-golden.mjs.
 *
 * Every extraction provider — lightweight parser, Docling, ASR, the native
 * readers — resolves the same envelope, which is what lets the ladder treat
 * them interchangeably and what ingest downstream relies on.
 *
 * The validator reports rather than throws, and collects every error instead of
 * the first, for the same reason the host seam's does: a provider author should
 * see the whole list in one pass.
 */

export interface DropInfo {
  /** v2 accepted either `kind` or the older `type`; both are still read. */
  readonly kind?: string;
  readonly type?: string;
  readonly count?: number;
  readonly reason?: string;
  readonly recoverable?: boolean;
}

export interface ExtractionResult {
  readonly text: string;
  readonly extractionMethod: string;
  readonly characters: number;
  readonly truncated: boolean;
  readonly droppedInfo?: readonly DropInfo[];
  readonly structured?: unknown;
  readonly markdown?: string | null;
  readonly metadata?: unknown;
}

export interface EnvelopeValidation {
  readonly ok: boolean;
  readonly errors: readonly string[];
}

function isNonEmptyString(value: unknown): boolean {
  return typeof value === 'string' && value.length > 0;
}

function get(value: unknown, key: string): unknown {
  if (!value || typeof value !== 'object') return undefined;
  return (value as Record<string, unknown>)[key];
}

function validateDropInfoEntry(entry: unknown, index: number): string[] {
  const errors: string[] = [];
  if (!entry || typeof entry !== 'object') {
    errors.push(`droppedInfo[${index}] must be an object`);
    return errors;
  }
  if (!isNonEmptyString(get(entry, 'kind') ?? get(entry, 'type'))) {
    errors.push(`droppedInfo[${index}] missing kind/type`);
  }
  const count = get(entry, 'count');
  if (count != null && !Number.isFinite(Number(count))) {
    errors.push(`droppedInfo[${index}].count must be a number when present`);
  }
  const recoverable = get(entry, 'recoverable');
  if (typeof recoverable !== 'boolean' && recoverable != null) {
    errors.push(`droppedInfo[${index}].recoverable must be boolean when present`);
  }
  return errors;
}

export function validateExtractionResult(result: unknown): EnvelopeValidation {
  const errors: string[] = [];
  if (!result || typeof result !== 'object') {
    return { ok: false, errors: ['result must be an object'] };
  }

  if (typeof get(result, 'text') !== 'string') errors.push('text must be a string');
  if (!isNonEmptyString(get(result, 'extractionMethod'))) {
    errors.push('extractionMethod must be a non-empty string');
  }
  if (!Number.isFinite(Number(get(result, 'characters')))) {
    errors.push('characters must be a number');
  }
  if (typeof get(result, 'truncated') !== 'boolean') errors.push('truncated must be a boolean');

  const dropped = get(result, 'droppedInfo');
  if (dropped != null) {
    if (!Array.isArray(dropped)) {
      errors.push('droppedInfo must be an array when present');
    } else {
      for (let i = 0; i < dropped.length; i += 1) {
        errors.push(...validateDropInfoEntry(dropped[i], i));
      }
    }
  }

  const structured = get(result, 'structured');
  if (structured != null && typeof structured !== 'object') {
    errors.push('structured must be an object when present');
  }

  return { ok: errors.length === 0, errors };
}

/** Hard cap on retained text, carried over from v2's finalize step. */
export const MAX_RETAINED_CHARS = 200_000;

export interface FinalizeInput {
  readonly text?: string | null;
  readonly markdown?: string | null;
  readonly extractionMethod?: string | null;
  readonly method?: string | null;
  readonly metadata?: unknown;
  readonly droppedInfo?: readonly DropInfo[];
  readonly structured?: unknown;
  readonly providerRepresentation?: unknown;
  readonly attachments?: unknown;
  readonly attachmentProvenance?: unknown;
  readonly skipped?: unknown;
}

export interface FinalizedResult {
  readonly filePath: string;
  readonly extension: string;
  readonly extractionMethod: string;
  readonly routingTier: string;
  readonly text: string;
  readonly markdown: string | null;
  readonly metadata: unknown;
  readonly truncated: boolean;
  readonly characters: number;
  readonly droppedInfo: readonly DropInfo[];
  readonly structured: unknown;
  readonly providerRepresentation: unknown;
  readonly attachments?: unknown;
  readonly attachmentProvenance?: unknown;
  readonly skipped?: unknown;
  readonly unsupported: false;
  readonly manualRecovery: false;
}

/**
 * Normalize a provider's output into the envelope the ladder returns. Pure.
 *
 * Two behaviors worth naming, both carried over: markdown wins over text when a
 * provider supplies both, and `characters` counts the text BEFORE truncation —
 * so a caller can always tell how much was actually there, not just how much
 * was kept.
 */
export function finalizeResult(
  filePath: string,
  extension: string,
  extracted: FinalizeInput,
  routingTier: string,
  maxChars: number | null = null,
): FinalizedResult {
  const text = extracted.markdown ?? extracted.text ?? '';
  const requested = Number(maxChars);
  const limit =
    Number.isFinite(requested) && requested > 0 ? Math.min(requested, MAX_RETAINED_CHARS) : null;
  const truncated = limit !== null && text.length > limit;
  return {
    filePath,
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
