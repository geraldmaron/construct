/**
 * tests/mcp-broker-status.test.mjs — construct://status mcpBrokerMode field.
 *
 * Verifies that the status resource handler reports mcpBrokerMode: 'dispatch'
 * when the broker is active (team/enterprise mode or CONSTRUCT_MCP_BROKER=on)
 * and mcpBrokerMode: 'off' when it is not. Exercises the isBrokered() path
 * that feeds both mcpBroker and mcpBrokerMode without spawning the full server.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { isBrokered } from '../lib/mcp/broker.mjs';

// Mirror the status payload builder from lib/mcp/server.mjs so we can assert
// field values without spinning up a stdio MCP server.

function buildStatusPayload(env) {
  return {
    mcpBroker: isBrokered(env) ? 'on' : 'off',
    mcpBrokerMode: isBrokered(env) ? 'dispatch' : 'off',
  };
}

describe('construct://status mcpBrokerMode', () => {
  it('reports mcpBrokerMode: dispatch when CONSTRUCT_DEPLOYMENT_MODE=team', () => {
    const payload = buildStatusPayload({ CONSTRUCT_DEPLOYMENT_MODE: 'team' });
    assert.equal(payload.mcpBroker, 'on');
    assert.equal(payload.mcpBrokerMode, 'dispatch');
  });

  it('reports mcpBrokerMode: dispatch when CONSTRUCT_DEPLOYMENT_MODE=enterprise', () => {
    const payload = buildStatusPayload({ CONSTRUCT_DEPLOYMENT_MODE: 'enterprise' });
    assert.equal(payload.mcpBroker, 'on');
    assert.equal(payload.mcpBrokerMode, 'dispatch');
  });

  it('reports mcpBrokerMode: off for solo mode', () => {
    const payload = buildStatusPayload({ CONSTRUCT_DEPLOYMENT_MODE: 'solo' });
    assert.equal(payload.mcpBroker, 'off');
    assert.equal(payload.mcpBrokerMode, 'off');
  });

  it('reports mcpBrokerMode: off with no mode set (default solo)', () => {
    const payload = buildStatusPayload({});
    assert.equal(payload.mcpBroker, 'off');
    assert.equal(payload.mcpBrokerMode, 'off');
  });

  it('honors CONSTRUCT_MCP_BROKER=on override in solo mode', () => {
    const payload = buildStatusPayload({ CONSTRUCT_DEPLOYMENT_MODE: 'solo', CONSTRUCT_MCP_BROKER: 'on' });
    assert.equal(payload.mcpBroker, 'on');
    assert.equal(payload.mcpBrokerMode, 'dispatch');
  });

  it('honors CONSTRUCT_MCP_BROKER=off override in team mode', () => {
    const payload = buildStatusPayload({ CONSTRUCT_DEPLOYMENT_MODE: 'team', CONSTRUCT_MCP_BROKER: 'off' });
    assert.equal(payload.mcpBroker, 'off');
    assert.equal(payload.mcpBrokerMode, 'off');
  });
});
