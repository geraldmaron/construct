/**
 * lib/chat/command-suggest.mjs — slash-command autocomplete for construct chat.
 *
 * Single source of truth for the advertised commands and their one-line actions,
 * shared by the web composer dropdown, the Ink footer (ghost completion + Tab),
 * and tests. No I/O. `/models` is intentionally absent here — it stays a hidden
 * alias of `/model` in the command handlers so only one model command is shown.
 */

export const SLASH_COMMAND_INFO = Object.freeze([
  { cmd: '/help', desc: 'list every command and what it does' },
  { cmd: '/model', desc: 'show or pick the model (opens a searchable picker)' },
  { cmd: '/free', desc: 'switch to OpenRouter free-router mode' },
  { cmd: '/set', desc: 'change a setting — /set <key> <on|off|value>' },
  { cmd: '/settings', desc: 'show the current settings' },
  { cmd: '/layers', desc: 'show transparency layers (Ctrl+1–5 to toggle)' },
  { cmd: '/usage', desc: 'session token and cost breakdown' },
  { cmd: '/oracle', desc: 'Oracle overseer verdict and pending approvals' },
  { cmd: '/host', desc: 'show the active engine / host' },
  { cmd: '/inspect', desc: 'toggle the inspector panel' },
  { cmd: '/export', desc: 'save the answer to markdown — /export [last|session]' },
  { cmd: '/clear', desc: 'clear the conversation' },
  { cmd: '/exit', desc: 'quit (terminal only)' },
]);

export const SLASH_COMMANDS = Object.freeze(SLASH_COMMAND_INFO.map((c) => c.cmd));

export const SETTING_KEY_INFO = Object.freeze([
  { key: 'thinking', desc: 'show model reasoning inline' },
  { key: 'path', desc: 'show the routing path' },
  { key: 'specialists', desc: 'show the specialist chain' },
  { key: 'tools', desc: 'show tool calls' },
  { key: 'observability', desc: 'show usage + telemetry' },
  { key: 'permission', desc: 'ask | allow_once | allow_always | reject' },
  { key: 'sandbox', desc: 'read-only | workspace-write | danger-full-access' },
  { key: 'model', desc: 'set the model id' },
  { key: 'ascii', desc: 'ASCII-only glyphs (on|off)' },
  { key: 'inspector', desc: 'inspector panel (on|off|auto)' },
]);

export const SETTING_KEYS = Object.freeze(SETTING_KEY_INFO.map((s) => s.key));

const DESC_BY_CMD = new Map(SLASH_COMMAND_INFO.map((c) => [c.cmd, c.desc]));
const DESC_BY_KEY = new Map(SETTING_KEY_INFO.map((s) => [s.key, s.desc]));

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

// Rich suggestions for the composer dropdown: each entry carries the token to
// complete plus its one-line action. Returns `/set` keys while the user is
// typing a setting, otherwise the matching commands. Empty once an argument is
// being typed for a non-/set command, so the dropdown gets out of the way.

export function slashCommandSuggestions(input, { limit = 8 } = {}) {
  const raw = String(input || '');
  const trimmed = raw.trimStart();
  if (!trimmed.startsWith('/')) return { kind: 'none', items: [] };

  if (/^\/set(\s|$)/i.test(trimmed)) {
    const keys = setKeyMatches(trimmed);
    if (keys.length) {
      return {
        kind: 'set',
        items: keys.slice(0, limit).map((key) => ({ value: key, desc: DESC_BY_KEY.get(key) || '' })),
      };
    }
    return { kind: 'none', items: [] };
  }

  if (trimmed.includes(' ')) return { kind: 'none', items: [] };

  const matches = slashCommandMatches(trimmed);
  return {
    kind: 'command',
    items: matches.slice(0, limit).map((cmd) => ({ value: cmd, desc: DESC_BY_CMD.get(cmd) || '' })),
  };
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
