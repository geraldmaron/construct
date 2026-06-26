/**
 * scripts/catalog-regen.mjs — Regenerate registry/capabilities.json catalog edges.
 */

import { regenerateCapabilityCatalog } from '../lib/registry/catalog.mjs';

const result = regenerateCapabilityCatalog();
process.stdout.write(
  `catalog:regen → ${result.path} (${result.capabilityCount} capabilities, `
  + `${result.npmScriptCount} npm scripts, ${result.cliCommandCount} CLI commands, `
  + `${result.workflowCount} workflows)\n`,
);
