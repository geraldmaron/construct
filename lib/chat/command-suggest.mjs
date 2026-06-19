/**
 * lib/chat/command-suggest.mjs — slash-command autocomplete for construct chat.
 *
 * Pure matching helpers shared by the Ink footer (ghost completion + Tab) and
 * tests. No I/O; command names mirror lib/chat/commands.mjs HELP entries.
 */

export const SLASH_COMMANDS = Object.freeze([
  '/help',
  '/model',
  '/models',
  '/free',
  '/set',
  '/settings',
  '/layers',
  '/usage',
  '/oracle',
  '/host',
  '/clear',
  '/inspect',
  '/export',
  '/exit',
]);

export const SETTING_KEYS = Object.freeze([
  'thinking', 'path', 'specialists', 'tools', 'observability',
  'permission', 'sandbox', 'model', 'ascii', 'inspector',
]);

export function slashCommandMatches(input) {
  const trimmed = String(input || '').trimStart();
  if (!trimmed.startsWith('/')) return [];
  const token = trimmed.split(/\s+/)[0].toLowerCase();
  if (!token || token === '/') return [...SLASH_COMMANDS];
  return SLASH_COMMANDS.filter((cmd) => cmd.startsWith(token));
}

export function slashCommandGhost(input) {
  const matches = slashCommandMatches(input);
  if (!matches.length) return '';
  const trimmed = String(input || '').trimStart();
  const token = trimmed.split(/\s+/)[0];
  const best = matches.find((cmd) => cmd.startsWith(token.toLowerCase())) || matches[0];
  if (best.length <= token.length) return '';
  return best.slice(token.length);
}

export function completeSlashCommand(input) {
  const trimmed = String(input || '').trimStart();
  if (!trimmed.startsWith('/')) return input;
  const parts = trimmed.split(/\s+/);
  const token = parts[0];
  const matches = slashCommandMatches(token);
  if (!matches.length) return input;
  const lower = token.toLowerCase();
  const exact = matches.find((cmd) => cmd === lower);
  const best = exact || matches.find((cmd) => cmd.startsWith(lower)) || matches[0];
  const rest = parts.slice(1).join(' ');
  const completed = rest ? `${best} ${rest}` : `${best} `;
  const prefix = input.startsWith(' ') ? input.slice(0, input.indexOf('/')) : '';
  return `${prefix}${completed}`;
}

export function cycleSlashCommand(input, direction = 1) {
  const matches = slashCommandMatches(input);
  if (!matches.length) return input;
  const trimmed = String(input || '').trimStart();
  const token = trimmed.split(/\s+/)[0].toLowerCase();
  const idx = Math.max(0, matches.findIndex((cmd) => cmd.startsWith(token)));
  const next = matches[(idx + direction + matches.length) % matches.length];
  const prefix = input.startsWith(' ') ? input.slice(0, input.indexOf('/')) : '';
  return `${prefix}${next} `;
}

export function setKeyMatches(input) {
  const trimmed = String(input || '').trimStart();
  const m = trimmed.match(/^\/set\s+(\S*)$/i);
  if (!m) return [];
  const partial = (m[1] || '').toLowerCase();
  if (!partial) return [...SETTING_KEYS];
  return SETTING_KEYS.filter((k) => k.startsWith(partial));
}

export function completeSetKey(input) {
  const trimmed = String(input || '').trimStart();
  const m = trimmed.match(/^\/set\s+(\S*)$/i);
  if (!m) return input;
  const partial = m[1] || '';
  const matches = setKeyMatches(input);
  if (!matches.length) return input;
  const best = matches.find((k) => k.startsWith(partial.toLowerCase())) || matches[0];
  return `/set ${best} `;
}

export function commandSuggestHint(input) {
  if (!String(input || '').trimStart().startsWith('/')) return '';
  const cmdMatches = slashCommandMatches(input);
  if (cmdMatches.length && !input.trim().includes(' ')) {
    return cmdMatches.slice(0, 6).join('  ');
  }
  const setMatches = setKeyMatches(input);
  if (setMatches.length) return setMatches.slice(0, 8).join('  ');
  return '';
}

export function applyTabCompletion(input) {
  const setDone = completeSetKey(input);
  if (setDone !== input) return setDone;
  return completeSlashCommand(input);
}

export function isSlashOnlyInput(input) {
  const trimmed = String(input || '').trimStart();
  return trimmed.startsWith('/') && !trimmed.includes(' ');
}
