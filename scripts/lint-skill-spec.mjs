/**
 * lint-skill-spec.mjs — a shipped skill is portable, or it does not ship.
 *
 * Every skills/<dir>/SKILL.md is checked against the things portability
 * actually turns on. The frontmatter carries only the six fields the Agent
 * Skills format defines — a vendor extension travels nowhere and is refused
 * at upload by stricter implementations. The name equals its directory and
 * uses the format's character set, so any client that resolves skills by
 * path can install it. The description fits the format's 1024-character cap,
 * because the description is what triggers the skill at all. The whole file
 * stays under 500 lines so it loads whole, without a progressive-disclosure
 * tier it does not have.
 *
 * Then the severability tripwires: no tracker bead ids, no paths into this
 * repository's source, no absolute paths. A skill that references the kernel
 * has silently recoupled to it, and the naked-file test this lint backstops
 * — the single file, pasted into a host that has never seen this repo, still
 * works — would fail on every machine but this one.
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

const files = execSync("git ls-files --cached --others --exclude-standard 'skills/*/SKILL.md'", {
  encoding: 'utf8',
})
  .split('\n')
  .filter(Boolean);

let violations = 0;
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
    if (!description) fail(file, 'description is empty');
    else if (description.length > MAX_DESCRIPTION) {
      fail(file, `description is ${description.length} chars — the format caps it at ${MAX_DESCRIPTION}`);
    }
  }

  body.split('\n').forEach((line, i) => {
    const at = close + 2 + i;
    if (BEAD.test(line)) fail(file, `line ${at}: tracker bead id — lineage lives in the tracker, never in a shipped skill`);
    if (SRC_PATH.test(line)) fail(file, `line ${at}: repository path — a severable skill cannot point into this repo`);
    if (ABSOLUTE_PATH.test(line)) fail(file, `line ${at}: absolute path — the file must work on a machine that is not this one`);
  });
}

if (violations > 0) {
  console.error(`\n${violations} skill-spec violation(s). A skill ships portable or not at all.`);
  process.exit(1);
}
console.log(
  files.length === 0
    ? 'lint-skill-spec: clean (no skills yet)'
    : `lint-skill-spec: clean — ${files.length} skill(s) conform`,
);
