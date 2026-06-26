/**
 * lib/chat/thinking-display.mjs — capped thinking summaries for construct chat.
 *
 * Full reasoning is still persisted on the turn block; the terminal shows a short
 * preview so transparency stays opt-in without dumping long model monologues.
 */

import { renderSectionLabel } from './tui/terminal-chrome.mjs';
import { termWidth } from '../term-format.mjs';
import { wrapText } from '../term-format.mjs';

const DEFAULT_MAX_LINES = 3;
const DEFAULT_MAX_CHARS = 280;

export function summarizeThinking(text, { maxLines = DEFAULT_MAX_LINES, maxChars = DEFAULT_MAX_CHARS } = {}) {
  const raw = String(text || '').trim();
  if (!raw) {
    return { preview: '', hidden: false, hiddenLines: 0, totalLines: 0 };
  }

  const lines = raw.split(/\n+/).map((line) => line.trim()).filter(Boolean);
  if (!lines.length) {
    return { preview: '', hidden: false, hiddenLines: 0, totalLines: 0 };
  }

  const previewLines = [];
  let chars = 0;
  for (const line of lines) {
    if (previewLines.length >= maxLines) break;
    const next = chars ? chars + 1 + line.length : line.length;
    if (next > maxChars && previewLines.length) break;
    previewLines.push(line);
    chars = next;
  }

  const hidden = previewLines.length < lines.length || chars < lines.join(' ').length;
  let preview = previewLines.join('\n');
  if (hidden && preview && !preview.endsWith('…')) preview += '…';

  return {
    preview,
    hidden,
    hiddenLines: Math.max(0, lines.length - previewLines.length),
    totalLines: lines.length,
  };
}

export function renderThinkingSummary(output, colors, text, {
  width = termWidth(output),
  plain = false,
  maxLines = DEFAULT_MAX_LINES,
  maxChars = DEFAULT_MAX_CHARS,
} = {}) {
  const summary = summarizeThinking(text, { maxLines, maxChars });
  if (!summary.preview) return;

  renderSectionLabel(output, colors, 'THINKING', { tint: 'muted', glyph: '◇' });
  const wrapped = wrapText(summary.preview, Math.max(24, width - 6));
  for (const line of wrapped.split('\n')) {
    output.write(`${colors.dim}  │ ${line}${colors.reset}\n`);
  }
  if (summary.hidden) {
    const hint = summary.hiddenLines > 0
      ? `${summary.hiddenLines} more line${summary.hiddenLines === 1 ? '' : 's'} hidden`
      : 'reasoning truncated';
    output.write(`${colors.dim}  │ … ${hint} — /set thinking off to hide · full trace in session log${colors.reset}\n`);
  }
  output.write('\n');
}
