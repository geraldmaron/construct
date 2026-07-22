/**
 * tests/registration-contract.test.mjs — registration contract documentation and validation.
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  assertProviderFactoryModule,
  assertToolDefShape,
  HOST_DETECTION_REGISTRATION,
  PROVIDER_FACTORY_REGISTRATION,
  TOOL_MODULE_REGISTRATION,
} from '../lib/registration-contract.mjs';

describe('registration contracts', () => {
  it('documents MCP tool module required exports', () => {
    assert.deepEqual(TOOL_MODULE_REGISTRATION.requiredExports, ['TOOL_DEFS', 'TOOL_HANDLERS']);
    assert.equal(TOOL_MODULE_REGISTRATION.scanEntry, 'scanToolModules');
    assert.ok(TOOL_MODULE_REGISTRATION.requiredDefFields.includes('safety'));
  });

  it('documents provider factory registration entry points', () => {
    assert.equal(PROVIDER_FACTORY_REGISTRATION.factoryExport, 'create');
    assert.equal(PROVIDER_FACTORY_REGISTRATION.assertEntry, 'assertProviderContract');
    assert.equal(PROVIDER_FACTORY_REGISTRATION.registryEntry, 'resolveProviders');
  });

  it('documents host detection modules without collapsing them', () => {
    assert.equal(HOST_DETECTION_REGISTRATION.modules.length, 3);
    assert.ok(HOST_DETECTION_REGISTRATION.modules.some((m) => m.path.includes('host-capabilities')));
  });
});

describe('assertToolDefShape', () => {
  it('rejects defs missing safety classification', () => {
    assert.throws(
      () => assertToolDefShape({ name: 'demo', description: 'd', inputSchema: {} }, { filePath: 'demo.tool.mjs' }),
      /safety classification/,
    );
  });

  it('accepts a complete self-registration def', () => {
    assert.doesNotThrow(() => assertToolDefShape({
      name: 'demo',
      description: 'demo tool',
      inputSchema: { type: 'object' },
      safety: { class: 'read', filesystem: 'none', network: 'none', process: 'none' },
    }, { filePath: 'demo.tool.mjs' }));
  });

  it('accepts provider modules exporting create()', () => {
    assert.doesNotThrow(() => assertProviderFactoryModule({ create: () => ({}) }, { source: 'demo' }));
    assert.throws(
      () => assertProviderFactoryModule({}, { source: 'demo' }),
      /must export 'create'/,
    );
  });
});
