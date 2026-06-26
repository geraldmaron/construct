/**
 * lib/chat/tui/terminal-links.mjs — OSC-8 hyperlinks for construct chat output.
 *
 * Renders repo-relative paths and markdown URLs as clickable terminal links when
 * the output stream is a TTY and plain-copy mode is off. Falls back to colored text.
 */

import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const OSC8_OPEN = '\x1b]8;;';
const OSC8_MID = '\x07';
const OSC8_CLOSE = '\x1b]8;;\x07';

export const REPO_PATH_PATTERN =
  /(`?)((?:\.cx\/|docs\/|inbox\/|skills\/|rules\/|lib\/|templates\/|specialists\/|tests\/|platforms\/|personas\/|schemas\/)?[\w][\w./-]*\.(?:md|mdx|json|mjs|ts|tsx|yml|yaml)|construct\.config\.json|package\.json|[A-Z][A-Z0-9_]*\.md)(`?)/g;

const REPO_PATH =
  /(?:^|[\s(,])(`?)((?:\.cx\/|docs\/|inbox\/|skills\/|rules\/|lib\/|templates\/|specialists\/|tests\/|platforms\/|personas\/|schemas\/)?[\w][\w./-]*\.(?:md|mdx|json|mjs|ts|tsx|yml|yaml)|construct\.config\.json|package\.json|[A-Z][A-Z0-9_]*\.md)(`?)(?=$|[\s),.:;])/g;

export function terminalLinksEnabled(env = process.env, { plain = false, stream = process.stdout } = {}) {
  if (plain || env.NO_COLOR === '1' || env.CX_CHAT_PLAIN_COPY === '1') return false;
  if (env.CX_CHAT_LINKS === '0') return false;
  if (stream?.isTTY) return true;
  if (env.TERM_PROGRAM === 'vscode' || env.TERM_PROGRAM === 'cursor' || env.WT_SESSION) return true;
  return false;
}

export function fileUriForPath(filePath, { cwd = process.cwd() } = {}) {
  const abs = path.isAbsolute(filePath) ? filePath : path.resolve(cwd, filePath);
  return pathToFileURL(abs).href;
}

export function formatTerminalLink(label, href, colors, { enabled = true } = {}) {
  const styled = `${colors?.link || ''}${label}${colors?.reset || ''}`;
  if (!enabled || !href) return styled;
  return `${OSC8_OPEN}${href}${OSC8_MID}${styled}${OSC8_CLOSE}`;
}

export function formatPathLink(relPath, colors, { cwd = process.cwd(), enabled = true } = {}) {
  const display = relPath.replace(/^`/, '').replace(/`$/, '');
  let abs = path.resolve(cwd, display);
  if (!fs.existsSync(abs)) abs = path.resolve(cwd, display);
  const href = fileUriForPath(abs);
  return formatTerminalLink(display, href, colors, { enabled });
}

export function linkifyRepoPaths(text, colors, { cwd = process.cwd(), enabled = true } = {}) {
  if (!enabled || text == null) return String(text ?? '');
  const source = String(text);
  return source.replace(REPO_PATH_PATTERN, (full, openTick, relPath, closeTick, offset) => {
    if (offset > 0) {
      const prev = source[offset - 1];
      if (!/[\s(,]/.test(prev)) return full;
    }
    return formatPathLink(`${openTick || ''}${relPath}${closeTick || ''}`, colors, { cwd, enabled });
  });
}

export function applyPathLinks(text, colors, { cwd = process.cwd(), enabled = true } = {}) {
  if (!enabled || !text) return String(text);
  return String(text).replace(REPO_PATH, (match, prefix, openTick, relPath, closeTick) => {
    const linked = formatPathLink(`${openTick || ''}${relPath}${closeTick || ''}`, colors, { cwd, enabled });
    return `${prefix}${linked}`;
  });
}

export function writeLinkedLine(output, line, colors, { cwd, enabled, prefix = '' } = {}) {
  const body = applyPathLinks(line, colors, { cwd, enabled });
  output.write(prefix ? `${prefix}${body}\n` : `${body}\n`);
}
