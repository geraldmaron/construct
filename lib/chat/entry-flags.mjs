/**
 * lib/chat/entry-flags.mjs — flags for bare `construct` chat entry.
 *
 * Shared by lib/chat/cli.mjs and lib/completions.mjs so shell tab completion
 * matches the launcher.
 */

export const CHAT_ENTRY_FLAGS = [
  '--help',
  '-h',
  '--all',
  '-a',
  '--version',
  '-V',
  '--list',
  '--plain',
  '--accessible',
  '--window',
  '--no-window',
  '--quiet',
  '--free',
  '--ascii',
  '--no-banner',
  '--resume',
  '--no-thinking',
  '--no-path',
  '--no-specialists',
  '--no-tools',
  '--no-observability',
  '--model',
  '--demo',
];
