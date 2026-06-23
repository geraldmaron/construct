/**
 * lib/chat/tui/turn-present.mjs — re-exports shared chat presenters for TUI.
 *
 * Implementation lives in lib/chat/present.mjs so Ink, linear, and web share
 * one formatting source.
 */

export {
  summarizeToolCalls,
  summarizeSources,
  formatRefsInline,
  formatSourceToolCounts,
  contextRows,
  splitSourceLines,
  toolGroupLabel,
  formatRouteStrip,
  formatRouteLogLine,
} from '../present.mjs';
