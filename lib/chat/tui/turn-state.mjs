/**
 * lib/chat/tui/turn-state.mjs — pure turn-state reduction for chat renderers.
 *
 * Reduces normalized driver events into renderable turn state with no React import.
 * Shared by linear mode, owned-loop SSE fallback, and functional tests.
 */

import { addUsage } from './usage.mjs';
import { isVisible } from '../transparency.mjs';

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
      state.tools.push({
        id: event.id,
        title: event.title || event.kind || 'tool',
        status: 'pending',
        input: event.input ?? null,
      });
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

export async function runTurnInto(driver, text, opts, { session = null, layers = null, onUpdate = () => {} } = {}) {
  const state = createTurnState();
  for await (const event of driver.prompt(text, opts)) {
    if (layers && !isVisible(event, layers)) continue;
    applyTurnEvent(state, event, { session });
    onUpdate(state, event);
  }
  return state;
}
