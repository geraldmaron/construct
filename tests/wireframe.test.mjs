/**
 * tests/wireframe.test.mjs — tests for lib/wireframe.mjs generator.
 *
 * Covers type inference from natural-language prompts, keyword
 * extraction (stopword filtering, dedup), format routing (Mermaid vs
 * HTML), and output structural invariants across all diagram types.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { generateWireframe } from '../lib/wireframe.mjs';

test('wireframe: layout description routes to HTML', () => {
  const result = generateWireframe({ description: 'dashboard with sidebar filters' });
  assert.equal(result.type, 'layout');
  assert.equal(result.format, 'html');
  assert.equal(result.extension, 'html');
  assert.match(result.content, /<!doctype html>/);
  assert.match(result.content, /role="main"/);
});

test('wireframe: flow description routes to Mermaid graph TD', () => {
  const result = generateWireframe({ description: 'user signup flow with email verification' });
  assert.equal(result.type, 'flow');
  assert.equal(result.format, 'mermaid');
  assert.match(result.content, /```mermaid/);
  assert.match(result.content, /graph TD/);
});

test('wireframe: state description routes to stateDiagram-v2', () => {
  const result = generateWireframe({ description: 'order state machine with transitions' });
  assert.equal(result.type, 'state');
  assert.match(result.content, /stateDiagram-v2/);
});

test('wireframe: sequence description routes to sequenceDiagram', () => {
  const result = generateWireframe({ description: 'oauth handshake sequence between client and server' });
  assert.equal(result.type, 'sequence');
  assert.match(result.content, /sequenceDiagram/);
});

test('wireframe: ER description routes to erDiagram', () => {
  const result = generateWireframe({ description: 'database schema with user and session entities' });
  assert.equal(result.type, 'er');
  assert.match(result.content, /erDiagram/);
});

test('wireframe: explicit type override respected', () => {
  const result = generateWireframe({ description: 'dashboard', type: 'sequence' });
  assert.equal(result.type, 'sequence');
  assert.match(result.content, /sequenceDiagram/);
});

test('wireframe: HTML output escapes user input', () => {
  const result = generateWireframe({
    description: '<script>alert(1)</script>',
    type: 'layout',
  });
  assert.ok(!result.content.includes('<script>alert(1)</script>'), 'raw script tag must not appear');
  assert.match(result.content, /&lt;script&gt;/);
});

test('wireframe: HTML output includes semantic landmarks', () => {
  const result = generateWireframe({ description: 'admin panel', type: 'layout' });
  assert.match(result.content, /role="banner"/);
  assert.match(result.content, /role="navigation"/);
  assert.match(result.content, /role="main"/);
  assert.match(result.content, /role="contentinfo"/);
});

test('wireframe: HTML output includes prefers-color-scheme dark support', () => {
  const result = generateWireframe({ description: 'page', type: 'layout' });
  assert.match(result.content, /@media \(prefers-color-scheme: dark\)/);
});

test('wireframe: Mermaid output is wrapped in markdown fence for inline render', () => {
  const result = generateWireframe({ description: 'login flow' });
  assert.match(result.content, /```mermaid\n/);
  assert.match(result.content, /\n```\n/);
});
