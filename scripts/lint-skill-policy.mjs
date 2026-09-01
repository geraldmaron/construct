/**
 * lint-skill-policy.mjs — Construct quality policy for method skills.
 *
 * Not Agent Skills specification requirements. These checks encode house
 * judgment about method skills: a stand-down rule so the skill does not always
 * interpose, and a soft line budget so progressive disclosure stays preferred
 * over a giant single file. The operational `construct` skill is exempt —
 * it is short posture, not a method pack. Failures here are Construct policy,
 * never claimed as agentskills.io mandates.
 */

import { execSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { basename, dirname } from 'node:path';

const OPERATIONAL = 'construct';
/** Soft ceiling: prefer SKILL.md under this; references/ carries the rest. */
const SOFT_MAX_LINES = 350;
const HARD_MAX_LINES = 500;

const files = execSync("git ls-files --cached --others --exclude-standard 'skills/*/SKILL.md'", {
  encoding: 'utf8',
})
  .split('\n')
  .filter(Boolean)
  .filter((file) => basename(dirname(file)) !== OPERATIONAL);

let violations = 0;
let warnings = 0;
const fail = (file, why) => {
  violations += 1;
  console.error(`skill policy: ${file}: ${why}`);
};
const warn = (file, why) => {
  warnings += 1;
  console.error(`skill policy (warn): ${file}: ${why}`);
};

for (const file of files) {
  const text = readFileSync(file, 'utf8');
  const lines = text.split('\n');
  const bodyStart = lines.findIndex((line, i) => i > 0 && line.trim() === '---');
  const body = bodyStart === -1 ? text : lines.slice(bodyStart + 1).join('\n');

  if (lines.length > HARD_MAX_LINES) {
    fail(file, `${lines.length} lines — hard ceiling ${HARD_MAX_LINES}; move bulk into references/`);
  } else if (lines.length > SOFT_MAX_LINES) {
    warn(
      file,
      `${lines.length} lines — over soft target ${SOFT_MAX_LINES}; prefer progressive disclosure`,
    );
  }

  if (!/stand[- ]down|stand[s]? down/i.test(body)) {
    fail(file, 'no stand-down rule — method skills must say when they do not engage');
  }
}

if (violations > 0) {
  console.error(`\n${violations} skill-policy violation(s).`);
  process.exit(1);
}
console.log(
  `lint-skill-policy: clean — ${files.length} method skill(s)` +
    (warnings > 0 ? `, ${warnings} soft-target warning(s)` : ''),
);
