export interface Posting {
  readonly debit: string;
  readonly credit: string;
  readonly amountMinor: number;
  readonly currency: string;
}

export function balanced(postings: readonly Posting[]): boolean {
  return postings.every((p) => p.amountMinor > 0 && p.debit !== p.credit);
}
