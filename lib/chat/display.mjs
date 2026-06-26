/**
 * lib/chat/display.mjs — shared chat output formatting for all construct surfaces.
 *
 * Terminal chat, VS Code/Cursor integrated terminals, and other hosts import from
 * here so markdown rendering, path linkification, and JSON suppression stay aligned.
 */

export {
  parseMarkdownLines,
  markdownToPlain,
  markdownToAnsi,
  writeMarkdownAnsi,
} from './tui/markdown.mjs';

export {
  terminalLinksEnabled,
  formatPathLink,
  formatTerminalLink,
  linkifyRepoPaths,
  applyPathLinks,
  fileUriForPath,
} from './tui/terminal-links.mjs';

export {
  formatToolActivityLabel,
  buildToolTickerText,
  toolGroupLabel,
} from './present.mjs';
