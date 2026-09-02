/**
 * tests/architecture/deletion-gates.test.ts — the old universe stays gone:
 * none of its names appear in product code or current documentation.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = join(import.meta.dirname, '..', '..');
const GATES = ['withStore', 'openStore', 'src/kernel/store', 'schema 23', 'schema-23', 'record_outcome', 'shared default workspace', '.construct/settings.json', 'state: home', 'role-serve', 'construct outcome', 'construct work ', 'construct skills ', 'construct settings', 'construct verdict', 'construct compose', 'lens pack', 'persona pack', '.claude/skills/construct-', 'TUNED_FAMILIES', 'implication map', 'legacy verb', 'Legacy aliases'];

function currentFiles(): string[] {
  const out = execFileSync('git', ['ls-files', '-co', '--exclude-standard', 'src', 'scripts', 'skills', 'workflows', 'registry', 'docs', 'README.md', 'package.json', 'bin'], { cwd: ROOT, encoding: 'utf8' });
  return out.split('\n').filter(Boolean).filter((f) => !f.startsWith('docs/internal/'));
}

test('no product file or current document names a removed store, verb, format, or pack path', () => {
  const hits: string[] = [];
  for (const file of currentFiles()) {
    let text: string;
    try {
      text = readFileSync(join(ROOT, file), 'utf8');
    } catch {
      continue;
    }
    for (const gate of GATES) if (text.includes(gate)) hits.push(`${file}: ${gate}`);
  }
  assert.deepEqual(hits, []);
});

test('no duplicate hand-maintained catalog of commands, tools, skills, or workflows exists beside the definitions', () => {
  const src = execFileSync('git', ['ls-files', 'src'], { cwd: ROOT, encoding: 'utf8' }).split('\n').filter(Boolean);
  const duplicates = src.filter((f) => /\b(VERBS|COMMAND_TABLE|TOOL_LIST)\b/.test(readFileSync(join(ROOT, f), 'utf8')));
  assert.deepEqual(duplicates, []);
});
