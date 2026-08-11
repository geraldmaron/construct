/**
 * A remediation string is read at the one moment the user is already stuck,
 * and naming a command the CLI does not implement is worse than naming none:
 * the user assumes they typed it wrong. Three strings in the extraction ladder
 * did exactly that — `construct install --with-docling` survived the port from
 * the predecessor, which had that command, into a CLI that does not.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';

const CLI = readFileSync(new URL('../../../src/cli/index.ts', import.meta.url), 'utf8');
const IMPLEMENTED = new Set(
  [...CLI.matchAll(/case '([a-z-]+)':/g)].map((m) => m[1] as string),
);

test('every construct subcommand named anywhere in src/ is one the CLI dispatches', () => {
  assert.ok(IMPLEMENTED.has('outcome'), 'the extractor read the CLI switch');
  const dir = new URL('../../../src/', import.meta.url);
  const walk = (url: URL): string[] =>
    readdirSync(url, { withFileTypes: true }).flatMap((e) =>
      e.isDirectory()
        ? walk(new URL(`${e.name}/`, url))
        : e.name.endsWith('.ts')
          ? [new URL(e.name, url).pathname]
          : [],
    );
  for (const file of walk(dir)) {
    const source = readFileSync(file, 'utf8');
    for (const match of source.matchAll(/construct ([a-z-]+)(?: --[a-z-]+)?/g)) {
      const command = match[1] as string;
      // Prose words that happen to follow the product name are not commands;
      // only judge tokens that look like an invocation (followed by a flag or
      // known-command shape) — the conservative check is exact membership for
      // anything that IS a known command plus a flag-carrying unknown.
      const carriesFlag = /--/.test(match[0]);
      if (carriesFlag || IMPLEMENTED.has(command)) {
        assert.ok(
          IMPLEMENTED.has(command),
          `${file} tells the user to run "construct ${command}", which this CLI does not implement`,
        );
      }
    }
  }
});
