/**
 * tests/visual/lib/evidence.mjs — durable artifacts for visual test runs.
 *
 * Writes transcripts, depth audits, UX findings, and action timelines under
 * .cx/visual-runs/ so specialist/skill tuning can be reviewed after a witness run.
 */

import fs from 'node:fs';
import path from 'node:path';

export function createEvidenceRun({ cwd = process.cwd(), label = 'visual-run' } = {}) {
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const dir = path.join(cwd, '.cx', 'visual-runs', `${stamp}-${label}`);
  fs.mkdirSync(dir, { recursive: true });
  const timeline = [];

  const record = (action, detail = {}) => {
    const entry = { at: new Date().toISOString(), action, ...detail };
    timeline.push(entry);
    return entry;
  };

  const writeJson = (name, data) => {
    fs.writeFileSync(path.join(dir, name), `${JSON.stringify(data, null, 2)}\n`);
  };

  const writeText = (name, text) => {
    fs.writeFileSync(path.join(dir, name), String(text ?? ''));
  };

  const finalize = (summary = {}) => {
    writeJson('summary.json', summary);
    writeJson('timeline.json', timeline);
    writeText('README.txt', [
      'Construct visual test run',
      `Directory: ${dir}`,
      `Finished: ${new Date().toISOString()}`,
      '',
      'Files:',
      '  transcript.txt — raw terminal capture',
      '  transcript-plain.txt — ANSI-stripped',
      '  depth-audit.md — per-role depth grading',
      '  ux-findings.json — surface UX nitpicks',
      '  summary.json — pass/fail rollup',
    ].join('\n'));
    return dir;
  };

  return { dir, record, writeJson, writeText, timeline, finalize };
}
