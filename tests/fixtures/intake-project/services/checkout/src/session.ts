import { totalMinor, type CartLine } from './cart.ts';

export interface CheckoutSession {
  readonly id: string;
  readonly totalMinor: number;
  readonly currency: string;
}

export function openSession(id: string, lines: readonly CartLine[], currency: string): CheckoutSession {
  if (lines.length === 0) throw new Error('an empty cart cannot check out');
  return { id, totalMinor: totalMinor(lines), currency };
}
