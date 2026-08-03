/**
 * kernel/verify/claims.ts — tier-1 deterministic no-fabrication check.
 * A load-bearing claim (money amount, percentage, ISO date) in a deliverable
 * must carry a citation marker `[cite:...]` or an explicit `[unverified]` tag
 * on the same line. Runs without a model, so it holds identically on every
 * host and every model family.
 */

export interface UntaggedClaim {
  readonly line: number;
  readonly text: string;
}

const CLAIM = /(\$[\d][\d,.]*|\b\d+(?:\.\d+)?%|\b\d{4}-\d{2}-\d{2}\b)/;
const TAG = /\[(cite:[^\]]+|unverified)\]/i;

export function findUntaggedClaims(text: string): UntaggedClaim[] {
  const findings: UntaggedClaim[] = [];
  const lines = text.split('\n');
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i] ?? '';
    if (CLAIM.test(line) && !TAG.test(line)) {
      findings.push({ line: i + 1, text: line.trim() });
    }
  }
  return findings;
}
