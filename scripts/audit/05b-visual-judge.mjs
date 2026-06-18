/**
 * 05b-visual-judge.mjs — Phase 5b: subjective visual-maturity scoring.
 *
 * Phase 5 (05-visual.mjs) decides the mechanical dimensions (ANSI hygiene, usage
 * lines, category grouping). Subjective dimensions resist a boolean check, so Phase
 * 5b captures each surface's real text and scores three quality axes 0-3:
 *   - decision-point:  do option/prompt surfaces state defaults + consequences?
 *   - outcome/next-step: does the surface point at the obvious next action?
 *   - error-guidance:   do error surfaces suggest a correction ("Run …", "Did you mean")?
 *
 * The scores here are DETERMINISTIC PROXIES over the captured text — a re-runnable
 * first pass, not a substitute for an LLM judge. The capture artifact
 * (audit-artifacts/visual-judge-capture.json) is the judging input; the scorecard
 * (docs/audit/visual-maturity-scorecard.md) records the per-surface scores and the
 * rubric so a human or LLM judge can re-score the same surfaces.
 *
 * Read-only (spawns the real bin in an isolated HOME). Run: node scripts/audit/05b-visual-judge.mjs
 */

import { fileURLToPath } from 'node:url';

import { CLI_COMMANDS, CATEGORY_ORDER } from '../../lib/cli-commands.mjs';
import { isolatedEnv, runConstruct, cleanup } from './lib/spawn.mjs';
import { writeJson, writeText, mdTable } from './lib/artifacts.mjs';
import { recordFindings } from './lib/findings.mjs';

// Stratified surface set: every Core command in full, plus up to three commands
// from each other category, so the sample spans the catalog without spawning all 94.

function stratifiedCommands() {
  const byCategory = new Map();
  for (const spec of CLI_COMMANDS) {
    if (spec.internal) continue;
    const cat = spec.category || 'Core';
    if (!byCategory.has(cat)) byCategory.set(cat, []);
    byCategory.get(cat).push(spec.name);
  }
  const picked = [];
  for (const cat of CATEGORY_ORDER) {
    const names = byCategory.get(cat) || [];
    picked.push(...(cat === 'Core' ? names : names.slice(0, 3)));
  }
  return picked;
}

const ERROR_SURFACES = [
  { label: 'unknown-command', args: ['knoun'] },
  { label: 'unknown-subcommand', args: ['intake', 'znope'] },
  { label: 'bad-flag', args: ['status', '--definitely-not-a-flag'] },
];

// Proxy heuristics. Each returns 0-3 on the captured text. They are intentionally
// conservative — a 3 needs explicit evidence, so a low proxy score flags a surface
// for the judge rather than asserting a defect.

function scoreDecisionPoint(text) {
  const defaults = (text.match(/\(default[:)]/gi) || []).length + (text.match(/\bdefault\b/gi) || []).length;
  const consequence = /\b(will|so that|otherwise|skips?|keeps?|leaves?|overrides?)\b/i.test(text);
  if (defaults >= 3 && consequence) return 3;
  if (defaults >= 1 && consequence) return 2;
  if (defaults >= 1) return 1;
  return 0;
}

function scoreOutcome(text) {
  const nextStep = /\b(next|then|after this|once)\b/i.test(text);
  const pointer = /\b(see|run|try)\b/i.test(text) || /→|->/.test(text);
  const example = /\n\s*construct\s+\w/.test(text) || /Example/i.test(text);
  const signals = [nextStep, pointer, example].filter(Boolean).length;
  return Math.min(3, signals);
}

function scoreErrorGuidance(text) {
  const didYouMean = /did you mean/i.test(text);
  const alternatives = /\bavailable:\s*\S/i.test(text) || /\bvalid\s+\w+s?:\s*\S/i.test(text);
  const actionable = /\b(run|try|see|use)\b/i.test(text) || /--help/.test(text);
  const named = /'[^']+'|`[^`]+`/.test(text);
  if (didYouMean) return 3;
  if (alternatives || (actionable && named)) return 2;
  if (actionable) return 1;
  return 0;
}

const specByName = Object.fromEntries(CLI_COMMANDS.map((c) => [c.name, c]));

export function runVisualJudge() {
  const { fakeHome, env } = isolatedEnv({ NO_COLOR: '1' });
  const surfaces = [];
  try {
    for (const name of stratifiedCommands()) {
      const r = runConstruct([name, '--help'], { env, timeout: 6000 });
      const text = r.stdout || '';

      // Decision-point only applies where there is a decision: a command with no
      // options has nothing to default or warn about, so it is scored N/A (null)
      // rather than 0, keeping the dimension's average over the population it describes.

      const hasOptions = (specByName[name]?.options?.length || 0) > 0;
      surfaces.push({
        surface: name,
        kind: 'help',
        scores: { decisionPoint: hasOptions ? scoreDecisionPoint(text) : null, outcome: scoreOutcome(text) },
        chars: text.length,
      });
    }
    for (const e of ERROR_SURFACES) {
      const r = runConstruct(e.args, { env, timeout: 6000 });
      const text = `${r.stdout || ''}\n${r.stderr || ''}`;
      surfaces.push({
        surface: e.label,
        kind: 'error',
        scores: { errorGuidance: scoreErrorGuidance(text) },
        chars: text.length,
      });
    }
    return { surfaces };
  } finally {
    cleanup(fakeHome);
  }
}

function toFindings(report) {
  const rows = [];
  for (const s of report.surfaces) {
    if (s.kind === 'help' && s.scores.outcome === 0) {
      rows.push({ type: 'visual-no-next-step', target: s.surface, severity: 'low', tier: 'judgment',
        evidence: '--help surfaces no next-step pointer (no see/run/example/→)',
        recommendation: 'Close help with an example invocation or a "Next:" pointer to the obvious follow-up.' });
    }
    if (s.kind === 'error' && s.scores.errorGuidance <= 1) {
      rows.push({ type: 'visual-weak-error-guidance', target: s.surface, severity: 'low', tier: 'judgment',
        evidence: `error surface scored ${s.scores.errorGuidance}/3 — no correction suggested`,
        recommendation: 'Suggest the nearest valid command/flag ("Did you mean …") or point at --help with the specific name.' });
    }
  }
  return rows;
}

function buildScorecard(report) {
  const help = report.surfaces.filter((s) => s.kind === 'help');
  const errs = report.surfaces.filter((s) => s.kind === 'error');

  // Average each axis over the surfaces it scores (null = not applicable, skipped).

  const avg = (rows, key) => {
    const scored = rows.map((r) => r.scores[key]).filter((v) => typeof v === 'number');
    return scored.length ? (scored.reduce((a, v) => a + v, 0) / scored.length).toFixed(2) : 'n/a';
  };
  const cell = (v) => (typeof v === 'number' ? String(v) : 'n/a');

  const helpRows = help.map((s) => [s.surface, cell(s.scores.decisionPoint), cell(s.scores.outcome)]);
  const errRows = errs.map((s) => [s.surface, cell(s.scores.errorGuidance)]);

  return [
    '---', 'title: Visual maturity scorecard (Phase 5b)', 'description: Subjective visual-maturity proxy scores across captured CLI surfaces.', '---', '',
    '# Visual maturity scorecard (Phase 5b)', '',
    'Generated by `scripts/audit/05b-visual-judge.mjs`. Scores are deterministic proxies (0-3) over captured `--help`/error text — a re-runnable first pass that flags surfaces for an LLM/human judge, not a final verdict. Rubric and capture live in `audit-artifacts/visual-judge-capture.json`.', '',
    '## Rubric', '',
    '- **decision-point** (0-3): option/prompt surfaces state defaults and the consequence of each choice.',
    '- **outcome/next-step** (0-3): the surface points at the obvious next action (example, `See …`, `Run …`, `→`).',
    '- **error-guidance** (0-3): error surfaces suggest a correction (`Did you mean …`, the specific name, `--help`).', '',
    `## Help surfaces (${help.length}) — averages: decision-point ${avg(help, 'decisionPoint')} (option-bearing only), next-step ${avg(help, 'outcome')}`, '',
    mdTable(['Surface', 'Decision-point', 'Next-step'], helpRows), '',
    `## Error surfaces (${errs.length}) — average error-guidance ${avg(errs, 'errorGuidance')}`, '',
    mdTable(['Surface', 'Error-guidance'], errRows), '',
  ].join('\n');
}

function main() {
  const report = runVisualJudge();
  const findings = toFindings(report);
  recordFindings('05b-visual-judge', findings);
  writeJson('visual-judge-capture.json', report);
  writeText('../docs/audit/visual-maturity-scorecard.md', buildScorecard(report));
  const help = report.surfaces.filter((s) => s.kind === 'help');
  const errs = report.surfaces.filter((s) => s.kind === 'error');
  process.stdout.write(`[audit:05b] scored ${help.length} help + ${errs.length} error surfaces; ${findings.length} flagged for judge review.\n`);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) main();
