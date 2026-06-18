/**
 * lib/chat/permission-prompt.mjs — interactive permission decisions for ask mode.
 *
 * Maps user keystrokes and readline answers to the host-agnostic decision
 * vocabulary (allow | allow_always | reject) shared by the permission gate
 * (apps/chat/engine/tools/permission.mjs). Both the Ink overlay and the linear
 * readline prompt use the same parser so behaviour stays identical.
 */

export function formatPermissionQuestion({ tool = 'tool', input = null } = {}) {
  const detail = input && typeof input === 'object'
    ? Object.keys(input).slice(0, 3).join(', ')
    : '';
  const suffix = detail ? ` (${detail})` : '';
  return `Allow "${tool}"${suffix}?  [y] once  [a] always  [n] reject`;
}

export function parsePermissionDecision(raw) {
  const s = String(raw ?? '').trim().toLowerCase();
  if (['a', 'always', 'allow_always', 'all'].includes(s)) return 'allow_always';
  if (['n', 'no', 'reject', 'r', 'deny', '0'].includes(s)) return 'reject';
  if (['y', 'yes', 'allow', 'once', '1', ''].includes(s)) return 'allow';
  return null;
}

export function parsePermissionKey(char) {
  if (!char) return null;
  const c = char.toLowerCase();
  if (c === 'a') return 'allow_always';
  if (c === 'n' || c === 'r') return 'reject';
  if (c === 'y') return 'allow';
  return null;
}
