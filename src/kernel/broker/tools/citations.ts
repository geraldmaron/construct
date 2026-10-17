import { list, record, ToolInputError } from '../definition.ts';
import { redact } from '../../render/redact.ts';

/** One citation contract for answers and managed submissions. Malformed excerpts
 * must not silently disappear and bypass quote validation. */
export const CITATION_ITEM = {
  type: 'object',
  properties: {
    ref: { type: 'string', description: 'Recorded item ref, source-qualified ref, file or complete HTTP(S) link.' },
    excerpt: { type: 'string', description: 'Optional exact readable passage; never a structured provider object.' },
  },
  required: ['ref'],
} as const;

export function citationsInput(raw: Record<string, unknown>, key: string): { ref: string; excerpt?: string }[] {
  return list(raw, key).map((entry, n) => {
    const item = record(entry);
    if (item.excerpt !== undefined && item.excerpt !== null && typeof item.excerpt !== 'string') {
      throw new ToolInputError(`${key}[${String(n)}].excerpt must be a readable string; extract the observed passage before citing it`, {
        field: `${key}[${String(n)}].excerpt`,
      });
    }
    return {
      ref: typeof item.ref === 'string' ? item.ref : '',
      ...(typeof item.excerpt === 'string' ? { excerpt: redact(item.excerpt) } : {}),
    };
  });
}
