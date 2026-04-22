#!/usr/bin/env node
/**
 * lib/hooks/config-protection.mjs — Config protection hook — prevents edits to protected runtime config files.
 *
 * Runs as PreToolUse on Edit/Write. Blocks modifications to ~/.construct/config.env, settings.template.json, and other protected config paths. Exits 2 to block.
 */
import { readFileSync } from 'fs';

const filePath = process.env.TOOL_INPUT_FILE_PATH || (() => {
  try { return JSON.parse(readFileSync(0, 'utf8'))?.tool_input?.file_path || ''; }
  catch { return ''; }
})();

if (!filePath) process.exit(0);

const PROTECTED = [
  /\.eslintrc(\.[a-z]+)?$/i,
  /eslint\.config(\.[a-z]+)?$/i,
  /\.prettierrc(\.[a-z]+)?$/i,
  /prettier\.config(\.[a-z]+)?$/i,
  /tsconfig(\.[^/]+)?\.json$/i,
  /biome\.json$/i,
  /\.stylelintrc(\.[a-z]+)?$/i,
  /stylelint\.config(\.[a-z]+)?$/i,
];

const base = filePath.split('/').pop();
if (PROTECTED.some(r => r.test(base))) {
  process.stderr.write(
    `[config-protection] The code quality rules are protected. Fix the code to meet the existing standards — don't weaken the rules.\nFile: ${filePath}\n`
  );
  process.exit(2);
}

// Meta-system protection: block edits to Construct's own critical files unless CX_ALLOW_META_EDIT=1
if (process.env.CX_ALLOW_META_EDIT !== '1') {
  const META_FILES = [
    /(?:^|\/)agents\/registry\.json$/,
    /(?:^|\/)install\.sh$/,
    /(?:^|\/)claude\/settings\.template\.json$/,
    /(?:^|\/)lib\/hooks\/[^/]+\.mjs$/,
  ];

  if (META_FILES.some(r => r.test(filePath))) {
    process.stderr.write(
      `[config-protection] This file is part of the Construct meta-system. Editing it affects all agent sessions and platforms. Set CX_ALLOW_META_EDIT=1 to proceed if you know what you're doing.\nFile: ${filePath}\n`
    );
    process.exit(2);
  }
}

process.exit(0);
