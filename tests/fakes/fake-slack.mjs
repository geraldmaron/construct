/**
 * tests/fakes/fake-slack.mjs — in-memory fake Slack provider.
 *
 * Satisfies the provider contract (lib/providers/contract.mjs) so it can be
 * validated by assertProviderContract at test time. Never makes real network
 * calls. All state is held in the closure returned by create().
 *
 * Read/search return seeded channel messages; write posts a message and keeps
 * a record for inspection. Seeding is explicit so a golden-fixture test drives
 * the exact messages the TPM analysis cross-references.
 *
 * Usage:
 *   import { FakeSlack } from './index.mjs';
 *   const fake = FakeSlack.create();
 *   fake.seedMessages([{ id: 'msg-1', channel: '#eng', text: 'REQ-3 is blocked' }]);
 *
 * Implements the provider write() contract shape:
 *   write(config, payload) => result
 * where payload = { type: 'message', channel, text }
 */

let _seq = 300;

function nextTs() {
  return String(_seq++);
}

/**
 * Create a FakeSlack provider instance conforming to the registry contract.
 */
export function create() {
  /** @type {Array<{id: string, channel: string, text: string, ts: string, permalink: string}>} */
  const _messages = [];
  /** @type {Array<{id: string, channel: string, text: string}>} */
  const _posted = [];
  let _mode = 'normal'; // 'normal' | 'rate-limited' | 'channel-not-found'

  function setMode(mode) {
    const valid = ['normal', 'rate-limited', 'channel-not-found'];
    if (!valid.includes(mode)) {
      throw new Error(`FakeSlack: unknown mode '${mode}'. Valid: ${valid.join(', ')}`);
    }
    _mode = mode;
  }

  function reset() {
    _messages.length = 0;
    _posted.length = 0;
    _mode = 'normal';
  }

  /** Seed the channel history read()/search() return. */
  function seedMessages(messages = []) {
    for (const m of messages) {
      const ts = m.ts ?? nextTs();
      _messages.push({
        id: m.id ?? ts,
        channel: m.channel ?? 'unknown',
        text: m.text ?? '',
        ts,
        permalink: m.permalink ?? `https://slack.example.com/archives/${m.channel ?? 'unknown'}/p${ts}`,
      });
    }
  }

  /** Return a copy of all messages posted via write(). */
  function getPostedMessages() {
    return _posted.map((m) => ({ ...m }));
  }

  async function postMessage(channel, { text = '' } = {}) {
    if (_mode === 'rate-limited') {
      const err = new Error('rate limited');
      err.status = 429;
      throw err;
    }
    if (_mode === 'channel-not-found') {
      const err = new Error('channel_not_found');
      err.status = 404;
      throw err;
    }
    const ts = nextTs();
    const record = { id: ts, channel, text };
    _posted.push(record);
    return { id: ts, channel, ts, permalink: `https://slack.example.com/archives/${channel}/p${ts}` };
  }

  // ── provider contract implementation ─────────────────────────────────────

  async function write(_config, payload) {
    if (!payload || typeof payload !== 'object') {
      throw new Error('FakeSlack.write: payload must be an object');
    }
    if (payload.type === 'message') {
      const { channel = 'unknown', text } = payload;
      return postMessage(channel, { text });
    }
    throw new Error(`FakeSlack.write: unknown type '${payload.type}'`);
  }

  async function read(_config, _query) {
    return _messages.map((m) => ({ ...m }));
  }

  async function search(_config, _query) {
    const q = typeof _query === 'string' ? _query : (_query?.query ?? '');
    if (!q) return _messages.map((m) => ({ ...m }));
    const needle = q.toLowerCase();
    return _messages.filter((m) => m.text.toLowerCase().includes(needle)).map((m) => ({ ...m }));
  }

  async function health() {
    return { ok: true, detail: 'fake-slack: always healthy' };
  }

  return Object.assign(
    {
      meta: {
        id: 'fake-slack',
        displayName: 'Fake Slack',
        capabilities: ['read', 'search', 'write'],
        description: 'In-memory fake Slack provider for tests. No real network calls.',
      },
      health,
      read,
      search,
      write,
    },
    { setMode, reset, seedMessages, getPostedMessages, postMessage },
  );
}

export default create;
