/**
 * apps/chat/tui/turn-state.mjs — pure turn-state reduction for the Ink surface.
 *
 * The Ink app is hard to unit test; the state math is not. This module owns the
 * reduction of normalized driver events into the renderable turn state (streaming
 * assistant text, reasoning, the tool timeline, and the route overlay) with no
 * React or Ink import, so the same logic the panes display is verified in
 * isolation. The Ink components are then a thin projection of this state.
 *
 * The channels deliberately mirror the linear renderer's (lib/chat/tui/render.mjs)
 * grouping, so the rich and accessible surfaces stay semantically aligned. Events
 * skipped by isVisible() are not reduced, matching the linear renderer's layer gates.
 */

import { addUsage } from '../../../lib/chat/tui/usage.mjs';
import { isVisible } from '../../../lib/chat/transparency.mjs';

export function createTurnState() {
  return {
    assistant: '',
    thinking: '',
    tools: [],
    plan: [],
    route: [],
    permissions: [],
    error: null,
    rendered: false,
    stopReason: null,
    lastUsage: null,
  };
}

// Apply one normalized event, mutating the turn state in place and returning it.
// `session.usage` is accumulated through the shared usage helper so the panel and
// the `/usage` command report identical numbers.

export function applyTurnEvent(state, event, { session = null } = {}) {
  switch (event?.type) {
    case 'text':
      state.assistant += event.text || '';
      state.rendered = true;
      break;
    case 'thinking':
      state.thinking += event.text || '';
      state.rendered = true;
      break;
    case 'plan':
      state.plan = Array.isArray(event.entries) ? event.entries : [];
      state.rendered = true;
      break;
    case 'tool_call': {
      state.tools.push({ id: event.id, title: event.title || event.kind || 'tool', status: 'pending' });
      state.rendered = true;
      break;
    }
    case 'tool_update': {
      const existing = state.tools.find((t) => t.id === event.id);
      if (existing) existing.status = event.status || existing.status;
      else state.tools.push({ id: event.id, title: event.id || 'tool', status: event.status || 'pending' });
      state.rendered = true;
      break;
    }
    case 'usage':
      if (session) addUsage(session.usage, event);
      state.lastUsage = event;
      break;
    case 'permission': {
      const title = event.toolCall?.title || event.toolCall?.callID || 'tool';
      state.permissions.push({ title, detail: event.options?.length ? `${event.options.length} options` : 'decision' });
      state.rendered = true;
      break;
    }
    case 'error':
      state.error = event.message || 'error';
      state.rendered = true;
      break;
    case 'done':
      state.stopReason = event.stopReason || 'end_turn';
      break;
    default:
      break;
  }
  return state;
}

// Drive one prompt turn to completion, invoking onUpdate after each applied event
// so a renderer can repaint. Returns the final turn state.

export async function runTurnInto(driver, text, opts, { session = null, layers = null, onUpdate = () => {} } = {}) {
  const state = createTurnState();
  for await (const event of driver.prompt(text, opts)) {
    if (layers && !isVisible(event, layers)) continue;
    applyTurnEvent(state, event, { session });
    onUpdate(state, event);
  }
  return state;
}
