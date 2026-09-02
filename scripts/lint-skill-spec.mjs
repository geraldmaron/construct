/**
 * lint-skill-spec.mjs - shipped skills must stay portable under the Agent
 * Skills format, or they do not ship.
 *
 * Agent Skills (format) checks - hard failures:
 * - Frontmatter only the six fields the format defines
 * - name equals directory; character set and length
 * - description present and ≤1024 characters
 * - Shipped descriptions held under the one published list budget (Codex:
 *   8000 chars when the window is unknown)
 * - SKILL.md under 500 lines (progressive-disclosure companion: long
 *   material belongs in references/)
 * - Severability: no tracker bead ids, no repo-relative source paths, no
 *   absolute machine paths
 * - The operational skill named in src/kernel/skills/bundle.ts ships on disk
 *
 * Construct quality policy (AUTHORING.md layer 2) - presence hints, not
 * format requirements:
 * - A stand-down rule is expected for method skills (always-on method
 *   teaches readers to ignore it). Checked as a warning-shaped failure for
 *   method skills only; the operational skill may use a short stand-down.
 *
 * Historical Construct ceremony (in-file verification record + enforcement
 * statement) is NOT required by this lint. Those templates may live under
 * references/ with a one-line pointer from SKILL.md. See skills/AUTHORING.md.
 */

import { execSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { basename, dirname } from 'node:path';

const ALLOWED_FIELDS = new Set([
  'name',
  'description',
  'license',
  'compatibility',
  'metadata',
  'allowed-tools',
]);
const NAME_SHAPE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const BEAD = /construct-(?!mcp)[a-z0-9]{3,4}(?:\.\d+)?(?![a-z0-9_-])/;
const SRC_PATH = /(?:^|[\s`>("'])(?:src|tests|scripts|fixtures)\//;
const ABSOLUTE_PATH = /(?:^|[\s`>("'])\/(?:home|Users|tmp|etc|var|opt)\//;
const MAX_LINES = 500;
const MAX_DESCRIPTION = 1024;
/**
 * The budget a host spends listing every skill's description before any skill
 * loads. Codex publishes 2% of the context window, or this many characters
 * when the window is unknown (https://learn.chatgpt.com/docs/build-skills,
 * read 2026-08-24). No other host documents one, so this is the only figure
 * there is to hold the shipped set against.
 */
const MAX_DESCRIPTION_BUDGET = 8000;

const files = execSync("git ls-files --cached --others --exclude-standard 'skills/*/SKILL.md'", {
  encoding: 'utf8',
})
  .split('\n')
  .filter(Boolean);

let violations = 0;
let descriptionBudgetUsed = 0;
const fail = (file, why) => {
  violations += 1;
  console.error(`skill spec: ${file}: ${why}`);
};

for (const file of files) {
  const text = readFileSync(file, 'utf8');
  const lines = text.split('\n');

  if (lines.length > MAX_LINES) {
    fail(file, `${lines.length} lines - SKILL.md must stay under ${MAX_LINES} (move detail to references/)`);
  }

  const isFence = (line) => line.trim() === '---';
  if (!isFence(lines[0])) {
    fail(file, 'no frontmatter - the file must open with a --- fence');
    continue;
  }
  const close = lines.findIndex((line, i) => i > 0 && isFence(line));
  if (close === -1) {
    fail(file, 'frontmatter never closes - no second --- fence');
    continue;
  }
  const front = lines.slice(1, close);
  const body = lines.slice(close + 1).join('\n');

  const fields = new Map();
  for (const line of front) {
    const key = /^([A-Za-z][A-Za-z0-9-]*):/.exec(line);
    if (key) fields.set(key[1], line.slice(key[0].length).trim());
  }
  for (const key of fields.keys()) {
    if (!ALLOWED_FIELDS.has(key)) {
      fail(file, `frontmatter field "${key}" is not one of the six the format defines`);
    }
  }

  const name = fields.get('name') ?? '';
  const dir = basename(dirname(file));
  if (!name) fail(file, 'name is required');
  else if (name !== dir) fail(file, `name "${name}" must equal its directory "${dir}"`);
  else if (!NAME_SHAPE.test(name) || name.length > 64) {
    fail(file, `name "${name}" must be 1-64 chars of lowercase alphanumerics and hyphens`);
  }

  const descStart = front.findIndex((line) => /^description:/.test(line));
  if (descStart === -1) {
    fail(file, 'description is required');
  } else {
    let description = front[descStart].replace(/^description:\s*[|>]?-?\s*/, '');
    for (let i = descStart + 1; i < front.length && /^\s/.test(front[i]); i += 1) {
      description += ` ${front[i].trim()}`;
    }
    description = description.trim();
    descriptionBudgetUsed += description.length;
    if (!description) fail(file, 'description is empty');
    else if (description.length > MAX_DESCRIPTION) {
      fail(file, `description is ${description.length} chars - the format caps it at ${MAX_DESCRIPTION}`);
    }
  }

  // Construct quality policy: method skills name when they stand down.
  if (!/stand[- ]down|stand[s]? down/i.test(body)) {
    fail(file, 'no stand-down rule - Construct policy: say when the skill does not engage (AUTHORING.md)');
  }

  body.split('\n').forEach((line, i) => {
    const at = close + 2 + i;
    if (BEAD.test(line)) fail(file, `line ${at}: tracker bead id - lineage lives in the tracker, never in a shipped skill`);
    if (SRC_PATH.test(line)) fail(file, `line ${at}: repository path - a severable skill cannot point into this repo`);
    if (ABSOLUTE_PATH.test(line)) fail(file, `line ${at}: absolute path - the file must work on a machine that is not this one`);
  });
}

if (descriptionBudgetUsed > MAX_DESCRIPTION_BUDGET) {
  violations += 1;
  console.error(
    `skill spec: the shipped descriptions total ${descriptionBudgetUsed} chars, over the ` +
      `${MAX_DESCRIPTION_BUDGET}-char list budget - a host at that budget shortens descriptions, then drops ` +
      'skills, and says nothing about either',
  );
}

const shippedDirs = [...new Set(files.map((file) => basename(dirname(file))))].sort();
// The directory on disk is the catalog (kernel/skills/bundle.ts lists it at
// runtime), so there is no second list to keep in parity. The one name the
// code depends on by itself is the operational skill: init plants it.
const bundle = readFileSync('src/kernel/skills/bundle.ts', 'utf8');
const operationalMatch = /export const OPERATIONAL_SKILL\s*=\s*'([^']+)'/.exec(bundle);
const operationalName = operationalMatch?.[1] ?? null;
if (!operationalName) {
  violations += 1;
  console.error('skill spec: src/kernel/skills/bundle.ts: need OPERATIONAL_SKILL string');
} else if (!shippedDirs.includes(operationalName)) {
  violations += 1;
  console.error(`skill spec: skills/${operationalName}: the operational skill is not shipped on disk`);
}

if (violations > 0) {
  console.error(`\n${violations} skill-spec violation(s). A skill ships portable or not at all.`);
  process.exit(1);
}
console.log(
  files.length === 0
    ? 'lint-skill-spec: clean (no skills yet)'
    : `lint-skill-spec: clean - ${files.length} skill(s) conform, descriptions ${descriptionBudgetUsed}/` +
      `${MAX_DESCRIPTION_BUDGET} chars of the one published list budget. Format checks only; ` +
      'Construct record/enforcement ceremony is optional under references/.',
);
