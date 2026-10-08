import type { Charge } from './charge.ts';
import type { Money } from './money.ts';

export interface Refund {
  readonly chargeId: string;
  readonly amount: Money;
}

export function refundFor(charge: Charge, amountMinor: number): Refund {
  if (charge.state !== 'captured') throw new Error('only a captured charge can be refunded');
  if (amountMinor > charge.amount.amountMinor) throw new Error('a refund cannot exceed the charge');
  return { chargeId: charge.id, amount: { amountMinor, currency: charge.amount.currency } };
}
