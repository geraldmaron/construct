#!/usr/bin/env node
/**
 * Validate the canonical Construct registry.
 *
 * This entry point exists for the standalone validation command. Runtime code
 * uses lib/registry/validator.mjs directly; both paths enforce the same shape.
 */

import { loadRegistry } from './registry/loader.mjs';
import { validate } from './registry/validator.mjs';
import { isMainModule } from './roots.mjs';

export function validateRegistry(registry = loadRegistry()) {
  const result = validate(registry);
  return {
    valid: result.ok,
    errors: result.errors.map((entry) => entry.message),
    warnings: result.warnings.map((entry) => entry.message ?? String(entry)),
  };
}

if (isMainModule(import.meta.url)) {
  const result = validateRegistry();
  if (result.valid) {
    process.stdout.write('Registry valid\n');
  } else {
    process.stderr.write(`${result.errors.join('\n')}\n`);
    process.exitCode = 1;
  }
}
