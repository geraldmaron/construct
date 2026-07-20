/**
 * tests/diagram-export.test.mjs — headless Chrome probe arg contract.
 */
import assert from 'node:assert/strict';
import test from 'node:test';

import { HEADLESS_BROWSER_PROBE_ARGS } from '../lib/diagram-export.mjs';

test('HEADLESS_BROWSER_PROBE_ARGS includes --use-mock-keychain for macOS headless probes', () => {
  assert.ok(HEADLESS_BROWSER_PROBE_ARGS.includes('--use-mock-keychain'));
  assert.ok(HEADLESS_BROWSER_PROBE_ARGS.includes('--headless'));
  assert.ok(HEADLESS_BROWSER_PROBE_ARGS.includes('--no-sandbox'));
});
