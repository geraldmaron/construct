/**
 * tests/cli/first-run-surface.test.ts — first-run mechanism, not a phrase catalog.
 *
 * Cheap check locks the mechanism only:
 *   - Host in session: intent is inferred by the host (or handled as a
 *     generic host request / routed to inbox). The keyword map is not
 *     consulted. Empty fake staff from keywords is a fail.
 *   - No hardcoded sentence → domain ID.
 *   - First construct command in the walkthrough is not doctor / status / help.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { outcome } from '../../src/cli/index.ts';
import { resolvePaths } from '../../src/kernel/paths.ts';
import { openStore, storePath } from '../../src/kernel/store/open.ts';
import { listTasks } from '../../src/kernel/store/tasks.ts';
import { sterileAmbientEnv, sterileHome } from '../harness/sterile.ts';

sterileHome();
sterileAmbientEnv();

const ROOT = fileURLToPath(new URL('../..', import.meta.url));
const CURSOR_ENV = { CURSOR_AGENT: '1' };
const CLAUDE_ENV = { CLAUDECODE: '1' };

/** A sentence the keyword map would staff if it were consulted. */
const KEYWORD_RICH = 'We want to hire a contractor in Poland';

async function captureOutcome(
  argv: string[],
  env: NodeJS.ProcessEnv,
): Promise<{ code: number; out: string }> {
  const root = mkdtempSync(join(tmpdir(), 'construct-first-run-'));
  const previous = { data: process.env.XDG_DATA_HOME, cache: process.env.XDG_CACHE_HOME };
  process.env.XDG_DATA_HOME = join(root, 'share');
  process.env.XDG_CACHE_HOME = join(root, 'cache');
  const chunks: string[] = [];
  const realOut = process.stdout.write.bind(process.stdout);
  (process.stdout as { write: unknown }).write = (c: string) => (chunks.push(String(c)), true);
  try {
    const code = await outcome(argv, undefined, env);
    const inSession = env.CURSOR_AGENT !== undefined || env.CLAUDECODE !== undefined;
    if (inSession) {
      const store = openStore(storePath(resolvePaths()));
      try {
        assert.equal(listTasks(store).length, 0, 'empty fake staff from keywords is a fail');
      } finally {
        store.close();
      }
    }
    return { code, out: chunks.join('') };
  } finally {
    (process.stdout as { write: unknown }).write = realOut;
    if (previous.data === undefined) delete process.env.XDG_DATA_HOME;
    else process.env.XDG_DATA_HOME = previous.data;
    if (previous.cache === undefined) delete process.env.XDG_CACHE_HOME;
    else process.env.XDG_CACHE_HOME = previous.cache;
    rmSync(root, { recursive: true, force: true });
  }
}

test('host in session does not consult the keyword map — keyword-rich text staffs nothing', async () => {
  const { code, out } = await captureOutcome([KEYWORD_RICH], CURSOR_ENV);
  assert.equal(code, 0);
  assert.match(out, /This session infers the intent/);
  assert.match(out, /keyword map is not consulted/);
  assert.match(out, /record_outcome/);
  assert.match(out, /inbox/);
  assert.doesNotMatch(out, /implicated domains/);
  assert.doesNotMatch(out, /run run-/);
  assert.doesNotMatch(out, /\bemployment\b/);
  assert.doesNotMatch(out, /\bcontracts\b/);
  assert.doesNotMatch(out, /no domains implicated/);
});

test('host in session does not invent a hollow run when the keyword map would be silent', async () => {
  const { code, out } = await captureOutcome(['a sentence with no catalog keywords'], CLAUDE_ENV);
  assert.equal(code, 0);
  assert.match(out, /keyword map is not consulted/);
  assert.match(out, /record_outcome|inbox/);
  assert.doesNotMatch(out, /implicated domains/);
  assert.doesNotMatch(out, /run run-/);
  assert.doesNotMatch(out, /no domains implicated/);
});

test('a terminal with no host session still uses the keyword map', async () => {
  const { code, out } = await captureOutcome([KEYWORD_RICH], {});
  assert.equal(code, 0);
  assert.match(out, /implicated domains/);
  assert.match(out, /run run-/);
  assert.match(out, /\bemployment\b/);
  assert.doesNotMatch(out, /keyword map is not consulted/);
});

test('the implication map has no hardcoded sentence-to-domain table', () => {
  const mapSrc = readFileSync(join(ROOT, 'src/kernel/implication/map.ts'), 'utf8');
  const domainsSrc = readFileSync(join(ROOT, 'src/kernel/implication/domains.ts'), 'utf8');
  assert.doesNotMatch(mapSrc, /FIRST_RUN_PHRASES|seatFirstRunPhrases/);
  assert.doesNotMatch(domainsSrc, /FIRST_RUN_PHRASES/);
  assert.doesNotMatch(mapSrc, /phrase:\s*['"][^'"]+['"]\s*,\s*domain:/);
  assert.doesNotMatch(domainsSrc, /phrase:\s*['"][^'"]+['"]\s*,\s*domain:/);
});

function firstConstructCommand(markdown: string): string | null {
  const fences = markdown.matchAll(/```(?:bash|sh|shell)\n([\s\S]*?)```/g);
  for (const fence of fences) {
    for (const raw of fence[1].split('\n')) {
      const line = raw.trim();
      if (!line || line.startsWith('#')) continue;
      if (/^(?:npx\s+\S+\s+)?construct\b/.test(line)) return line;
    }
  }
  return null;
}

test('the walkthrough first construct command is not doctor, status, or help', () => {
  const pages = [
    ['docs/first-run.md', readFileSync(join(ROOT, 'docs/first-run.md'), 'utf8')],
    ['README.md', readFileSync(join(ROOT, 'README.md'), 'utf8')],
  ];
  for (const [path, text] of pages) {
    const first = firstConstructCommand(text);
    assert.ok(first, `${path} has no construct command to check`);
    assert.doesNotMatch(
      first,
      /\bconstruct\s+(doctor|status|help)\b/,
      `${path} first construct command is ${first} — first-run is talk, not doctor/status/help`,
    );
  }
});
