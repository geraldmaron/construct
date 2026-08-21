/**
 * cli/cadence.ts — how often, said and read back.
 *
 * Standing outcomes and source watches both take one, and both list it back;
 * two parsers for `--every` would be two answers to what "1d" means.
 */

/** `--every` in minutes. Days and hours are sugar; the store keeps minutes. */
export function parseCadence(every: string): number {
  const match = /^(\d+)([mhd])$/.exec(every.trim());
  if (!match || Number(match[1]) < 1) {
    throw new Error(`--every takes <N>m, <N>h, or <N>d (minutes, hours, days), got "${every}"`);
  }
  const n = Number(match[1]);
  return match[2] === 'm' ? n : match[2] === 'h' ? n * 60 : n * 1440;
}

/** The largest exact unit, so a listing reads the way it was declared. */
export function renderCadence(minutes: number): string {
  if (minutes % 1440 === 0) return `${String(minutes / 1440)}d`;
  if (minutes % 60 === 0) return `${String(minutes / 60)}h`;
  return `${String(minutes)}m`;
}
