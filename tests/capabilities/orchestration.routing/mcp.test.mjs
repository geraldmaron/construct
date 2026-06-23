/**
 * tests/capabilities/orchestration.routing/mcp.test.mjs — P0 capability gate for routing.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { routeRequest } from '../../../lib/orchestration-policy.mjs';

test('PRD request routes through product and architecture chain', () => {
  const result = routeRequest({ request: 'Draft a PRD for the customer portal login flow' });
  assert.ok(result.specialists?.length > 0, 'expected specialist chain');
  assert.ok(result.specialists.some((n) => String(n).includes('product-manager')), `expected product-manager in ${result.specialists.join(', ')}`);
});

test('contract chain is present for orchestrated work', () => {
  const result = routeRequest({ request: 'Review this architecture proposal for failure modes' });
  assert.ok(Array.isArray(result.contractChain), 'expected contractChain array');
});
