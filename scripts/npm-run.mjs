/**
 * scripts/npm-run.mjs — run npm (or npx) with sanitized spawn env.
 *
 * Strips Cursor-injected npm_config_devdir before nested npm invocations from
 * package.json scripts so build chains do not repeat npm 11.2+ warnings.
 */

import { spawnSync } from 'node:child_process';
import { sanitizeNpmSpawnEnv } from '../lib/npm-spawn-env.mjs';

const [bin, ...args] = process.argv.slice(2);
if (!bin) {
  process.stderr.write('Usage: node scripts/npm-run.mjs <bin> [args...]\n');
  process.exit(1);
}

const result = spawnSync(bin, args, {
  stdio: 'inherit',
  env: sanitizeNpmSpawnEnv(process.env),
});
process.exit(result.status ?? 1);
