/**
 * tests/material-pattern-certification.test.mjs — cross-pattern certification pass
 * for construct-tsyfe.1.4–1.7 (registration, error/tombstone, schema validation).
 */

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';

import { validateSchema } from '../lib/flows/schema.mjs';
import {
  HOST_DETECTION_REGISTRATION,
  PROVIDER_FACTORY_REGISTRATION,
  TOOL_MODULE_REGISTRATION,
  assertProviderFactoryModule,
} from '../lib/registration-contract.mjs';
import {
  COMPAT_SURFACE_REGISTRY,
  evaluateCompatSurface,
  formatRetiredCliMessage,
} from '../lib/compat-surfaces.mjs';
import { resultError } from '../lib/deprecate.mjs';
import {
  VALIDATION_IMPLEMENTATIONS,
  validationResult,
} from '../lib/schema-validation-contract.mjs';

const REPO = fileURLToPath(new URL('..', import.meta.url));

function readRepo(relPath) {
  return readFileSync(`${REPO}/${relPath}`, 'utf8');
}

describe('construct-tsyfe.1.4 registration contract', () => {
  it('wires MCP tool scan through registration-contract', () => {
    const src = readRepo('lib/mcp/tool-registry.mjs');
    assert.match(src, /registration-contract\.mjs/);
    assert.match(src, /assertToolDefShape/);
    assert.equal(TOOL_MODULE_REGISTRATION.scanEntry, 'scanToolModules');
  });

  it('wires provider registry through registration-contract', () => {
    const src = readRepo('lib/providers/registry.mjs');
    assert.match(src, /registration-contract\.mjs/);
    assert.match(src, /assertProviderFactoryModule/);
    assert.equal(PROVIDER_FACTORY_REGISTRATION.registryEntry, 'resolveProviders');
    assert.doesNotThrow(() => assertProviderFactoryModule({ create: () => ({}) }, { source: 'test' }));
    assert.throws(
      () => assertProviderFactoryModule({}, { source: 'test' }),
      /must export 'create'/,
    );
  });

  it('documents host detection without collapsing modules', () => {
    assert.equal(HOST_DETECTION_REGISTRATION.modules.length, 3);
  });
});

describe('construct-tsyfe.1.5 error shape and tombstone helpers', () => {
  it('exposes canonical resultError helper', () => {
    assert.deepEqual(resultError('nope'), { ok: false, error: 'nope' });
  });

  it('evaluates retired CLI surfaces from compat registry', () => {
    assert.equal(Object.keys(COMPAT_SURFACE_REGISTRY).length >= 5, true);
    const matrix = evaluateCompatSurface('matrix');
    assert.equal(matrix.removed, true);
    assert.match(formatRetiredCliMessage('matrix'), /construct graph/);
  });

  it('routes models retired flags through compat-surfaces in bin/construct', () => {
    const src = readRepo('bin/construct');
    assert.match(src, /compat-surfaces\.mjs/);
    assert.match(src, /formatRetiredCliMessage/);
  });

  it('uses resultError on get_skill failure paths', () => {
    const src = readRepo('lib/mcp/tools/skills.mjs');
    assert.match(src, /resultError/);
  });
});

describe('construct-tsyfe.1.6 schema validation pilot', () => {
  it('routes flow validator through validationResult helper', () => {
    assert.equal(VALIDATION_IMPLEMENTATIONS.flowState.export, 'validateSchema');
    const result = validateSchema({ type: 'object', required: ['id'] }, {});
    assert.deepEqual(result, validationResult(['$: missing required property "id"']));
  });

  it('documents additional validators without requiring migration yet', () => {
    assert.ok(VALIDATION_IMPLEMENTATIONS.projectConfig);
    assert.ok(VALIDATION_IMPLEMENTATIONS.contracts);
  });
});

describe('construct-tsyfe.1.7 cross-pattern certification', () => {
  it('lists material-pattern-inventories in reference nav metadata', () => {
    const meta = JSON.parse(readRepo('docs/guides/reference/meta.json'));
    assert.ok(meta.pages.includes('material-pattern-inventories'));
  });
});
