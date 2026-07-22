/**
 * lib/document-extract/extraction-result-contract.mjs — Wave-1 extraction provider result contract.
 *
 * Validates the shared extractor envelope ({ text, extractionMethod, characters,
 * truncated, droppedInfo, ... }) consumed by ingest, the extraction ladder, and
 * certification gates (construct-tsyfe.2.1, construct-tsyfe.2.5, construct-tsyfe.2.11).
 */

function isNonEmptyString(value) {
  return typeof value === 'string' && value.length > 0;
}

function validateDroppedInfoEntry(entry, index) {
  const errors = [];
  if (!entry || typeof entry !== 'object') {
    errors.push(`droppedInfo[${index}] must be an object`);
    return errors;
  }
  if (!isNonEmptyString(entry.kind ?? entry.type)) {
    errors.push(`droppedInfo[${index}] missing kind/type`);
  }
  if (entry.count != null && !Number.isFinite(Number(entry.count))) {
    errors.push(`droppedInfo[${index}].count must be a number when present`);
  }
  if (typeof entry.recoverable !== 'boolean' && entry.recoverable != null) {
    errors.push(`droppedInfo[${index}].recoverable must be boolean when present`);
  }
  return errors;
}

/**
 * @param {object|null|undefined} result
 * @returns {{ ok: boolean, errors: string[] }}
 */
export function validateExtractionProviderResult(result) {
  const errors = [];
  if (!result || typeof result !== 'object') {
    return { ok: false, errors: ['result must be an object'] };
  }

  if (typeof result.text !== 'string') errors.push('text must be a string');
  if (!isNonEmptyString(result.extractionMethod)) errors.push('extractionMethod must be a non-empty string');
  if (!Number.isFinite(Number(result.characters))) errors.push('characters must be a number');
  if (typeof result.truncated !== 'boolean') errors.push('truncated must be a boolean');

  if (result.droppedInfo != null) {
    if (!Array.isArray(result.droppedInfo)) {
      errors.push('droppedInfo must be an array when present');
    } else {
      for (let i = 0; i < result.droppedInfo.length; i += 1) {
        errors.push(...validateDroppedInfoEntry(result.droppedInfo[i], i));
      }
    }
  }

  if (result.structured != null && typeof result.structured !== 'object') {
    errors.push('structured must be an object when present');
  }

  return { ok: errors.length === 0, errors };
}
