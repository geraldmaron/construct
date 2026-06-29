/**
 * lib/artifact-gate-levels.mjs — Declarative gate-level → check-category registry.
 *
 * Each gate level (fast → human-reviewed) requires a cumulative set of check categories. A
 * category is either available (a real check runs today) or pending (no check exists yet — the
 * entry names the bead that will implement it). planGateForLevel partitions a level into what
 * runs now and what is owed, so a higher level never silently passes the checks it cannot yet
 * perform: the pending categories surface with their beads instead. Mapping mirrors
 * docs/notes/research/construct-asset-quality/synthesis/visual-quality-matrix.md.
 */
import { GATE_LEVELS } from './artifact-manifest.mjs';

export const DEFAULT_GATE_LEVEL = 'standard';

// Each category records whether a real check exists today; pending categories carry the bead that
// implements them so a gate plan can name what it is not yet enforcing.

export const CHECK_CATEGORIES = Object.freeze({
  'source-lint': { label: 'Source presentation + structure lint', status: 'available' },
  'export-validation': { label: 'Exported file integrity', status: 'pending', bead: 'construct-cuxq.5.2' },
  'content-roundtrip': { label: 'Content-preservation roundtrip', status: 'pending', bead: 'construct-cuxq.5.2' },
  'reference-integrity': { label: 'Missing image / broken link references', status: 'pending', bead: 'construct-cuxq.5.2' },
  'render-screenshot': { label: 'Rendered page/slide screenshot', status: 'pending', bead: 'construct-cuxq.3.3' },
  'font-floor': { label: 'Minimum font size', status: 'pending', bead: 'construct-cuxq.4.2' },
  contrast: { label: 'WCAG AA contrast', status: 'pending', bead: 'construct-cuxq.7.1' },
  'pixel-regression': { label: 'Pixel regression vs golden', status: 'pending', bead: 'construct-cuxq.10.2' },
  'full-a11y': { label: 'Full per-format accessibility', status: 'pending', bead: 'construct-cuxq.8.1' },
  'judgment-review': { label: 'Model/human judgment review', status: 'pending', bead: 'construct-cuxq.3.4' },
});

// Levels are cumulative: each adds categories on top of the cheaper level below it. fast carries
// only source lint so local feedback stays ms-fast.

const LEVEL_ADDITIONS = Object.freeze({
  fast: ['source-lint'],
  standard: ['export-validation', 'content-roundtrip', 'reference-integrity'],
  'render-smoke': ['render-screenshot', 'font-floor', 'contrast'],
  'full-certification': ['pixel-regression', 'full-a11y'],
  'human-reviewed': ['judgment-review'],
});

export function categoriesForLevel(level) {
  const out = [];
  for (const name of GATE_LEVELS) {
    out.push(...LEVEL_ADDITIONS[name]);
    if (name === level) return out;
  }
  return out;
}

export function resolveGateLevel(qualityContract) {
  const level = qualityContract?.gateLevel;
  return GATE_LEVELS.includes(level) ? level : DEFAULT_GATE_LEVEL;
}

// planGateForLevel splits a level's required categories into the checks that run today and the
// ones still owed; a pending category is never reported as running.

export function planGateForLevel(level) {
  const resolved = GATE_LEVELS.includes(level) ? level : DEFAULT_GATE_LEVEL;
  const runs = [];
  const pending = [];
  for (const category of categoriesForLevel(resolved)) {
    const meta = CHECK_CATEGORIES[category];
    if (meta?.status === 'available') runs.push(category);
    else pending.push({ category, bead: meta?.bead ?? null });
  }
  return { level: resolved, runs, pending };
}
