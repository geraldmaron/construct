/**
 * tests/cli/log-run-flag.test.ts — `construct log --run=<id>` scopes exactly
 * as `construct log --run <id>` does.
 *
 * log's own sibling `show()` in the same file, and work.ts's and verdict.ts's
 * arg parsers, all accept both forms; log itself only recognized the spaced
 * one. The equals form matched no case and left `run` undefined, so it fell
 * through to the unscoped branch silently — no error, no warning, just a
 * much longer reply than the one line the caller asked for.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { main } from '../../src/cli/index.ts';
import { sterile } from '../harness/sterile.ts';
import { openStore } from '../../src/kernel/store/open.ts';
import { startRunSelected } from '../../src/kernel/run/outcome.ts';

/** One `main()` invocation, returning what it printed to stdout. */
async function captureLog(argv: string[]): Promise<string> {
  const out: string[] = [];
  const realOut = process.stdout.write.bind(process.stdout);
  (process.stdout as { write: unknown }).write = (chunk: string) => {
    out.push(String(chunk));
    return true;
  };
  try {
    const code = await main(argv);
    assert.equal(code, 0);
    return out.join('');
  } finally {
    (process.stdout as { write: unknown }).write = realOut;
  }
}

test('--run=<id> and --run <id> scope the log identically, and both differ from the unscoped dump', async () => {
  const fixture = sterile();
  const previous = process.env.XDG_DATA_HOME;
  const share = join(fixture.root, 'share');
  process.env.XDG_DATA_HOME = share;
  try {
    mkdirSync(join(share, 'construct'), { recursive: true });
    const store = openStore(join(share, 'construct', 'construct.db'));
    // Two runs, named for domains that will not be confused with each other
    // in the printed lines, so a test that scopes wrong is caught rather
    // than passing by coincidence.
    startRunSelected(store, {
      runId: 'run-flag-a',
      outcome: 'Run A outcome',
      at: '2026-08-21T00:00:00.000Z',
      domains: ['privacy'],
    });
    startRunSelected(store, {
      runId: 'run-flag-b',
      outcome: 'Run B outcome',
      at: '2026-08-21T00:01:00.000Z',
      domains: ['security'],
    });
    store.close();

    const equalsForm = await captureLog(['log', '--run=run-flag-a']);
    const spacedForm = await captureLog(['log', '--run', 'run-flag-a']);
    const unscoped = await captureLog(['log']);

    assert.equal(equalsForm, spacedForm, 'the two flag forms must scope identically');
    assert.match(equalsForm, /privacy/);
    assert.doesNotMatch(equalsForm, /security/, "run-flag-a's log must not carry run-flag-b's entries");

    // The unscoped dump is a real superset, not the same reply under another
    // name — the defect being fixed is a mistyped flag landing here silently
    // instead of erroring or scoping.
    assert.match(unscoped, /security/);
    assert.notEqual(unscoped, equalsForm);
  } finally {
    if (previous === undefined) delete process.env.XDG_DATA_HOME;
    else process.env.XDG_DATA_HOME = previous;
    fixture.cleanup();
  }
});
