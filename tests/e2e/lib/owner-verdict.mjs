/**
 * tests/e2e/lib/owner-verdict.mjs — the shared verdict grid for the E2E
 * owner-review pass.
 *
 * Every command row, every Tier-3 artifact, and every Tier-7 surface carries a
 * verdict on the same columned grid so the three scenario reports stay
 * comparable. This module is the single renderer + serializer for that grid:
 * the runner builds plain verdict objects, this file turns them into the
 * Markdown tables the reports embed and the JSON the summary aggregates.
 *
 * The grid is fixed by the plan and must not drift per-scenario:
 *   Functions      Y | N            — exit 0, expected side effects, no panic
 *   Documented     Y | N | Drift    — help + README + declared description agree
 *   Discoverable   Y | N            — completion suggests (public) / hides (internal)
 *   Noise          low | med | high — stdout volume vs. signal
 *   Recommendation ship | iterate | file
 *
 * No verdict value is invented here — callers pass observed values; an absent
 * field renders as `?` so a gap in the evidence is visible rather than hidden.
 */

export const VERDICT_COLUMNS = ['Functions', 'Documented', 'Discoverable', 'Noise', 'Recommendation'];

export const FUNCTIONS = Object.freeze({ YES: 'Y', NO: 'N' });
export const DOCUMENTED = Object.freeze({ YES: 'Y', NO: 'N', DRIFT: 'Drift' });
export const DISCOVERABLE = Object.freeze({ YES: 'Y', NO: 'N' });
export const NOISE = Object.freeze({ LOW: 'low', MED: 'med', HIGH: 'high' });
export const RECOMMENDATION = Object.freeze({ SHIP: 'ship', ITERATE: 'iterate', FILE: 'file' });

const ALLOWED = {
  Functions: new Set(Object.values(FUNCTIONS)),
  Documented: new Set(Object.values(DOCUMENTED)),
  Discoverable: new Set(Object.values(DISCOVERABLE)),
  Noise: new Set(Object.values(NOISE)),
  Recommendation: new Set(Object.values(RECOMMENDATION)),
};

// A verdict value the caller never set renders as `?` — an unmeasured cell is a
// finding in itself, so it must read differently from a measured "N".
const MISSING = '?';

function cell(column, value) {
  if (value == null) return MISSING;
  if (!ALLOWED[column]?.has(value)) {
    throw new Error(`owner-verdict: "${value}" is not a valid ${column} value`);
  }
  return value;
}

export function normalizeVerdict(v = {}) {
  return {
    Functions: cell('Functions', v.functions),
    Documented: cell('Documented', v.documented),
    Discoverable: cell('Discoverable', v.discoverable),
    Noise: cell('Noise', v.noise),
    Recommendation: cell('Recommendation', v.recommendation),
  };
}

function escapePipe(s) {
  return String(s ?? '').replace(/\|/g, '\\|').replace(/\n/g, ' ');
}

// One row per subject (command, artifact, surface). The leading column is the
// subject label; the rest is the fixed grid.

export function renderVerdictTable(rows, { labelHeader = 'Subject' } = {}) {
  const header = [labelHeader, ...VERDICT_COLUMNS];
  const sep = header.map(() => '---');
  const body = rows.map((r) => {
    const v = normalizeVerdict(r.verdict);
    return [escapePipe(r.label), v.Functions, v.Documented, v.Discoverable, v.Noise, v.Recommendation];
  });
  const lines = [
    `| ${header.join(' | ')} |`,
    `| ${sep.join(' | ')} |`,
    ...body.map((cells) => `| ${cells.join(' | ')} |`),
  ];
  return lines.join('\n');
}

// The summary aggregates verdicts across scenarios; serialize to a stable shape
// the cross-scenario synthesizer can count without re-parsing Markdown.

export function serializeVerdicts(rows) {
  return rows.map((r) => ({ label: r.label, ...normalizeVerdict(r.verdict), notes: r.notes ?? null }));
}

// Count how many rows land on each Recommendation — the headline number the
// summary report leads with ("N ship / N iterate / N file").

export function tallyRecommendations(rows) {
  const tally = { ship: 0, iterate: 0, file: 0, unmeasured: 0 };
  for (const r of rows) {
    const rec = normalizeVerdict(r.verdict).Recommendation;
    if (rec === RECOMMENDATION.SHIP) tally.ship++;
    else if (rec === RECOMMENDATION.ITERATE) tally.iterate++;
    else if (rec === RECOMMENDATION.FILE) tally.file++;
    else tally.unmeasured++;
  }
  return tally;
}
