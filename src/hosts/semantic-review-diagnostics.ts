import { StringDecoder } from 'node:string_decoder';

/** Bounded operational classification only. Raw stderr never leaves memory. */
export function createReviewDiagnostics() {
  const decoder = new StringDecoder('utf8');
  let prefix = '',
    bytes = 0;
  return {
    write(data: Buffer) {
      prefix += decoder.write(data.subarray(0, Math.max(0, 8192 - bytes)));
      bytes += data.length;
    },
    failureObservation() {
      if (!bytes) return null;
      const categories = [
        ['input_capacity', /input_too_large|input exceeds.{0,40}(?:length|characters)/i],
        [
          'context_capacity',
          /context.{0,40}(?:window|length|limit|exceed)|too many (?:input )?tokens|(?:input|prompt).{0,30}(?:too long|too large)/i,
        ],
        ['authentication', /unauthori[sz]ed|authentication|not logged in|\b401\b|\b403\b/i],
        ['rate_limit', /rate.?limit|\b429\b/i],
        ['quota', /quota|billing|insufficient.credit/i],
        ['model_unavailable', /model.{0,40}(?:not found|not supported|unavailable|does not exist)/i],
        [
          'configuration',
          /unknown (?:option|argument)|unrecognized|invalid.{0,20}(?:config|option|argument)|failed to (?:load|parse).{0,20}config/i,
        ],
        ['transport', /connection|stream.{0,30}(?:disconnect|closed|error)|network|request.{0,30}(?:failed|timeout)|\b50[234]\b/i],
        ['permission', /permission denied|operation not permitted|\bEACCES\b|\bEPERM\b/i],
      ] as const;
      const category = categories.find(([, pattern]) => pattern.test(prefix))?.[0] ?? 'unknown';
      return { type: 'native.stderr_diagnostic' as const, category, truncated: bytes > 8192 };
    },
  };
}
