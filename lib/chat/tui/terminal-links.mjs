/**
 * lib/chat/tui/terminal-links.mjs — compatibility re-export.
 *
 * The OSC-8 hyperlink layer now lives in the shared lib/ui/links.mjs authority
 * spanning the CLI command surface and the chat TUI. This module re-exports it
 * so existing chat imports resolve against that single implementation.
 */

export {
  REPO_PATH_PATTERN,
  terminalLinksEnabled,
  fileUriForPath,
  formatTerminalLink,
  formatPathLink,
  formatUrlLink,
  formatTitledLink,
  linkifyRepoPaths,
  applyPathLinks,
  linkifyUrls,
  applyLinks,
  writeLinkedLine,
} from '../../ui/links.mjs';
