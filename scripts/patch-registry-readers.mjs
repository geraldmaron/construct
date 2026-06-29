#!/usr/bin/env node
import fs from 'node:fs';

const patches = [
  ['lib/certification/specialist-scenarios.mjs', '../registry/loader.mjs'],
  ['lib/certification/specialist-contracts.mjs', '../registry/loader.mjs'],
  ['lib/certification/skill-inventory.mjs', '../registry/loader.mjs'],
  ['lib/oracle/read-model.mjs', '../registry/loader.mjs'],
  ['lib/status.mjs', './registry/loader.mjs'],
  ['lib/specialists/prompt-schema.mjs', '../registry/loader.mjs'],
  ['lib/decisions/golden.mjs', '../registry/loader.mjs'],
  ['lib/uninstall/uninstall.mjs', '../registry/loader.mjs'],
  ['lib/validator.mjs', './registry/loader.mjs'],
  ['tests/roles-catalog.test.mjs', '../lib/registry/loader.mjs'],
  ['tests/functional/llm/specialist-roster.functional.test.mjs', '../../../lib/registry/loader.mjs'],
  ['tests/certification/specialist-contracts.test.mjs', '../../lib/registry/loader.mjs'],
  ['tests/embedded-contract-capability.test.mjs', '../lib/registry/loader.mjs'],
];

for (const [file, importPath] of patches) {
  if (!fs.existsSync(file)) continue;
  let c = fs.readFileSync(file, 'utf8');
  if (!c.includes('unified-registry.json') && !c.includes('loadRegistry')) continue;
  if (!c.includes('loadRegistry')) {
    const importLine = `import { loadRegistry } from '${importPath}';\n`;
    if (c.includes("import fs from 'node:fs'")) c = c.replace("import fs from 'node:fs';\n", `import fs from 'node:fs';\n${importLine}`);
    else if (c.includes('import { readFileSync')) c = c.replace(/^(import .+\n)/m, `$1${importLine}`);
    else c = `${importLine}${c}`;
  }
  c = c.replace(
    /JSON\.parse\(fs\.readFileSync\(path\.join\(([^)]+)\), 'utf8'\)\)/g,
    'loadRegistry({ rootDir: $1 })',
  );
  c = c.replace(
    /JSON\.parse\(readFileSync\(join\(([^)]+)\), 'utf8'\)\)/g,
    'loadRegistry({ rootDir: $1 })',
  );
  c = c.replace(
    /readJSON\(join\(rootDir, 'specialists', 'unified-registry\.json'\)\) \?\? \{\}/g,
    'loadRegistry({ rootDir })',
  );
  c = c.replace(
    /const registryPath = path\.join\(rootDir, 'specialists', 'unified-registry\.json'\);\s*const registry = readJsonSafe\(registryPath\);/g,
    'const registry = loadRegistry({ rootDir });',
  );
  c = c.replace(
    /join\(__dirname, '\.\.', 'specialists', 'unified-registry\.json'\)/g,
    "null /* use loadRegistry */",
  );
  fs.writeFileSync(file, c);
  console.log('patched', file);
}
