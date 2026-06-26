/**
 * lib/chat/tui/terminal-chrome.mjs — structured panels, badges, and session chrome.
 *
 * Box-drawn route panels, session headers, branded banner, farewell summary, and
 * role labels for the linear chat renderer. Falls back to plain labeled rows when
 * NO_COLOR or non-TTY so meaning never depends on borders alone.
 */

import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { contextRows, routeLabelColumn } from '../present.mjs';
import { formatDuration } from './session-summary.mjs';
import { formatTerminalLink, terminalLinksEnabled } from './terminal-links.mjs';
import { getInstalledVersion } from '../../version.mjs';

const COMPACT_BANNER = [
  ' ██████╗ ██████╗ ███╗   ██╗███████╗████████╗██████╗ ██╗   ██╗ ██████╗████████╗',
  '██╔════╝██╔═══██╗████╗  ██║██╔════╝╚══██╔══╝██╔══██╗██║   ██║██╔════╝╚══██╔══╝',
  '██║     ██║   ██║██╔██╗ ██║███████╗   ██║   ██████╔╝██║   ██║██║        ██║   ',
  '██║     ██║   ██║██║╚██╗██║╚════██║   ██║   ██╔══██╗██║   ██║██║        ██║   ',
  '╚██████╗╚██████╔╝██║ ╚████║███████║   ██║   ██║  ██║╚██████╔╝╚██████╗   ██║   ',
  ' ╚═════╝ ╚═════╝ ╚═╝  ╚═══╝╚══════╝   ╚═╝   ╚═╝  ╚═╝ ╚═════╝  ╚═════╝   ╚═╝   ',
].join('\n');

const PLAIN_BANNER = 'CONSTRUCT';

const ROUTE_TINT = {
  intent: 'highlight',
  category: 'accentAlt',
  route: 'ok',
  team: 'ok',
  specialists: 'ok',
  handoffs: 'accentAlt',
  escalation: 'warn',
  collab: 'muted',
  doc: 'accentAlt',
  research: 'warn',
  framing: 'warn',
};

function routeTint(colors, label) {
  const key = ROUTE_TINT[label] || 'muted';
  return colors[key] || colors.muted;
}

function panelEnabled(colors) {
  return Boolean(colors.border && colors.border.length);
}

function innerWidth(width) {
  return Math.max(24, Math.min(width - 2, 72));
}

function boxLine(colors, left, fill, right, text = '') {
  return `${colors.border}${left}${fill}${right}${colors.reset}${text}\n`;
}

export function renderUserTurn(output, colors, text, { plain = false } = {}) {
  if (plain || !colors.ok) {
    output.write(`${colors.green}you${colors.reset}\n${text}\n`);
    return;
  }
  output.write(`${colors.ok}${colors.bold}▸ YOU${colors.reset}\n`);
  output.write(`${colors.dim}│${colors.reset} ${colors.text}${text}${colors.reset}\n\n`);
}

export function renderAssistantLabel(output, colors, { plain = false } = {}) {
  if (plain || !colors.highlight) {
    output.write(`${colors.bold}construct${colors.reset}\n`);
    return;
  }
  output.write(`${colors.highlight}${colors.bold}◆ construct${colors.reset}\n`);
}

export function renderRoutePanel(output, colors, turn, layers, { width, plain = false } = {}) {
  const rows = contextRows(turn?.overlay, { layers });
  if (!rows.length) return;

  const labelCol = routeLabelColumn(rows);

  if (plain || !panelEnabled(colors)) {
    output.write(`${colors.dim}  ROUTE${colors.reset}\n`);
    for (const row of rows) {
      const tint = routeTint(colors, row.label);
      output.write(`${colors.dim}    ${row.label.padEnd(labelCol)}${colors.reset} ${tint}${row.value}${colors.reset}\n`);
    }
    output.write('\n');
    return;
  }

  const w = innerWidth(width);
  const title = `${colors.highlight}route${colors.reset}`;
  const topFill = Math.max(0, w - 8);
  output.write(`\n${colors.border}╭─ ${title} ${colors.dim}${'─'.repeat(topFill)}${colors.reset}\n`);
  for (const row of rows) {
    const tint = routeTint(colors, row.label);
    const label = `${colors.muted}${row.label.padEnd(labelCol)}${colors.reset}`;
    const value = `${tint}${row.value}${colors.reset}`;
    output.write(`${colors.border}│${colors.reset} ${label} ${value}\n`);
  }
  output.write(`${colors.border}╰${'─'.repeat(w)}╯${colors.reset}\n\n`);
}

export function renderSectionLabel(output, colors, label, { tint = 'muted', glyph = '▸' } = {}) {
  const c = colors[tint] || colors.muted;
  output.write(`${c}${glyph} ${label}${colors.reset}\n`);
}

function renderStatusCard(output, colors, { host, version, model, pinnedModel, layers, width, plain }) {
  const enabled = Object.entries(layers || {}).filter(([, on]) => on).map(([k]) => k).join(', ') || 'none';
  const w = innerWidth(width);
  const showPinned = pinnedModel && model && pinnedModel !== model;
  const modelLine = showPinned
    ? `${colors.muted}pinned${colors.reset} ${colors.dim}${pinnedModel}${colors.reset}  ${colors.muted}active${colors.reset} ${colors.emphasis}${model}${colors.reset}`
    : model
      ? `${colors.muted}model${colors.reset} ${colors.emphasis}${model}${colors.reset}`
      : null;

  if (plain || !panelEnabled(colors)) {
    output.write(`${colors.bold}construct chat${colors.reset} — ${host}${version ? ` ${colors.dim}(${version})${colors.reset}` : ''}${modelLine ? `  ${modelLine}` : ''}\n`);
    output.write(`${colors.dim}transparency: ${enabled}  ·  /layers · /help · /exit${colors.reset}\n\n`);
    return;
  }

  const meta = [
    host,
    version ? colors.dim + version + colors.reset : null,
    modelLine,
  ].filter(Boolean).join(` ${colors.dim}·${colors.reset} `);

  const topPad = Math.max(0, w - 12);
  output.write(boxLine(colors, '╭─', '─'.repeat(topPad), '╮'));
  if (meta) output.write(`${colors.border}│${colors.reset} ${meta}\n`);
  output.write(`${colors.border}│${colors.reset} ${colors.muted}transparency${colors.reset} ${colors.dim}${enabled}${colors.reset}\n`);
  output.write(boxLine(colors, '╰', '─'.repeat(w), '╯'));
  output.write('\n');
}

export function renderSessionBanner(output, colors, {
  host,
  version,
  model,
  pinnedModel,
  layers,
  width,
  plain = false,
  ascii = false,
  showBanner = true,
} = {}) {
  const installed = getInstalledVersion();
  const ver = version || installed.version;

  if (!showBanner) {
    renderStatusCard(output, colors, { host, version: ver, model, pinnedModel, layers, width, plain: true });
    return;
  }

  if (plain || !panelEnabled(colors)) {
    output.write(`\n\n${colors.bold}${PLAIN_BANNER}${colors.reset} ${colors.dim}v${ver}${colors.reset}\n\n`);
    renderStatusCard(output, colors, { host, version: ver, model, pinnedModel, layers, width, plain: true });
    return;
  }

  const wordmark = colors.scheme === 'light' ? colors.text : colors.emphasis;
  const art = ascii ? PLAIN_BANNER : COMPACT_BANNER;
  output.write('\n\n');
  if (ascii) {
    output.write(`${wordmark}${colors.bold}${PLAIN_BANNER}${colors.reset}\n`);
  } else {
    for (const line of art.split('\n')) {
      output.write(`${wordmark}${line}${colors.reset}\n`);
    }
  }
  output.write(`${colors.bold}${colors.brandAccent}Construct CLI v${ver}${colors.reset}\n\n`);
  renderStatusCard(output, colors, { host, version: ver, model, pinnedModel, layers, width, plain });
}

export function renderSessionFarewell(output, colors, summary, {
  width = 80,
  plain = false,
  env = process.env,
} = {}) {
  if (!summary) return;
  const w = innerWidth(width);
  const linksEnabled = terminalLinksEnabled(env, { plain, stream: output });
  const okGlyph = plain ? 'OK' : '✓';
  const failGlyph = plain ? 'X' : '✗';

  const writeRow = (label, value) => {
    output.write(`${colors.border}│${colors.reset} ${colors.muted}${label.padEnd(14)}${colors.reset} ${value}\n`);
  };

  if (plain || !panelEnabled(colors)) {
    output.write(`\n${colors.brandAccent || colors.bold}Agent powering down. Goodbye!${colors.reset}\n`);
    if (summary.sessionId) output.write(`${colors.muted}Session ID${colors.reset}  ${summary.sessionId}\n`);
    const tc = summary.toolCalls || {};
    output.write(`${colors.muted}Tool calls${colors.reset}   ${tc.total || 0} (${okGlyph} ${tc.completed || 0} ${failGlyph} ${tc.failed || 0})\n`);
    if (summary.successRate != null) {
      output.write(`${colors.muted}Success rate${colors.reset} ${summary.successRate.toFixed(1)}%\n`);
    }
    if (summary.timing?.wallMs != null) {
      output.write(`${colors.muted}Wall time${colors.reset}    ${formatDuration(summary.timing.wallMs)}\n`);
    }
    if (summary.resumeCommand) {
      output.write(`${colors.muted}Resume${colors.reset}       ${summary.resumeCommand}\n`);
    }
    output.write('\n');
    return;
  }

  const topPad = Math.max(0, w - 6);
  output.write(`\n${boxLine(colors, '╭─', '─'.repeat(topPad), '╮').trimEnd()}\n`);
  output.write(`${colors.border}│${colors.reset} ${colors.brandAccent}${colors.bold}Agent powering down. Goodbye!${colors.reset}\n`);
  output.write(`${colors.border}│${colors.reset}\n`);
  output.write(`${colors.border}│${colors.reset} ${colors.bold}Interaction Summary${colors.reset}\n`);
  if (summary.sessionId) {
    writeRow('Session ID', `${colors.highlight}${summary.sessionId}${colors.reset}`);
  }
  const tc = summary.toolCalls || {};
  writeRow(
    'Tool Calls',
    `${colors.emphasis}${tc.total || 0}${colors.reset} (${colors.ok}${okGlyph} ${tc.completed || 0}${colors.reset} ${colors.danger}${failGlyph} ${tc.failed || 0}${colors.reset})`,
  );
  if (summary.successRate != null) {
    writeRow('Success Rate', `${colors.brandAccent}${summary.successRate.toFixed(1)}%${colors.reset}`);
  }
  output.write(`${colors.border}│${colors.reset}\n`);
  output.write(`${colors.border}│${colors.reset} ${colors.bold}Performance${colors.reset}\n`);
  if (summary.timing?.wallMs != null) {
    writeRow('Wall Time', `${colors.highlight}${formatDuration(summary.timing.wallMs)}${colors.reset}`);
  }
  if (summary.timing?.activeMs != null) {
    writeRow('Agent Active', `${colors.highlight}${formatDuration(summary.timing.activeMs)}${colors.reset}`);
  }
  if (summary.timing?.apiMs != null && summary.timing.apiMs > 0) {
    const pct = summary.timing.activeMs > 0
      ? ((summary.timing.apiMs / summary.timing.activeMs) * 100).toFixed(1)
      : '0.0';
    output.write(`${colors.border}│${colors.reset}   ${colors.dim}» API Time:${colors.reset} ${colors.highlight}${formatDuration(summary.timing.apiMs)}${colors.reset} ${colors.dim}(${pct}%)${colors.reset}\n`);
  }
  if (summary.timing?.toolMs != null && summary.timing.toolMs > 0) {
    const pct = summary.timing.activeMs > 0
      ? ((summary.timing.toolMs / summary.timing.activeMs) * 100).toFixed(1)
      : '0.0';
    output.write(`${colors.border}│${colors.reset}   ${colors.dim}» Tool Time:${colors.reset} ${colors.highlight}${formatDuration(summary.timing.toolMs)}${colors.reset} ${colors.dim}(${pct}%)${colors.reset}\n`);
  }
  if (summary.resumeCommand) {
    output.write(`${colors.border}│${colors.reset}\n`);
    output.write(`${colors.border}│${colors.reset} ${colors.muted}To resume this session:${colors.reset}\n`);
    output.write(`${colors.border}│${colors.reset} ${colors.link}${summary.resumeCommand}${colors.reset}\n`);
    if (summary.sessionFile) {
      const href = pathToFileURL(path.resolve(summary.sessionFile)).href;
      const fileLabel = formatTerminalLink(path.basename(summary.sessionFile), href, colors, { enabled: linksEnabled });
      output.write(`${colors.border}│${colors.reset} ${colors.dim}${fileLabel}${colors.reset}\n`);
    }
  }
  output.write(boxLine(colors, '╰', '─'.repeat(w), '╯'));
  output.write('\n');
}

export function renderSessionHeader(output, colors, opts) {
  renderSessionBanner(output, colors, { ...opts, showBanner: false });
}
