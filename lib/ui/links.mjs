/**
 * lib/ui/links.mjs — shared OSC-8 hyperlink layer for every construct surface.
 *
 * Canonical link authority for CLI output and generated adapter diagnostics.
 * Renders repo-relative paths and URLs as clickable terminal links (OSC-8) when
 * the stream supports them, and always keeps the raw path/URL as the visible
 * label so terminals that ignore OSC-8 (notably macOS Terminal.app) can still
 * Cmd-click the visible text via their own path/URL detection. Falls back to
 * colored text when links are disabled.
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
  /(^|[\s(,])(`?)((?:\.cx\/|docs\/|inbox\/|skills\/|rules\/|lib\/|templates\/|specialists\/|tests\/|platforms\/|personas\/|schemas\/)?[\w][\w./-]*\.(?:md|mdx|json|mjs|ts|tsx|yml|yaml)|construct\.config\.json|package\.json|[A-Z][A-Z0-9_]*\.md)(`?)(?=$|[\s),.:;])/g;

const URL_PATTERN = /\bhttps?:\/\/[^\s<>()\][]+[^\s<>()\][.,;:!?'"]/g;

export function terminalLinksEnabled(env = process.env, { plain = false, stream = process.stdout } = {}) {
  if (plain || env.NO_COLOR === '1' || env.CX_PLAIN_COPY === '1') return false;
  if (env.CX_LINKS === '0') return false;
  if (stream?.isTTY) return true;
  if (env.TERM_PROGRAM === 'vscode' || env.TERM_PROGRAM === 'cursor' || env.WT_SESSION) return true;
  return false;
}

export function fileUriForPath(filePath, { cwd = process.cwd() } = {}) {
  const abs = path.isAbsolute(filePath) ? filePath : path.resolve(cwd, filePath);
  return pathToFileURL(abs).href;
}

// OSC-8 wraps a visible label with an invisible href. Terminals that honor the
// sequence make the label clickable; terminals that ignore it (Terminal.app)
// simply print the label — so callers must pass a label that is itself a
// clickable string (a raw path or URL), never a friendly title that hides it.

export function formatTerminalLink(label, href, colors, { enabled = true } = {}) {
  const styled = `${colors?.link || ''}${label}${colors?.reset || ''}`;
  if (!enabled || !href) return styled;
  return `${OSC8_OPEN}${href}${OSC8_MID}${styled}${OSC8_CLOSE}`;
}

export function formatPathLink(relPath, colors, { cwd = process.cwd(), enabled = true } = {}) {
  const display = relPath.replace(/^`/, '').replace(/`$/, '');
  const abs = path.resolve(cwd, display);
  const href = fileUriForPath(abs, { cwd });
  return formatTerminalLink(display, href, colors, { enabled });
}

// A bare URL is its own visible label, so OSC-8 terminals get one-click and
// Terminal.app's URL detection still works on the printed text.

export function formatUrlLink(url, colors, { enabled = true } = {}) {
  return formatTerminalLink(url, url, colors, { enabled });
}

// A titled link ([text](href)) must keep the destination visible for terminals
// that drop OSC-8: render the title as the clickable label, then append the raw
// destination so it is both readable and Cmd-clickable everywhere.

export function formatTitledLink(label, href, colors, { enabled = true, display = href } = {}) {
  if (!label || label === display) {
    return formatTerminalLink(display, href, colors, { enabled });
  }
  const linked = formatTerminalLink(label, href, colors, { enabled });
  const tail = `${colors?.dim || ''} (${display})${colors?.reset || ''}`;
  return `${linked}${tail}`;
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

export function linkifyUrls(text, colors, { enabled = true } = {}) {
  if (!enabled || text == null) return String(text ?? '');
  return String(text).replace(URL_PATTERN, (url) => formatUrlLink(url, colors, { enabled }));
}

// Linkify both repo paths and URLs in one pass; URLs first so a URL containing
// a path-like suffix is not split by the path matcher.

export function applyLinks(text, colors, { cwd = process.cwd(), enabled = true } = {}) {
  if (!enabled || !text) return String(text ?? '');
  return applyPathLinks(linkifyUrls(text, colors, { enabled }), colors, { cwd, enabled });
}

export function writeLinkedLine(output, line, colors, { cwd, enabled, prefix = '' } = {}) {
  const body = applyLinks(line, colors, { cwd, enabled });
  output.write(prefix ? `${prefix}${body}\n` : `${body}\n`);
}
