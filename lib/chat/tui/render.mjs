/**
 * lib/chat/tui/render.mjs — accessible, structured terminal rendering for `construct chat`.
 *
 * Renders the normalized driver event stream as a grouped, screen-reader-friendly
 * transcript. Every section carries a text label (`[thinking]`, `[tool]`, `construct`,
 * `[usage]`), so meaning never depends on color — color is enhancement only and is
 * gated by term-format.mjs (NO_COLOR, non-TTY, TERM=dumb). Thinking renders as a
 * dimmed gutter aside, the answer as a wrapped block, tools as a status-aligned list,
 * and each turn closes with a truthful token/cost footer.
 *
 * StreamBlock word-wraps streamed deltas incrementally (buffering only a trailing
 * partial word) so output stays clean at the terminal width while still streaming.
 * A live status line shows "working" on a TTY until the first content arrives and is
 * erased before anything is written; on non-TTY streams it is a no-op so piped output
 * stays plain. When a turn yields no content, a labeled notice explains likely causes.
 *
 * renderTurn drives one prompt turn and is pure with respect to input (tested against
 * a mock driver); runChatLoop adds the interactive readline REPL and slash commands.
 */

import { createInterface } from 'node:readline';
import { termWidth } from '../../term-format.mjs';
import { resolveChatColors } from './presentation.mjs';
import { isVisible, planTurn } from '../transparency.mjs';
import { buildPlanContext } from '../session-context.mjs';
import { handleOpenRouterFailure, parseOpenRouterError } from '../openrouter-fallback.mjs';
import { formatUsageFooter, addUsage } from './usage.mjs';
import { formatPermissionQuestion, parsePermissionDecision } from '../permission-prompt.mjs';
import {
  createTurnBlock, applyOverlayToTurn, applyEventToTurn, finalizeTurn,
} from './turn-block.mjs';
import {
  summarizeSources, splitSourceLines, contextRows, summarizeToolCalls, toolGroupLabel,
} from './turn-present.mjs';
import { markdownToPlain } from './markdown.mjs';

function logEvent(persist, event) {
  if (!persist) return;
  try {
    if (typeof persist === 'function') persist(event);
    else if (typeof persist.event === 'function') persist.event(event);
  } catch { /* persistence is best-effort */ }
}

function logTranscript(persist, role, text) {
  if (!persist || !text) return;
  try {
    if (typeof persist.transcript === 'function') persist.transcript(role, text);
  } catch { /* persistence is best-effort */ }
}

function visibleLen(s) {
  return s.replace(/\u001b\[[0-9;]*m/g, '').length;
}

// Incremental word-wrapper for streamed text. Holds a trailing partial word until a
// boundary arrives so deltas that split mid-word still wrap cleanly at `width`.

class StreamBlock {
  constructor(output, { width, prefix = '', color = '', reset = '' }) {
    this.o = output;
    this.width = width;
    this.prefix = prefix;
    this.prefixLen = visibleLen(prefix);
    this.color = color;
    this.reset = reset;
    this.col = 0;
    this.word = '';
    this.started = false;
  }

  _open() {
    if (this.started) return;
    this.started = true;
    this.o.write(this.color + this.prefix);
    this.col = this.prefixLen;
  }

  _newline() {
    this.o.write(`${this.reset}\n${this.color}${this.prefix}`);
    this.col = this.prefixLen;
  }

  _emitWord() {
    if (!this.word) return;
    this._open();
    const len = this.word.length;
    if (this.col > this.prefixLen && this.col + len > this.width) this._newline();
    this.o.write(this.word);
    this.col += len;
    this.word = '';
  }

  push(text) {
    for (const ch of text) {
      if (ch === '\n') { this._emitWord(); this._open(); this._newline(); }
      else if (ch === ' ' || ch === '\t') { this._emitWord(); if (this.col < this.width) { this.o.write(' '); this.col += 1; } }
      else this.word += ch;
    }
  }

  end() {
    this._emitWord();
    if (this.started) this.o.write(`${this.reset}\n`);
  }
}

const SPINNER = ['\u2839', '\u2838', '\u283c', '\u2834', '\u2826', '\u2827', '\u2807', '\u280f'];

// A transient "working" line for interactive terminals. No-op on non-TTY streams so
// piped/redirected output never carries spinner control codes.

function createStatus(output, colors, env) {
  const active = Boolean(output.isTTY) && !env.NO_COLOR && env.TERM !== 'dumb';
  let timer = null;
  let shown = false;
  let i = 0;
  const draw = () => { output.write(`\r${colors.dim}${SPINNER[i = (i + 1) % SPINNER.length]} working\u2026${colors.reset}\u001b[K`); };
  return {
    start(label = 'working') {
      if (!active) return;
      shown = true;
      output.write(`\r${colors.dim}${SPINNER[0]} ${label}\u2026${colors.reset}\u001b[K`);
      timer = setInterval(draw, 120);
      if (timer.unref) timer.unref();
    },
    stop() {
      if (timer) { clearInterval(timer); timer = null; }
      if (shown) { output.write('\r\u001b[K'); shown = false; }
    },
  };
}

function planGlyph(status) {
  if (status === 'completed') return '\u2713';
  if (status === 'in_progress') return '\u25b8';
  return '\u2022';
}

function toolStatusLabel(status) {
  if (status === 'completed') return 'done';
  if (status === 'failed') return 'failed';
  if (status === 'in_progress') return 'running';
  return status || 'pending';
}

function plainCopyMode(env = process.env, flags = {}) {
  return Boolean(flags?.plain || env.CX_CHAT_PLAIN_COPY === '1');
}

function renderRule(output, colors, width, plain) {
  if (plain) return;
  output.write(`${colors.dim}${'\u2500'.repeat(Math.min(width, 52))}${colors.reset}\n`);
}

function renderRoutePhase(output, colors, turn, layers) {
  const rows = contextRows(turn.overlay, { layers });
  if (!rows.length) return;

  output.write(`${colors.dim}  ROUTE${colors.reset}\n`);
  for (const row of rows) {
    const tint = row.label === 'research' ? colors.yellow : row.label === 'route' ? colors.cyan : colors.dim;
    output.write(`${colors.dim}    ${row.label.padEnd(10)}${colors.reset}${tint}${row.value}${colors.reset}\n`);
  }
  output.write('\n');
}

function renderSourcesPhase(output, colors, turn) {
  const src = summarizeSources(turn.sources || []);
  if (!src.total) return;

  const toolCounts = Object.entries(src.byTool).map(([t, n]) => `${t} ${n}`).join('  ');
  output.write(`${colors.dim}  SOURCES${colors.reset}\n`);
  output.write(`${colors.dim}    ${'count'.padEnd(10)}${colors.reset}${colors.dim}${src.total} consulted${toolCounts ? ` (${toolCounts})` : ''}${colors.reset}\n`);
  const split = splitSourceLines(src.refs, { limit: 4 });
  for (const line of split.lines) {
    if (line === 'none yet') continue;
    output.write(`${colors.dim}              ${line}${colors.reset}\n`);
  }
  if (split.hidden > 0) output.write(`${colors.dim}              +${split.hidden} more${colors.reset}\n`);
  output.write('\n');
}

function renderGroupedTools(output, colors, tools) {
  if (!tools?.length) return;
  const groups = summarizeToolCalls(tools);
  output.write(`${colors.dim}  TOOLS${colors.reset} ${tools.length} call${tools.length === 1 ? '' : 's'}, ${groups.length} kind${groups.length === 1 ? '' : 's'}\n`);
  for (const g of groups) {
    const tint = g.status === 'failed' ? colors.red : colors.green;
    output.write(`${colors.dim}  ${tint}${toolGroupLabel(g)}${colors.reset}\n`);
  }
  output.write('\n');
}

export async function renderTurn({
  driver, text, layers, output, colors, env = process.env, persist = null,
  promptOptions = {}, session = null, cwd = process.cwd(), turnBlocks = [],
  plain = false, retryAttempt = 0,
}) {
  const width = termWidth(output);
  const turn = createTurnBlock(text);

  if (retryAttempt === 0) {
    output.write(`${colors.green}you${colors.reset}\n${text}\n`);
  }

  let overlay = promptOptions.turnOverlay ?? null;
  if (retryAttempt === 0 && (layers.specialists || layers.path)) {
    overlay = overlay || await planTurn(text, {
      env,
      context: buildPlanContext({ session, cwd, turnBlocks, text }),
    });
    if (overlay) applyOverlayToTurn(turn, overlay);
    renderRoutePhase(output, colors, turn, layers);
  }

  const status = createStatus(output, colors, env);
  status.start();

  let section = null;
  let block = null;
  let rendered = false;
  let lastUsage = null;
  let stopReason = null;
  let assistantText = '';
  let errorMessage = null;
  const toolTitles = new Map();

  const closeBlock = () => { if (block) { block.end(); block = null; } section = null; };

  for await (const event of driver.prompt(text, { ...promptOptions, model: promptOptions.model || session?.model, turnOverlay: overlay })) {
    logEvent(persist, event);
    applyEventToTurn(turn, event);
    if (!isVisible(event, layers)) continue;

    switch (event.type) {
      case 'thinking':
        status.stop();
        if (section !== 'thinking') {
          closeBlock();
          output.write(`${colors.dim}  THINKING${colors.reset}\n`);
          block = new StreamBlock(output, { width, prefix: '  \u2502 ', color: colors.dim, reset: colors.reset });
          section = 'thinking';
        }
        block.push(event.text);
        rendered = true;
        break;

      case 'text':
        status.stop();
        if (section !== 'message') {
          closeBlock();
          output.write(`${colors.bold}construct${colors.reset}\n`);
          block = new StreamBlock(output, { width, prefix: '', color: '', reset: colors.reset });
          section = 'message';
        }
        block.push(event.text);
        assistantText += event.text || '';
        rendered = true;
        break;

      case 'plan':
        status.stop(); closeBlock();
        output.write(`${colors.cyan}[plan]${colors.reset}\n`);
        for (const entry of event.entries || []) output.write(`  ${planGlyph(entry.status)} ${entry.content}\n`);
        rendered = true;
        break;

      case 'tool_call':
        status.stop(); closeBlock();
        if (event.title || event.kind) toolTitles.set(event.id, event.title || event.kind);
        rendered = true;
        break;

      case 'tool_update': {
        status.stop(); closeBlock();
        rendered = true;
        break;
      }

      case 'usage':
        lastUsage = event;
        if (session) addUsage(session.usage, event);
        break;

      case 'permission':
        status.stop(); closeBlock();
        output.write(`${colors.yellow}[permission]${colors.reset} ${event.toolCall?.title || event.toolCall?.callID || 'tool'} \u2014 ${promptOptions.permissionMode === 'reject' ? 'rejected' : promptOptions.permissionMode === 'allow_always' ? 'allowed (always)' : 'allowed (once)'}\n`);
        break;

      case 'error':
        status.stop(); closeBlock();
        errorMessage = event.message;
        output.write(`${colors.red}[error]${colors.reset} ${parseOpenRouterError(event.message).summary}\n`);
        rendered = true;
        break;

      case 'done':
        stopReason = event.stopReason;
        break;

      default:
        break;
    }
  }

  closeBlock();
  status.stop();

  finalizeTurn(turn);

  if (turn.tools?.length && layers?.tools !== false) {
    renderGroupedTools(output, colors, turn.tools);
  }

  renderSourcesPhase(output, colors, turn);

  if (!rendered && turn.assistant) {
    output.write(`${colors.bold}construct${colors.reset}\n`);
    output.write(`${markdownToPlain(turn.assistant, { width })}\n`);
    rendered = true;
  }

  if (!rendered) {
    output.write(`${colors.dim}[no output] the host returned no content \u2014 check that a text model is selected (/model) and the host is authenticated${colors.reset}\n`);
  }

  for (const notice of turn.notices || []) {
    output.write(`${colors.yellow}[notice]${colors.reset} ${notice}\n`);
  }

  if (lastUsage && layers.observability) {
    renderRule(output, colors, width, plain);
    output.write(`${colors.dim}  USAGE${colors.reset} ${formatUsageFooter(lastUsage, colors).replace(/^\[usage\]\s*/, '')}\n`);
  }

  if (persist?.transcriptBlock) {
    try { persist.transcriptBlock(turn); } catch { /* best-effort */ }
  } else if (assistantText) {
    logTranscript(persist, 'construct', assistantText);
  }

  return { stopReason, usage: lastUsage, rendered, assistant: assistantText || turn.assistant, error: errorMessage };
}

export async function renderTurnWithFallback(opts) {
  let model = opts.promptOptions?.model || opts.session?.model;
  let notice = null;

  for (let attempt = 0; attempt < 3; attempt++) {
    const result = await renderTurn({
      ...opts,
      promptOptions: { ...opts.promptOptions, model, turnOverlay: opts.promptOptions?.turnOverlay },
      retryAttempt: attempt,
    });
    if (!result.error && result.stopReason !== 'error') {
      return { ...result, model, notice };
    }

    const fallback = await handleOpenRouterFailure({
      session: opts.session,
      error: result.error,
      env: opts.env,
      currentModel: model,
    });
    if (!fallback) return { ...result, model, notice };

    model = fallback.modelId;
    if (opts.session) opts.session.model = model;
    notice = fallback.notice;
    if (opts.output && notice) {
      opts.output.write(`${opts.colors?.yellow || ''}[notice]${opts.colors?.reset || ''} ${notice}\n`);
    }
  }

  return renderTurn({ ...opts, promptOptions: { ...opts.promptOptions, model } });
}

function writeHeader({ output, colors, host, version, model, layers }) {
  const enabled = Object.entries(layers).filter(([, on]) => on).map(([k]) => k).join(', ') || 'none';
  output.write(`${colors.bold}construct chat${colors.reset} \u2014 ${host}${version ? ` ${colors.dim}(${version})${colors.reset}` : ''}${model ? `  ${colors.dim}model:${colors.reset} ${model}` : ''}\n`);
  output.write(`${colors.dim}transparency: ${enabled}  \u00b7  /help for commands, /exit to quit${colors.reset}\n\n`);
}

export async function runChatLoop({
  driver, host, version, layers, input = process.stdin, output = process.stdout, env = process.env,
  persist = null, commands = null, session = null, notices = [], permissionBridge = null,
  initialTranscript = [], initialTurnBlocks = [], cwd = process.cwd(), flags = {},
}) {
  const colors = resolveChatColors({ stream: output, env, configTheme: session?.ui?.theme });
  const plain = plainCopyMode(env, flags);
  const turnBlocks = [...(initialTurnBlocks || [])];
  writeHeader({ output, colors, host, version, model: session?.model, layers });
  for (const notice of notices) output.write(`${colors.dim}\u2139 ${notice}${colors.reset}\n`);
  if (notices.length) output.write('\n');

  if (initialTurnBlocks?.length) {
    for (const item of initialTurnBlocks) {
      if (item.kind !== 'turn') continue;
      const t = item.block;
      output.write(`${colors.green}you${colors.reset}\n${t.userText}\n`);
      renderRoutePhase(output, colors, t, layers);
      if (t.thinking && layers?.thinking !== false) {
        output.write(`${colors.dim}  THINKING${colors.reset}\n${colors.dim}${t.thinking}${colors.reset}\n\n`);
      }
      if (t.tools?.length && layers?.tools !== false) {
        renderGroupedTools(output, colors, t.tools);
      }
      renderSourcesPhase(output, colors, t);
      if (t.assistant) {
        output.write(`${colors.bold}construct${colors.reset}\n${markdownToPlain(t.assistant, { width: termWidth(output) })}\n\n`);
      }
    }
  } else {
    for (const entry of initialTranscript) {
      if (entry.role === 'you') output.write(`${colors.green}you${colors.reset}\n${entry.text}\n\n`);
      else if (entry.role === 'construct') output.write(`${colors.bold}construct${colors.reset}\n${entry.text}\n\n`);
    }
  }

  const interactive = Boolean(input.isTTY);
  const rl = createInterface({ input, output: interactive ? output : undefined, prompt: `${colors.green}you \u25b8${colors.reset} ` });

  if (permissionBridge) {
    permissionBridge.prompt = async (req) => {
      output.write(`\n${colors.yellow}${formatPermissionQuestion({ tool: req.tool, input: req.input })}${colors.reset}\n`);
      const answer = await new Promise((resolve) => rl.question(`${colors.green}?${colors.reset} `, resolve));
      return parsePermissionDecision(answer) || 'reject';
    };
  }

  // During a turn, Ctrl-C cancels the in-flight run and returns to the prompt; outside
  // a turn it ends the session. This keeps a long or stuck turn recoverable.

  let turnActive = false;
  const onSigint = () => {
    if (turnActive) { output.write(`${colors.dim} (cancelling)${colors.reset}\n`); try { driver.cancel?.(); } catch { /* nothing to cancel */ } }
    else rl.close();
  };
  if (interactive) rl.on('SIGINT', onSigint);

  if (interactive) rl.prompt();

  for await (const line of rl) {
    let text = line;
    if (interactive && text.endsWith('\\')) {
      const parts = [text.slice(0, -1)];
      let extra = line;
      while (extra.endsWith('\\')) {
        extra = await new Promise((resolve) => rl.question(`${colors.dim}...${colors.reset} `, resolve));
        parts.push(extra);
      }
      text = parts.join('\n');
    }
    text = text.trim();
    if (!text) { if (interactive) rl.prompt(); continue; }

    if (text.startsWith('/')) {
      let keepGoing = true;
      if (commands) {
        keepGoing = await commands.handle(text, { output, colors, layers, session, rl });
      } else if (text === '/exit' || text === '/quit') {
        keepGoing = false;
      } else {
        output.write(`${colors.dim}unknown command: ${text}${colors.reset}\n`);
      }
      if (!keepGoing) break;
      if (interactive) rl.prompt();
      continue;
    }

    turnActive = true;
    logTranscript(persist, 'you', text);
    try {
      const result = await renderTurnWithFallback({
        driver,
        text,
        layers,
        output,
        colors,
        env,
        persist,
        session,
        cwd,
        turnBlocks,
        plain,
        promptOptions: session ? { model: session.model, permissionMode: session.permissionMode, sandbox: session.sandbox } : {},
      });
      if (result.assistant && !persist?.transcriptBlock) logTranscript(persist, 'construct', result.assistant);
    } catch (err) {
      output.write(`${colors.red}[error]${colors.reset} ${parseOpenRouterError(err.message).summary}\n`);
    } finally {
      turnActive = false;
    }
    if (interactive) rl.prompt();
  }

  rl.close();
}
