/**
 * skill-scorecard.mjs — structural + size evidence for Phase H scorecards.
 *
 * Prints one row per skills folder SKILL.md: line count, char count, approx
 * token estimate, Agent Skills frontmatter ok/fail. Does not invent A/B lift
 * or observed host-load evidence.
 */

import { execSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { basename, dirname } from 'node:path';

const files = execSync("git ls-files --cached --others --exclude-standard 'skills/*/SKILL.md'", {
  encoding: 'utf8',
})
  .split('\n')
  .filter(Boolean)
  .sort();

console.log('name\tlines\tchars\t~tokens\tfrontmatter');
for (const file of files) {
  const text = readFileSync(file, 'utf8');
  const lines = text.split('\n').length;
  const chars = text.length;
  const tokens = Math.ceil(chars / 4);
  const name = basename(dirname(file));
  const ok = text.startsWith('---\n') && text.indexOf('\n---\n', 4) !== -1;
  console.log(`${name}\t${lines}\t${chars}\t${tokens}\t${ok ? 'ok' : 'FAIL'}`);
}
