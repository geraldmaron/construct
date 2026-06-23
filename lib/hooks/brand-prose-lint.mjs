#!/usr/bin/env node
/**
 * lib/hooks/brand-prose-lint.mjs — PostToolUse hook: block brand drift at write time.
 *
 * Enforces marketing voice, retired typography, and Construct/cli naming on governed
 * markdown and template surfaces. Mirrors scripts/audit/03d-brand.mjs scope.
 *
 * @lifecycle PostToolUse
 * @matcher  Write|Edit|MultiEdit
 * @p95ms 40
 * @maxBlockingScope PostToolUse
 * @exits 0 = pass | 2 = block tool call
 */

import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { formatBrandViolations, lintFile } from '../brand-prose.mjs';

let filePath = process.env.TOOL_INPUT_FILE_PATH;
if (!filePath) {
  try {
    const input = JSON.parse(readFileSync(0, 'utf8'));
    filePath = input?.tool_input?.file_path || input?.tool_input?.path;
  } catch {}
}
if (!filePath) process.exit(0);

const rootDir = path.resolve(fileURLToPath(import.meta.url), '..', '..', '..');
const result = lintFile(filePath, { rootDir });
if (!result.violations.length) process.exit(0);

const output = formatBrandViolations([result]);
process.stderr.write(`${output}\n`);
process.stderr.write(
  '\nBrand policy blocked this edit (marketing voice, retired fonts, or Construct/cli naming). See docs/guides/reference/branding.md and docs/STYLE.md.\n',
);
process.exit(2);
