/**
 * lib/intake/constants.mjs — shared intake watcher depth constants and guidance.
 */

export const INTAKE_DEFAULT_MAX_DEPTH = 4;
export const INTAKE_HARD_MAX_DEPTH = 16;

export const INTAKE_DEPTH_GUIDANCE = [
  { value: 0, label: 'Only this directory', detail: 'Scans files directly in the parent dir, ignores all subdirs.' },
  { value: 1, label: 'One level deep', detail: 'Parent dir plus its immediate subdirs (e.g. parent/intake/file.md).' },
  { value: 2, label: 'Two levels deep', detail: 'Parent and two subdirs. A reasonable default for organized intake roots.' },
  { value: 4, label: 'Four levels (default)', detail: 'Catches most nested layouts without scanning huge trees.' },
  { value: 8, label: 'Deep scan', detail: 'Useful for archives. Slower; skip if the parent contains build output.' },
  { value: INTAKE_HARD_MAX_DEPTH, label: 'Unlimited (capped)', detail: `Walks up to ${INTAKE_HARD_MAX_DEPTH} levels — effectively unlimited. May be slow.` },
];

export function describeIntakeDepth(depth = INTAKE_DEFAULT_MAX_DEPTH) {
  const n = Number(depth);
  const value = !Number.isFinite(n) || n < 0
    ? INTAKE_DEFAULT_MAX_DEPTH
    : Math.min(Math.floor(n), INTAKE_HARD_MAX_DEPTH);
  const exact = INTAKE_DEPTH_GUIDANCE.find((g) => g.value === value);
  if (exact) return exact;
  return {
    value,
    label: `Custom depth (${value})`,
    detail: `Walks up to ${value} levels of subdirectories below each parent.`,
  };
}
