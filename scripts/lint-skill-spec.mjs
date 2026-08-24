/**
 * lint-skill-spec.mjs — a shipped skill is portable, or it does not ship.
 *
 * Every skills/<dir>/SKILL.md is checked against the things portability
 * actually turns on. The frontmatter carries only the six fields the Agent
 * Skills format defines — a vendor extension travels nowhere and is refused
 * at upload by stricter implementations. The name equals its directory and
 * uses the format's character set, so any client that resolves skills by
 * path can install it. The description fits the format's 1024-character cap,
 * because the description is what triggers the skill at all. The shipped
 * descriptions are also summed and held under a host's list budget: a host
 * offers every skill it can see by description before any of them load, and
 * the one published budget for that list is Codex's, at 2% of the context
 * window or 8000 characters when the window is unknown, with descriptions
 * shortened and then skills dropped once it is exceeded. That failure is
 * silent on the host side, which is what makes it worth catching here.
 * Passing proves the case that number comes from; a host that publishes no
 * budget stays unmeasured, and only a recorded load upgrades any of this
 * from documented to observed. The whole file
 * stays under 500 lines so it loads whole, without a progressive-disclosure
 * tier it does not have.
 *
 * Then the severability tripwires: no tracker bead ids, no paths into this
 * repository's source, no absolute paths. A skill that references the kernel
 * has silently recoupled to it, and the naked-file test this lint backstops
 * — the single file, pasted into a host that has never seen this repo, still
 * works — would fail on every machine but this one.
 *
 * The kernel's list of shipped names is checked against the directories
 * themselves. A published package carries no skill files, so an installed
 * spine can only tell which folders in a skills directory are this project's
 * by carrying the names; a list that drifted from the directories would have
 * the spine offering a skill nobody ships or missing one everybody has.
 *
 * Last, the shape checks from skills/AUTHORING.md, presence only: a
 * stand-down rule (a skill that always interposes teaches readers to ignore
 * it), a closing record block (enforcement travels as visible output shape,
 * not harness machinery), and an enforcement statement (the file says what
 * enforces it). Presence is all a lint can see; whether the stand-down is
 * honest or the record honest is judgment, and stays on the checklist.
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
    fail(file, `${lines.length} lines — the whole file must stay under ${MAX_LINES}`);
  }

  const isFence = (line) => line.trim() === '---';
  if (!isFence(lines[0])) {
    fail(file, 'no frontmatter — the file must open with a --- fence');
    continue;
  }
  const close = lines.findIndex((line, i) => i > 0 && isFence(line));
  if (close === -1) {
    fail(file, 'frontmatter never closes — no second --- fence');
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
      fail(file, `description is ${description.length} chars — the format caps it at ${MAX_DESCRIPTION}`);
    }
  }

  if (!/stand[- ]down|stand[s]? down/i.test(body)) {
    fail(file, 'no stand-down rule — the skill must say when it does not engage (AUTHORING.md rule 5)');
  }
  if (!/^#{2,3}[^\n]*record/im.test(body)) {
    fail(file, 'no closing record section — enforcement travels as a visible output shape (AUTHORING.md rule 3)');
  }
  if (!/enforce/i.test(body)) {
    fail(file, 'no enforcement statement — the skill must say what enforces it and what does not (AUTHORING.md rule 3)');
  }

  body.split('\n').forEach((line, i) => {
    const at = close + 2 + i;
    if (BEAD.test(line)) fail(file, `line ${at}: tracker bead id — lineage lives in the tracker, never in a shipped skill`);
    if (SRC_PATH.test(line)) fail(file, `line ${at}: repository path — a severable skill cannot point into this repo`);
    if (ABSOLUTE_PATH.test(line)) fail(file, `line ${at}: absolute path — the file must work on a machine that is not this one`);
  });
}

if (descriptionBudgetUsed > MAX_DESCRIPTION_BUDGET) {
  violations += 1;
  console.error(
    `skill spec: the shipped descriptions total ${descriptionBudgetUsed} chars, over the ` +
      `${MAX_DESCRIPTION_BUDGET}-char list budget — a host at that budget shortens descriptions, then drops ` +
      'skills, and says nothing about either',
  );
}

const shippedDirs = [...new Set(files.map((file) => basename(dirname(file))))].sort();
const declared = readFileSync('src/kernel/skills/library.ts', 'utf8');
const listed = /export const SHIPPED_SKILLS[\s\S]*?Object\.freeze\(\[([\s\S]*?)\]\)/.exec(declared);
if (!listed) {
  violations += 1;
  console.error('skill spec: src/kernel/skills/library.ts: no SHIPPED_SKILLS list to check the directories against');
} else {
  const names = [...listed[1].matchAll(/'([^']+)'/g)].map((match) => match[1]).sort();
  const missing = shippedDirs.filter((dir) => !names.includes(dir));
  const extra = names.filter((name) => !shippedDirs.includes(name));
  for (const dir of missing) {
    violations += 1;
    console.error(`skill spec: skills/${dir}: shipped on disk but absent from SHIPPED_SKILLS`);
  }
  for (const name of extra) {
    violations += 1;
    console.error(`skill spec: SHIPPED_SKILLS names "${name}", which no skills/ directory ships`);
  }
}

if (violations > 0) {
  console.error(`\n${violations} skill-spec violation(s). A skill ships portable or not at all.`);
  process.exit(1);
}
console.log(
  files.length === 0
    ? 'lint-skill-spec: clean (no skills yet)'
    : `lint-skill-spec: clean — ${files.length} skill(s) conform, descriptions ${descriptionBudgetUsed}/` +
      `${MAX_DESCRIPTION_BUDGET} chars of the one published list budget. Every check here reads host ` +
      'documentation, so a skill that passes is documented to load, not observed to.',
);
