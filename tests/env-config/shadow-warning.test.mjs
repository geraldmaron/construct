/**
 * tests/env-config/shadow-warning.test.mjs — proof.
 *
 * The env-shadow warning claimed "The config file will be used" on every surface,
 * but bin/construct copies only the keys missing from process.env, so on a conflict
 * the shell value wins there while the MCP server's file-wins merge makes the file
 * value win. The message now names the value that actually wins per surface.
 */

import assert from 'node:assert/strict';
import test from 'node:test';

import { shadowWarningMessage } from '../../lib/env-config.mjs';

test('[construct-xj96.12] file-wins surface names the config file as the winner', () => {
  const msg = shadowWarningMessage('ANTHROPIC_API_KEY', 'file');
  assert.match(msg, /The config file will be used/);
  assert.doesNotMatch(msg, /The shell value will be used/);
});

test('[construct-xj96.12] shell-wins surface (bin/construct) names the shell value as the winner', () => {
  const msg = shadowWarningMessage('ANTHROPIC_API_KEY', 'shell');
  assert.match(msg, /The shell value will be used/);
  assert.doesNotMatch(msg, /The config file will be used/);
});

test('[construct-xj96.12] default winner is file (backward-compatible for existing callers)', () => {
  assert.match(shadowWarningMessage('X'), /The config file will be used/);
});
