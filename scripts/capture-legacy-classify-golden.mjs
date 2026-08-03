/**
 * scripts/capture-legacy-classify-golden.mjs — one-shot capture of the
 * predecessor's classifier output over the intake corpus, frozen into
 * tests/kernel/intake/fixtures/classify-golden.json.
 *
 * This is how the harvest is behavior-locked. The port isn't checked against my
 * reading of v2's code; it's checked against what v2 actually returns. The
 * script needs a construct-legacy checkout and is NOT part of the test run —
 * the frozen JSON is. Re-run it (pointing CONSTRUCT_LEGACY at a checkout) only
 * to prove the corpus is still faithful, or to extend it; a diff in the output
 * is a real behavior change and needs an explanation in the commit.
 */

import { writeFileSync } from 'node:fs';
import { join } from 'node:path';

const LEGACY = process.env.CONSTRUCT_LEGACY
  ?? join(process.env.HOME ?? '', 'Developer/Projects/construct-legacy');

const { classifyRdIntake, formatTriageLine, suggestTags } =
  await import(`${LEGACY}/lib/intake/classify.mjs`);

const CASES = JSON.parse(
  await import('node:fs').then((fs) =>
    fs.readFileSync(new URL('../tests/kernel/intake/fixtures/classify-cases.json', import.meta.url), 'utf8'),
  ),
);

const golden = CASES.map((c) => {
  const input = { ...c.input, workspacePreset: c.input.preset ?? null };
  delete input.preset;
  const triage = classifyRdIntake(input);
  return {
    name: c.name,
    input: c.input,
    triage,
    line: formatTriageLine(c.input.sourcePath ?? '', triage),
    tags: suggestTags(triage, c.input.related ?? [], null),
  };
});

const out = new URL('../tests/kernel/intake/fixtures/classify-golden.json', import.meta.url);
writeFileSync(out, `${JSON.stringify(golden, null, 2)}\n`);
console.log(`captured ${golden.length} cases -> ${out.pathname}`);
