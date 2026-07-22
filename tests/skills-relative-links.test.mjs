/**
 * tests/skills-relative-links.test.mjs
 *
 * Guard: skills source must not use repo-relative markdown links (`](../…)`).
 * Those resolve from `skills/<cat>/<name>.md` but break after sync into
 * `.claude/skills/<cat>/<name>/SKILL.md` (extra directory level). Prefer
 * backtick repo paths (`rules/common/…`) which stay valid in both locations.
 */

import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';

const ROOT = path.resolve(import.meta.dirname, '..');
const SKILLS = path.join(ROOT, 'skills');

/** Markdown link destinations that climb out of the skill file's directory. */
const RELATIVE_CLIMB = /\[[^\]]*\]\((\.\.\/[^)\s]+)\)/g;

function skillMarkdownFiles(dir, out = []) {
  if (!fs.existsSync(dir)) return out;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) skillMarkdownFiles(full, out);
    else if (entry.isFile() && entry.name.endsWith('.md')) out.push(full);
  }
  return out;
}

test('skills markdown does not use relative ../ links that break under .claude/skills/<id>/SKILL.md', () => {
  const hits = [];
  for (const file of skillMarkdownFiles(SKILLS)) {
    const rel = path.relative(ROOT, file).split(path.sep).join('/');
    const text = fs.readFileSync(file, 'utf8');
    let match;
    RELATIVE_CLIMB.lastIndex = 0;
    while ((match = RELATIVE_CLIMB.exec(text)) !== null) {
      hits.push(`${rel}: ${match[0]}`);
    }
  }
  assert.deepEqual(
    hits,
    [],
    `relative climb links break after sync; use backtick repo paths instead:\n${hits.join('\n')}`,
  );
});
