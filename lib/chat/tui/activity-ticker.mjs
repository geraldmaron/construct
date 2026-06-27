/**
 * lib/chat/tui/activity-ticker.mjs — in-turn activity zone for construct chat.
 *
 * Paints a fixed 3-row zone (phase, live reasoning strip, tool ticker) with
 * in-place redraw on TTY. Plain/non-TTY streams emit phase lines only.
 */

import { renderAssistantLabel } from './terminal-chrome.mjs';
import { summarizeThinking } from '../thinking-display.mjs';
import { formatToolActivityLabel, buildToolTickerText } from '../present.mjs';
import { linkifyRepoPaths, terminalLinksEnabled } from './terminal-links.mjs';
import {
  clearZoneRows,
  paintZoneRows,
  reserveZoneRows,
} from './reserved-zone.mjs';

export const ACTIVITY_ZONE_ROWS = 3;

const SPINNER = ['\u2839', '\u2838', '\u283c', '\u2834', '\u2826', '\u2827', '\u2807', '\u280f'];

const PHASE_LABELS = Object.freeze({
  contacting: 'contacting model',
  tools: 'using tools',
  composing: 'composing answer',
});

function clipRow(text, width) {
  const plain = String(text || '').replace(/\u001b\[[0-9;]*m/g, '');
  if (plain.length <= width) return text;
  return `${String(text).slice(0, Math.max(8, width - 1))}…`;
}

function phaseRow(phase, colors, spinnerIndex = 0) {
  const label = PHASE_LABELS[phase] || PHASE_LABELS.contacting;
  const spin = SPINNER[spinnerIndex % SPINNER.length];
  return `${colors.dim}  ${spin} ${label}…${colors.reset}`;
}

function thinkingRow(text, colors, width) {
  if (!text?.trim()) return '';
  const wrapped = summarizeThinking(text, { maxLines: 2, maxChars: 100 }).preview;
  if (!wrapped) return '';
  return `${colors.dim}  │ ${clipRow(wrapped, width - 5)}${colors.reset}`;
}

function toolRow(labels, state, colors, { width, cwd, env, plain, output }) {
  const plainText = buildToolTickerText(labels, {
    total: state.toolTotal,
    width,
    inFlight: state.inFlight,
  });
  if (!plainText.trim()) return '';
  const linksEnabled = terminalLinksEnabled(env, { plain, stream: output });
  const linked = linkifyRepoPaths(
    plainText.replace(/^  ▸ /, ''),
    colors,
    { cwd, enabled: linksEnabled },
  );
  return `${colors.warn}  ▸${colors.reset} ${linked}`;
}

export function createActivityTicker(output, colors, {
  plain = false,
  width = 80,
  cwd = process.cwd(),
  env = process.env,
  visibleThinking = 'hidden',
} = {}) {
  let began = false;
  let zoneActive = false;
  let phase = 'contacting';
  let spinnerIndex = 0;
  let spinnerTimer = null;
  let thinkingBuffer = '';
  let lastPlainPhase = null;
  const toolLabels = [];
  let toolTotal = 0;
  let inFlight = null;
  const interactive = Boolean(output?.isTTY) && !plain && env.NO_COLOR !== '1' && env.TERM !== 'dumb';

  const state = () => ({ toolTotal, inFlight });

  const rows = () => {
    const out = [phaseRow(phase, colors, spinnerIndex)];
    if (visibleThinking === 'summary') {
      const row = thinkingRow(thinkingBuffer, colors, width);
      if (row) out.push(row);
      else out.push('');
    } else {
      out.push('');
    }
    const tools = toolRow(toolLabels, state(), colors, { width, cwd, env, plain, output });
    out.push(tools || '');
    while (out.length < ACTIVITY_ZONE_ROWS) out.push('');
    return out.slice(0, ACTIVITY_ZONE_ROWS);
  };

  const repaint = () => {
    if (!interactive || !zoneActive) return;
    paintZoneRows(output, ACTIVITY_ZONE_ROWS, rows(), { abovePrompt: false });
  };

  const startSpinner = () => {
    if (!interactive || spinnerTimer) return;
    spinnerTimer = setInterval(() => {
      spinnerIndex += 1;
      repaint();
    }, 120);
    if (spinnerTimer.unref) spinnerTimer.unref();
  };

  const stopSpinner = () => {
    if (spinnerTimer) {
      clearInterval(spinnerTimer);
      spinnerTimer = null;
    }
  };

  const emitPlainPhase = (next) => {
    if (interactive || lastPlainPhase === next) return;
    lastPlainPhase = next;
    output.write(`${colors.dim}  ${PHASE_LABELS[next] || next}…${colors.reset}\n`);
  };

  return {
    began: () => began,

    begin() {
      if (began) return;
      began = true;
      renderAssistantLabel(output, colors, { plain });
      if (interactive) {
        reserveZoneRows(output, ACTIVITY_ZONE_ROWS, { plain, occupyCurrent: true });
        zoneActive = true;
        startSpinner();
        repaint();
      } else {
        emitPlainPhase('contacting');
      }
    },

    setPhase(next) {
      if (!began || !next) return;
      phase = next;
      if (interactive) repaint();
      else emitPlainPhase(next);
    },

    // Write a permanent transcript line while the live zone is active: blank the
    // zone, write the line into the reclaimed space, then rebuild the zone under
    // the line so the spinner keeps a clean fixed footprint rather than colliding
    // with direct writes.

    emit(text) {
      const body = text == null ? '' : String(text);
      if (!interactive || !zoneActive) {
        output.write(body.endsWith('\n') ? body : `${body}\n`);
        return;
      }
      stopSpinner();
      clearZoneRows(output, ACTIVITY_ZONE_ROWS, { abovePrompt: false });
      output.write(body.endsWith('\n') ? body : `${body}\n`);
      reserveZoneRows(output, ACTIVITY_ZONE_ROWS, { plain, occupyCurrent: true });
      startSpinner();
      repaint();
    },

    pushThinking(delta = '') {
      if (!began || visibleThinking !== 'summary' || !delta) return;
      thinkingBuffer += delta;
      if (interactive) repaint();
    },

    onToolCall(event) {
      if (!began) return;
      const label = formatToolActivityLabel({
        title: event?.title || event?.kind,
        input: event?.input,
      });
      inFlight = label;
      phase = 'tools';
      if (interactive) repaint();
      else emitPlainPhase('tools');
    },

    onToolDone(event, title) {
      if (!began) return;
      const label = formatToolActivityLabel({
        title: title || event?.title || event?.kind,
        input: event?.input,
        content: event?.content,
      });
      if (label) toolLabels.push(label);
      toolTotal += 1;
      inFlight = null;
      phase = 'tools';
      if (interactive) repaint();
    },

    onComposing() {
      if (!began) return;
      phase = 'composing';
      inFlight = null;
      if (interactive) repaint();
      else emitPlainPhase('composing');
    },

    finish() {
      stopSpinner();
      if (interactive && zoneActive) {
        clearZoneRows(output, ACTIVITY_ZONE_ROWS, { abovePrompt: false });
        zoneActive = false;
      }
    },
  };
}
