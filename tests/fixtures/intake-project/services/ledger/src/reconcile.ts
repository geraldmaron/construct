import type { Posting } from './entries.ts';

/** Accounts whose debits and credits do not net to zero. */
export function unbalancedAccounts(postings: readonly Posting[]): string[] {
  const net = new Map<string, number>();
  for (const p of postings) {
    net.set(p.debit, (net.get(p.debit) ?? 0) - p.amountMinor);
    net.set(p.credit, (net.get(p.credit) ?? 0) + p.amountMinor);
  }
  return [...net].filter(([, v]) => v !== 0).map(([k]) => k);
}
