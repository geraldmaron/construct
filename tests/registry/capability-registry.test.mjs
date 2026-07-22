/**
 * tests/registry/capability-registry.test.mjs — registry/capabilities.json validation gate.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { validateCapabilityRegistry, loadCapabilityRegistry } from '../../lib/registry/validate.mjs';
import { triageBoundOrphans } from '../../lib/registry/consolidation.mjs';
import { surfaceForCommand } from '../../lib/registry/surface-map.mjs';
import { CLI_COMMANDS, getCommandSpec } from '../../lib/cli-commands.mjs';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

test('capability registry loads and validates', () => {
  const loaded = loadCapabilityRegistry({ rootDir: ROOT });
  assert.ok(loaded.capabilities.length >= 15);
  const report = validateCapabilityRegistry({ rootDir: ROOT });
  assert.equal(report.errors.length, 0, report.errors.join('; '));
});

test('core CLI commands declare an interaction surface', () => {
  const coreCommands = CLI_COMMANDS.filter((command) => command.core).map((command) => command.name);
  assert.ok(coreCommands.length > 0);
  for (const name of coreCommands) {
    const spec = getCommandSpec(name);
    assert.ok(spec?.surface, `${name} missing surface`);
    assert.ok(surfaceForCommand(name));
  }
});

test('P0 capabilities declare lastValidated or pass capability runner', () => {
  const loaded = loadCapabilityRegistry({ rootDir: ROOT });
  const p0 = loaded.capabilities.filter((c) => c.criticality === 'P0');
  assert.ok(p0.length >= 3);
  for (const cap of p0) {
    assert.ok(
      cap.lastValidated || cap.verification?.functional,
      `${cap.id} missing validation path`,
    );
  }
});

test('embedded workflow types have registry coverage', () => {
  const report = validateCapabilityRegistry({ rootDir: ROOT });
  const missingWf = report.warnings.filter((w) => w.includes('embedded workflow'));
  assert.equal(missingWf.length, 0, missingWf.join('; '));
});
