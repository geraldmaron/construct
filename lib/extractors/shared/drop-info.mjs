/**
 * lib/extractors/shared/drop-info.mjs — shared drop-info factory and envelope builder.
 *
 * Every extractor returns the same { text, structured, droppedInfo } envelope so
 * callers can always read droppedInfo[] without format-specific branching. An empty
 * droppedInfo array means nothing was silently dropped, not that nothing was structured.
 *
 * Valid `kind` values mirror the MIME world: 'attachment', 'inline-image', 'table',
 * 'formula', 'comment', 'html-part', 'animation', 'speaker-notes', 'scanned-pdf'.
 */

export function makeDropInfo({ kind, count, reason, recoverable = false }) {
  return { kind, count, reason, recoverable };
}

/**
 * Wrap extraction results in the universal envelope.
 * Callers that produce no structured data pass `structured: null` (the default).
 */
export function makeEnvelope({ text = '', structured = null, droppedInfo = [] } = {}) {
  return { text, structured, droppedInfo };
}
