/**
 * lib/export/html-sanitize.mjs — hand-rolled HTML export sanitization (construct-tsyfe.6.6).
 *
 * Trust boundary for direct RichDocument HTML export before embed or serve. No DOMPurify or
 * sanitize-html dependency. Applied to the full serialized HTML string after
 * richDocumentToHtml / standaloneHtmlDocument, including raw-html blocks and link runs.
 *
 * Denylist (removed from output):
 *   - <script>...</script> elements and their contents
 *   - on* event-handler attributes (onclick, onerror, ...)
 *   - href/src values whose scheme is javascript: or data: (case-insensitive, optional whitespace)
 *
 * Allowlist posture: everything else produced by RichDocument serialization or benign inline
 * fragments (e.g. <strong>, <em>, https: links) passes through unchanged.
 */

const SCRIPT_RE = /<script\b[^>]*>[\s\S]*?<\/script>/gi;
const ON_ATTR_RE = /\s(on[a-z][\w-]*)\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+)/gi;
const DANGEROUS_URL_RE = /\s(href|src)\s*=\s*(["']?)\s*(javascript:|data:)[^\s"'<>]*/gi;

export const HTML_EXPORT_SANITIZE_DENYLIST = Object.freeze([
  'script elements',
  'on* event-handler attributes',
  'javascript: and data: URLs in href and src',
]);

export function sanitizeExportedHtml(html) {
  let out = String(html ?? '');
  out = out.replace(SCRIPT_RE, '');
  out = out.replace(ON_ATTR_RE, '');
  out = out.replace(DANGEROUS_URL_RE, (match, attr) => ` ${attr}=""`);
  return out;
}

export function isDangerousUrl(value) {
  const trimmed = String(value ?? '').trim().replace(/^[\s\u0000-\u001F]+/, '');
  return /^(javascript:|data:)/i.test(trimmed);
}
