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
import { resolveColors, termWidth } from '../../term-format.mjs';
import { isVisible, planTurn } from '../transparency.mjs';
import { formatUsageFooter, addUsage } from './usage.mjs';

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

export async function renderTurn({ driver, text, layers, output, colors, env = process.env, persist = null, promptOptions = {}, session = null }) {
  const width = termWidth(output);

  if (layers.specialists || layers.path) {
    const plan = await planTurn(text, { env });
    if (plan?.specialists?.length && layers.specialists) {
      output.write(`${colors.dim}  route  ${plan.specialists.join(' \u2192 ')}${colors.reset}\n`);
    }
  }

  const status = createStatus(output, colors, env);
  status.start();

  let section = null;
  let block = null;
  let rendered = false;
  let lastUsage = null;
  let stopReason = null;
  const toolTitles = new Map();

  const closeBlock = () => { if (block) { block.end(); block = null; } section = null; };

  for await (const event of driver.prompt(text, promptOptions)) {
    if (persist) { try { persist(event); } catch { /* persistence is best-effort */ } }
    if (!isVisible(event, layers)) continue;

    switch (event.type) {
      case 'thinking':
        status.stop();
        if (section !== 'thinking') {
          closeBlock();
          output.write(`${colors.dim}[thinking]${colors.reset}\n`);
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
        output.write(`${colors.yellow}[tool]${colors.reset} \u2192 ${event.title || event.kind || 'tool'}\n`);
        rendered = true;
        break;

      case 'tool_update': {
        status.stop(); closeBlock();
        const title = toolTitles.get(event.id) || event.id || 'tool';
        const label = toolStatusLabel(event.status);
        const tint = event.status === 'failed' ? colors.red : colors.dim;
        output.write(`${colors.yellow}[tool]${colors.reset}   ${title} ${tint}\u00b7 ${label}${colors.reset}\n`);
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
        output.write(`${colors.red}[error]${colors.reset} ${event.message}\n`);
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

  if (!rendered) {
    output.write(`${colors.dim}[no output] the host returned no content \u2014 check that a text model is selected (/model) and the host is authenticated${colors.reset}\n`);
  }

  if (lastUsage && layers.observability) {
    output.write(`${colors.dim}\u2500\u2500\u2500${colors.reset}\n`);
    output.write(formatUsageFooter(lastUsage, colors) + '\n');
  }

  return { stopReason, usage: lastUsage, rendered };
}

function writeHeader({ output, colors, host, version, model, layers }) {
  const enabled = Object.entries(layers).filter(([, on]) => on).map(([k]) => k).join(', ') || 'none';
  output.write(`${colors.bold}construct chat${colors.reset} \u2014 ${host}${version ? ` ${colors.dim}(${version})${colors.reset}` : ''}${model ? `  ${colors.dim}model:${colors.reset} ${model}` : ''}\n`);
  output.write(`${colors.dim}transparency: ${enabled}  \u00b7  /help for commands, /exit to quit${colors.reset}\n\n`);
}

export async function runChatLoop({ driver, host, version, layers, input = process.stdin, output = process.stdout, env = process.env, persist = null, commands = null, session = null, notices = [] }) {
  const colors = resolveColors({ stream: output, env });
  writeHeader({ output, colors, host, version, model: session?.model, layers });
  for (const notice of notices) output.write(`${colors.dim}\u2139 ${notice}${colors.reset}\n`);
  if (notices.length) output.write('\n');

  const interactive = Boolean(input.isTTY);
  const rl = createInterface({ input, output: interactive ? output : undefined, prompt: `${colors.green}you \u25b8${colors.reset} ` });

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
    const text = line.trim();
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
    try {
      await renderTurn({
        driver,
        text,
        layers,
        output,
        colors,
        env,
        persist,
        session,
        promptOptions: session ? { model: session.model, permissionMode: session.permissionMode } : {},
      });
    } catch (err) {
      output.write(`${colors.red}[error]${colors.reset} ${err.message}\n`);
    } finally {
      turnActive = false;
    }
    if (interactive) rl.prompt();
  }

  rl.close();
}
