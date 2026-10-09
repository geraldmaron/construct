import type { Money } from './money.ts';

export interface Charge {
  readonly id: string;
  readonly sessionId: string;
  readonly amount: Money;
  readonly state: 'authorized' | 'captured' | 'failed';
}

export function capture(charge: Charge): Charge {
  if (charge.state !== 'authorized') throw new Error(`charge ${charge.id} is ${charge.state}, not authorized`);
  return { ...charge, state: 'captured' };
}
