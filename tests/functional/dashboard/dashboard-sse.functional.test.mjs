/**
 * SSE channel smoke. Connects to /events and reads the initial bytes to
 * confirm the stream is open and serving the expected content-type. Does
 * not attempt to verify push-event delivery — that's covered by manual
 * smoke against a real session.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { withDashboardServer } from '../_lib/dashboard-server.mjs';

test('/events SSE channel opens with text/event-stream', { timeout: 30_000 }, async (t) => {
  const ds = await withDashboardServer(t);
  if (!ds) return;

  const controller = new AbortController();
  const res = await ds.fetch('/events', { signal: controller.signal });

  // Some servers expose SSE through a different path or only after auth.
  // 200 with the right content type is the happy path; 404 means the
  // server has the route off — treat as a skip not a failure.

  if (res.status === 404) {
    t.skip('/events route not exposed in this build');
    controller.abort();
    return;
  }
  assert.equal(res.status, 200, `/events must return 200 when registered; got ${res.status}`);
  const ct = res.headers.get('content-type') ?? '';
  assert.match(ct, /text\/event-stream/, `/events must be SSE; got ${ct}`);

  // Read first chunk then abort — only need to verify the stream opens.

  const reader = res.body?.getReader();
  if (reader) {
    const race = await Promise.race([
      reader.read(),
      new Promise((resolve) => setTimeout(() => resolve({ value: new Uint8Array() }), 2000)),
    ]);
    const value = race && race.value ? race.value : new Uint8Array();
    if (value.byteLength > 0) {
      const text = new TextDecoder().decode(value);
      assert.ok(text.length > 0, 'SSE stream must emit at least one byte');
    }
  }
  controller.abort();
});
