#!/usr/bin/env node
/**
 * Copy the Next.js static export from apps/dashboard/out/ into
 * lib/server/static/ so lib/server/index.mjs (which still reads from its
 * legacy STATIC_DIR) picks up the rebuilt dashboard without code changes.
 *
 * Idempotent — wipes the destination first to guarantee no stale assets from
 * a previous build linger between runs.
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const out = path.resolve(here, '..', 'out');
const dest = path.resolve(here, '..', '..', '..', 'lib', 'server', 'static');

if (!fs.existsSync(out)) {
  console.error(`[dashboard:copy] expected build output at ${out}; run \`next build\` first`);
  process.exit(1);
}

fs.rmSync(dest, { recursive: true, force: true });
fs.mkdirSync(dest, { recursive: true });
fs.cpSync(out, dest, { recursive: true });

const fileCount = (() => {
  let n = 0;
  const walk = (d) => {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      if (e.isDirectory()) walk(path.join(d, e.name));
      else n++;
    }
  };
  walk(dest);
  return n;
})();

console.log(`[dashboard:copy] synced ${fileCount} files from ${path.relative(process.cwd(), out)} → ${path.relative(process.cwd(), dest)}`);
