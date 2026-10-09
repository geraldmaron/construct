export interface Money {
  readonly amountMinor: number;
  readonly currency: string;
}

export function sameCurrency(a: Money, b: Money): boolean {
  return a.currency === b.currency;
}
