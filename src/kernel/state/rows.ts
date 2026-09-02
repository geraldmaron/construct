/**
 * kernel/state/rows.ts — helpers shared by the state modules.
 *
 * Every table module maps rows to readonly objects here, validates enums
 * before they reach SQL, and checks state transitions against one table per
 * machine. Nothing in this file touches the database.
 */

export function parseJson(raw: string | null): unknown {
  if (raw === null) return null;
  try {
    return JSON.parse(raw) as unknown;
  } catch {
    return raw;
  }
}

export function toJson(value: unknown): string {
  return JSON.stringify(value ?? null);
}

export function boolFrom(value: number | null): boolean {
  return value === 1;
}

export function requireOneOf<T extends string>(
  value: string,
  allowed: readonly T[],
  label: string,
): T {
  if (!(allowed as readonly string[]).includes(value)) {
    throw new Error(`${label} must be one of ${allowed.join(' | ')} (got ${value})`);
  }
  return value as T;
}

export function requireNonEmpty(value: string, label: string): string {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new Error(`${label} must be a non-empty string`);
  }
  return value;
}

export function requireUnitInterval(value: number, label: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value > 1) {
    throw new Error(`${label} must be a number between 0 and 1 (got ${String(value)})`);
  }
  return value;
}

/** ISO-8601 instants sort as strings; every timestamp the store holds is one. */
export function requireInstant(value: string, label: string): string {
  if (typeof value !== 'string' || Number.isNaN(Date.parse(value))) {
    throw new Error(`${label} must be an ISO-8601 instant (got ${String(value)})`);
  }
  return value;
}

export class IllegalTransitionError extends Error {
  readonly subject: string;
  readonly from: string;
  readonly to: string;

  constructor(subject: string, from: string, to: string) {
    super(`${subject} cannot move from ${from} to ${to}`);
    this.name = 'IllegalTransitionError';
    this.subject = subject;
    this.from = from;
    this.to = to;
  }
}

export function assertTransition<S extends string>(
  machine: Readonly<Record<S, readonly S[]>>,
  subject: string,
  from: S,
  to: S,
): void {
  if (!machine[from].includes(to)) throw new IllegalTransitionError(subject, from, to);
}

export function isTerminal<S extends string>(
  machine: Readonly<Record<S, readonly S[]>>,
  state: S,
): boolean {
  return machine[state].length === 0;
}
