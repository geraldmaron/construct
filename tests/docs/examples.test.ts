/**
 * tests/docs/examples.test.ts — every command a user could copy from the
 * documentation runs, in order, inside a scratch project, and exits with
 * the code the page says (0 unless a line ends with "# exits N").
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { run } from '../../src/cli/index.ts';
import { capture, sandbox } from '../cli/support.ts';

const DOCS = join(import.meta.dirname, '..', '..', 'docs');
const SHELL_FENCE = /```(?:bash|sh|shell|zsh|console)\n([\s\S]*?)```/g;

interface Example { readonly file: string; readonly line: number; readonly argv: string[]; readonly expectCode: number }

function splitArgs(line: string): string[] {
  const out: string[] = [];
  for (const m of line.matchAll(/(?:[^\s"']+|"[^"]*"|'[^']*')+/g)) out.push(m[0].replace(/"([^"]*)"|'([^']*)'/g, (_, a: string | undefined, b: string | undefined) => a ?? b ?? ''));
  return out;
}

function examples(): Example[] {
  const out: Example[] = [];
  for (const name of readdirSync(DOCS).filter((n) => n.endsWith('.md')).sort()) {
    const text = readFileSync(join(DOCS, name), 'utf8');
    for (const fence of text.matchAll(SHELL_FENCE)) {
      const start = text.slice(0, fence.index).split('\n').length;
      fence[1]!.split('\n').forEach((raw, i) => {
        const exits = /#\s*exits\s+(\d)\s*$/.exec(raw);
        const line = raw.replace(/#.*$/, '').trim();
        if (!/^(npx --no-install )?construct\s/.test(line)) return;
        const argv = splitArgs(line).slice(line.startsWith('npx') ? 3 : 1);
        out.push({ file: name, line: start + i + 1, argv, expectCode: exits ? Number(exits[1]) : 0 });
      });
    }
  }
  return out;
}

test('every documented construct command runs in a scratch project and exits as documented', async () => {
  const all = examples();
  assert.ok(all.length > 30, `found ${String(all.length)} documented commands`);
  const byFile = new Map<string, Example[]>();
  for (const e of all) byFile.set(e.file, [...(byFile.get(e.file) ?? []), e]);
  for (const [file, list] of byFile) {
    const box = sandbox();
    try {
      mkdirSync(join(box.cwd, 'docs'), { recursive: true });
      writeFileSync(join(box.cwd, 'docs', 'design.md'), '# Design\n\n- Keep the kernel host-agnostic\n', 'utf8');
      // Every page assumes an initialized project unless it initializes one itself.
      if (!list.some((e) => e.argv[0] === 'init')) {
        const init = await capture(() => run(['init', '--scale=solo', '--outcome=ship', '--constraint=keep the API', `--skills-dir=${join(box.home, 'skills')}`, '--no-wire'], box.ctx));
        assert.equal(init.code, 0, `${file}: setup init failed: ${init.err}`);
      }
      for (const e of list) {
        const argv = e.argv.map((a) => (a === '--client=cursor' ? `--client=cursor` : a));
        const result = await capture(() => run(argv, box.ctx));
        assert.equal(result.code, e.expectCode, `${file}:${String(e.line)} \`construct ${argv.join(' ')}\` exited ${String(result.code)}, expected ${String(e.expectCode)}\n${result.err}${result.out.slice(0, 400)}`);
        assert.doesNotMatch(result.err, /    at /, `${file}:${String(e.line)} printed a stack trace`);
      }
    } finally {
      box.cleanup();
    }
  }
});
