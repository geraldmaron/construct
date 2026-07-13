/**
 * scripts/eval/skill-routing-bench.mjs — CLI runner for the skill-routing
 * retrieval benchmark (lib/skills/routing-bench.mjs). Dev/CI tool only —
 * unlike `construct evals retrieval`, this reads its fixture from
 * tests/fixtures/ and is never wired into bin/construct, so it never runs
 * against a published npm install where tests/** is not shipped.
 */
import { runSkillRoutingBench, formatBenchSummary } from '../../lib/skills/routing-bench.mjs';

const jsonOutput = process.argv.includes('--json');

const result = await runSkillRoutingBench({ rootDir: process.cwd() });

if (jsonOutput) {
  console.log(JSON.stringify(result, null, 2));
} else {
  console.log(formatBenchSummary(result));
}

if (result.summary.regressed.length > 0) {
  console.error(`\nskill-routing benchmark regressed: ${result.summary.regressed.map((r) => r.metric).join(', ')}`);
  process.exit(1);
}
