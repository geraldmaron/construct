/**
 * tests/cli/first-run-surface.test.ts — first-run staffing and first output.
 *
 * Ordinary language ("is this ready", "do the claims match") is first-run.
 * The keyword map must not conscript program-sequencing on those phrases, and
 * a session that names system-design must not also pick up program-sequencing
 * just because the sentence said "ship". When the walkthrough claims that
 * first-run is talk, the first copyable construct command is not doctor,
 * status, or help.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { mapImplications } from '../../src/kernel/implication/map.ts';
import { sterile } from '../harness/sterile.ts';
import { openStore } from '../../src/kernel/store/open.ts';
import { join } from 'node:path';
import { createProjectionHandler } from '../../src/hosts/mcp/projection.ts';
import type { JsonRpcResponse } from '../../src/hosts/mcp/jsonrpc.ts';

const ROOT = fileURLToPath(new URL('../..', import.meta.url));

function domainsOf(outcome: string): string[] {
  return mapImplications({ outcome }).implicated.map((row) => row.domain);
}

test('"is this ready" and "do the claims match" do not staff program-sequencing from the keyword map', () => {
  assert.ok(!domainsOf('is this ready').includes('program-sequencing'));
  assert.ok(!domainsOf('do the claims match').includes('program-sequencing'));
});

test('naming system-design on a sentence that says ship does not also queue program-sequencing', async () => {
  const fixture = sterile();
  const store = openStore(join(fixture.paths.dataDir, 'construct.db'));
  try {
    const handle = createProjectionHandler({
      store,
      clock: () => '2026-08-26T12:00:00.000Z',
      serverVersion: 'test',
    });
    const reply = (await handle({
      jsonrpc: '2.0',
      id: 1,
      method: 'tools/call',
      params: {
        name: 'record_outcome',
        arguments: {
          outcome: 'is the architecture ready to ship',
          namings: [
            {
              domain: 'system-design',
              why: 'readiness of the shape is whether the architecture survives the change',
            },
          ],
        },
      },
    })) as JsonRpcResponse;
    const text = (reply.result as { content: Array<{ text: string }> }).content[0]?.text ?? '';
    const body = JSON.parse(text) as { implicated: Array<{ domain: string }> };
    assert.deepEqual(
      body.implicated.map((row) => row.domain),
      ['system-design'],
    );
  } finally {
    store.close();
    fixture.cleanup();
  }
});

function firstConstructCommand(markdown: string): string | null {
  const fence = /```(?:bash|sh|shell)\n([\s\S]*?)```/.exec(markdown);
  if (!fence) return null;
  for (const raw of fence[1].split('\n')) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    if (/^(?:npx\s+\S+\s+)?construct\b/.test(line)) return line;
  }
  return null;
}

function claimsOrdinaryLanguageFirstRun(markdown: string): boolean {
  return /is this ready/i.test(markdown) && /do the claims match/i.test(markdown);
}

test('when first-run claims ordinary language, the first construct command is not doctor, status, or help', () => {
  const pages = [
    ['docs/first-run.md', readFileSync(join(ROOT, 'docs/first-run.md'), 'utf8')],
    ['README.md', readFileSync(join(ROOT, 'README.md'), 'utf8')],
  ];
  for (const [path, text] of pages) {
    if (!claimsOrdinaryLanguageFirstRun(text)) continue;
    const first = firstConstructCommand(text);
    assert.ok(first, `${path} claims ordinary-language first-run but has no construct command to check`);
    assert.doesNotMatch(
      first,
      /\bconstruct\s+(doctor|status|help)\b/,
      `${path} first construct command is ${first} — first-run is talk, not doctor/status/verbs`,
    );
  }
});
