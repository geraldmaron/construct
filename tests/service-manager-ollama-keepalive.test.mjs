/**
 * service-manager-ollama-keepalive.test.mjs — guards Ollama keep-alive resolution.
 *
 * Construct must stay vanilla on Ollama keep-alive: it never imposes a value of its
 * own (an imposed window pins every requested model in unified memory until the host
 * OOMs), and it honors an operator-provided value so a tuned shell/config export wins.
 * Absent an operator value the variable is left unset so the Ollama server applies its
 * own default and idle models unload on their own.
 */
import assert from 'node:assert/strict';
import test from 'node:test';

import { resolveOllamaKeepAlive } from '../lib/service-manager.mjs';

test('imposes nothing when no operator value is set', () => {
  for (const env of [undefined, {}, { OLLAMA_KEEP_ALIVE: '' }, { OLLAMA_KEEP_ALIVE: '   ' }]) {
    assert.equal(resolveOllamaKeepAlive(env), null);
  }
});

test('never returns an unbounded keep-alive of its own accord', () => {
  assert.notEqual(resolveOllamaKeepAlive({}), '-1');
  assert.notEqual(resolveOllamaKeepAlive(undefined), '-1');
});

test('respects an operator-provided keep-alive', () => {
  assert.equal(resolveOllamaKeepAlive({ OLLAMA_KEEP_ALIVE: '24h' }), '24h');
  assert.equal(resolveOllamaKeepAlive({ OLLAMA_KEEP_ALIVE: '5m' }), '5m');
});

test('trims surrounding whitespace from an operator value', () => {
  assert.equal(resolveOllamaKeepAlive({ OLLAMA_KEEP_ALIVE: ' 1h ' }), '1h');
});
