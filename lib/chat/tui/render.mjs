/**
 * lib/chat/tui/render.mjs — accessible, structured terminal rendering for `construct chat`.
 *
 * Renders the normalized driver event stream as a grouped, screen-reader-friendly
 * transcript. Every section carries a text label (`[thinking]`, `[tool]`, `construct`,
 * `[usage]`), so meaning never depends on color — color is enhancement only and is
 * gated by term-format.mjs (NO_COLOR, non-TTY, TERM=dumb). Thinking is off by default;
 * when enabled, a capped summary renders once before the answer. Tools render as a
 * and each turn closes with a truthful token/cost footer.
 *
 * During a turn, a 3-row activity ticker shows phase, live reasoning (hosted
 * models), and a compact tool tail. Answers buffer during the turn and render
 * through markdownToAnsi once complete so headings, lists, and tables are not
 * shown as raw markup. JSON payloads are omitted from the transcript; repo paths
 * render as OSC-8 links when supported.
 *
 * renderTurn drives one prompt turn and is pure with respect to input (tested against
 * a mock driver); runChatLoop adds the interactive readline REPL and slash commands.
 */

import { createInterface } from 'node:readline';
import fs from 'node:fs';
import path from 'node:path';
import { createSlashCompleter, buildSlashCompletionContext } from '../command-suggest.mjs';
import { attachSlashPalette, clearSlashPalette, reservePaletteZone } from './slash-palette.mjs';
import { detachPromptLine } from './prompt-write.mjs';
import { renderThinkingSummary, summarizeThinking } from '../thinking-display.mjs';
import { createActivityTicker } from './activity-ticker.mjs';
import { termWidth } from '../../term-format.mjs';
import { resolveChatColors } from './presentation.mjs';
import { isVisible, planTurn } from '../transparency.mjs';
import { buildPlanContext } from '../session-context.mjs';
import { handleModelFailure, persistFallbackModel } from '../openrouter-fallback.mjs';
import { formatUserFacingError } from '../user-error.mjs';
import { formatUsageFooter, addUsage } from './usage.mjs';
import { formatPermissionQuestion, parsePermissionDecision } from '../permission-prompt.mjs';
import { resolveExecutionCapabilityProfile } from '../../models/execution-capability-profile.mjs';
import { compilePolicyFromOverlay } from '../../models/execution-policy.mjs';
import {
  createTurnBlock, applyOverlayToTurn, applyEventToTurn, finalizeTurn,
} from './turn-block.mjs';
import {
  summarizeSources, splitSourceLines, summarizeToolCalls, toolGroupLabel,
} from './turn-present.mjs';
import { markdownToPlain, writeMarkdownAnsi } from './markdown.mjs';
import { expandUserInput } from '../input-expand.mjs';
import { formatPathLink, terminalLinksEnabled } from './terminal-links.mjs';
import {
  renderSessionBanner, renderSessionFarewell, renderUserTurn, renderAssistantLabel, renderRoutePanel, renderSectionLabel,
} from './terminal-chrome.mjs';
import { buildSessionSummary, bannerEnabled } from './session-summary.mjs';
import {
  detectConstructLoopIntent, runArtifactLoopChatTurn, writeArtifactLoopReport,
} from '../artifact-loop.mjs';

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

function resolveVisibleThinkingPolicy({ model, overlay } = {}) {
  try {
    const profile = resolveExecutionCapabilityProfile({ model });
    const policy = compilePolicyFromOverlay({ profile, overlay });
    return policy.output?.visibleThinking || 'hidden';
  } catch {
    return 'hidden';
  }
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

function renderRoutePhase(output, colors, turn, layers, { width, plain } = {}) {
  renderRoutePanel(output, colors, turn, layers, { width, plain });
}

function renderSourcesPhase(output, colors, turn, { plain = false, cwd = process.cwd(), env = process.env } = {}) {
  const src = summarizeSources(turn.sources || []);
  if (!src.total) return;
  const linksEnabled = terminalLinksEnabled(env, { plain, stream: output });

  const toolCounts = Object.entries(src.byTool).map(([t, n]) => `${t} ${n}`).join('  ');
  renderSectionLabel(output, colors, 'SOURCES', { tint: 'accentAlt', glyph: '▸' });
  output.write(`${colors.dim}    ${'count'.padEnd(10)}${colors.reset}${colors.highlight}${src.total} consulted${toolCounts ? ` (${toolCounts})` : ''}${colors.reset}\n`);
  const split = splitSourceLines(src.refs, { limit: 4 });
  for (const line of split.lines) {
    if (line === 'none yet') continue;
    const linked = formatPathLink(line, colors, { cwd, enabled: linksEnabled });
    output.write(`${colors.dim}              ${linked}${colors.reset}\n`);
  }
  if (split.hidden > 0) output.write(`${colors.dim}              +${split.hidden} more${colors.reset}\n`);
  output.write('\n');
}

function renderGroupedTools(output, colors, tools) {
  if (!tools?.length) return;
  const groups = summarizeToolCalls(tools);
  renderSectionLabel(output, colors, `TOOLS  ${tools.length} call${tools.length === 1 ? '' : 's'}, ${groups.length} kind${groups.length === 1 ? '' : 's'}`, { tint: 'warn' });
  for (const g of groups) {
    const tint = g.status === 'failed' ? colors.red : colors.green;
    const glyph = g.status === 'failed' ? '✗' : '✓';
    output.write(`${colors.dim}  ${tint}${glyph}${colors.reset} ${tint}${toolGroupLabel(g)}${colors.reset}\n`);
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

  if (retryAttempt === 0 && !promptOptions.skipUserRender) {
    renderUserTurn(output, colors, text, { plain });
  }

  let overlay = promptOptions.turnOverlay ?? null;
  const skipRoute = promptOptions.skipRouteRender === true;
  if (retryAttempt === 0 && !skipRoute && (layers.specialists || layers.path)) {
    overlay = overlay || await planTurn(text, {
      env,
      context: buildPlanContext({ session, cwd, turnBlocks, text }),
    });
    if (overlay) applyOverlayToTurn(turn, overlay);
    renderRoutePhase(output, colors, turn, layers, { width, plain });
  } else if (overlay) {
    applyOverlayToTurn(turn, overlay);
  }

  const visibleThinking = resolveVisibleThinkingPolicy({
    model: promptOptions.model || session?.model,
    overlay,
  });

  const ticker = createActivityTicker(output, colors, {
    plain,
    width,
    cwd,
    env,
    visibleThinking,
  });
  ticker.begin();

  let section = null;
  let block = null;
  let rendered = ticker.began();

  // Permanent transcript lines emitted while the ticker's live zone is up must go
  // through emit() so the zone is torn down and rebuilt around them; a raw write
  // would be overwritten by the next spinner repaint.

  const emitLine = (s) => ticker.emit(s);
  let lastUsage = null;
  let stopReason = null;
  let assistantText = '';
  let errorMessage = null;
  const toolRecords = new Map();
  let timingSection = null;
  let timingSectionStart = Date.now();
  let turnToolMs = 0;
  let turnStreamMs = 0;
  let thinkingBuffer = '';

  const flushThinking = () => {
    if (!thinkingBuffer.trim()) {
      thinkingBuffer = '';
      return;
    }
    if (layers?.thinking === false) {
      if (visibleThinking !== 'summary') {
        const summary = summarizeThinking(thinkingBuffer, { maxLines: 1, maxChars: 120 });
        if (summary.preview) {
          emitLine(`${colors.dim}  │ reasoning: ${summary.preview}${colors.reset}`);
          rendered = true;
        }
      }
    } else {
      renderThinkingSummary(output, colors, thinkingBuffer, { width, plain });
      rendered = true;
    }
    thinkingBuffer = '';
  };

  const flushTiming = () => {
    if (!timingSection) return;
    const elapsed = Date.now() - timingSectionStart;
    if (timingSection === 'tool') turnToolMs += elapsed;
    else if (timingSection === 'stream') turnStreamMs += elapsed;
    timingSection = null;
  };

  const enterTiming = (next) => {
    if (timingSection === next) return;
    flushTiming();
    timingSection = next;
    timingSectionStart = Date.now();
  };

  const closeBlock = () => {
    if (!block) return;
    block.end();
    block = null;
    section = null;
  };

  for await (const event of driver.prompt(text, { ...promptOptions, model: promptOptions.model || session?.model, turnOverlay: overlay })) {
    logEvent(persist, event);
    applyEventToTurn(turn, event);

    if (event.type === 'thinking') {
      thinkingBuffer += event.text || '';
      ticker.pushThinking(event.text || '');
    }

    if (!isVisible(event, layers)) continue;

    switch (event.type) {
      case 'thinking':
        enterTiming('stream');
        break;

      case 'text':
        enterTiming('stream');
        flushThinking();
        ticker.onComposing();
        section = 'message';
        assistantText += event.text || '';
        rendered = true;
        break;

      case 'plan': {
        closeBlock();
        const planLines = [`${colors.cyan}[plan]${colors.reset}`];
        for (const entry of event.entries || []) planLines.push(`  ${planGlyph(entry.status)} ${entry.content}`);
        emitLine(planLines.join('\n'));
        rendered = true;
        break;
      }

      case 'tool_call':
        closeBlock();
        enterTiming('tool');
        toolRecords.set(event.id, event);
        if (layers?.tools !== false) {
          ticker.onToolCall(event);
        }
        rendered = true;
        break;

      case 'tool_update': {
        closeBlock();
        enterTiming('tool');
        const record = toolRecords.get(event.id) || {};
        if (layers?.tools !== false) {
          ticker.onToolDone({ ...record, ...event }, record.title || record.kind);
        }
        rendered = true;
        break;
      }

      case 'usage':
        lastUsage = event;
        if (session) addUsage(session.usage, event);
        break;

      case 'permission':
        closeBlock();
        emitLine(`${colors.yellow}[permission]${colors.reset} ${event.toolCall?.title || event.toolCall?.callID || 'tool'} \u2014 ${promptOptions.permissionMode === 'reject' ? 'rejected' : promptOptions.permissionMode === 'allow_always' ? 'allowed (always)' : 'allowed (once)'}`);
        break;

      case 'error':
        closeBlock();
        errorMessage = event.message;
        turn.modelFailed = true;
        if (!promptOptions.suppressInlineErrors) {
          emitLine(`${colors.red}[error]${colors.reset} ${formatUserFacingError(event.message)}`);
        }
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
  flushThinking();
  flushTiming();
  ticker.finish();

  finalizeTurn(turn, {
    evidenceVisible: layers?.tools !== false,
    skipEvidenceNotice: Boolean(errorMessage && !assistantText),
  });

  if (turn.tools?.length > 3 && layers?.tools !== false) {
    renderGroupedTools(output, colors, turn.tools);
  }

  renderSourcesPhase(output, colors, turn, { plain, cwd, env });

  const answer = assistantText || turn.assistant || '';
  if (answer) {
    if (!ticker.began()) renderAssistantLabel(output, colors, { plain });
    if (colors.reset && !plain) {
      writeMarkdownAnsi(output, answer, { width, colors, prefix: '  │ ', cwd, plain, env });
    } else {
      const plainBody = markdownToPlain(answer, { width });
      for (const line of plainBody.split('\n')) {
        output.write(line ? `  │ ${line}\n` : '\n');
      }
    }
    output.write('\n');
    rendered = true;
  } else if (!rendered && turn.assistant) {
    renderAssistantLabel(output, colors, { plain });
    if (colors.reset && !plain) {
      writeMarkdownAnsi(output, turn.assistant, { width, colors, prefix: '  │ ', cwd, plain, env });
    } else {
      output.write(`${markdownToPlain(turn.assistant, { width })}\n`);
    }
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

  return {
    stopReason,
    usage: lastUsage,
    rendered,
    assistant: assistantText || turn.assistant,
    error: errorMessage,
    turn,
    timing: {
      toolMs: turnToolMs,
      apiMs: turnStreamMs,
      activeMs: turnToolMs + turnStreamMs,
    },
  };
}

export async function renderTurnWithFallback(opts) {
  const maxAttempts = 3;
  let model = opts.promptOptions?.model || opts.session?.model;
  let notice = null;
  let lastError = null;

  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    const suppressInlineErrors = attempt < maxAttempts - 1;
    const result = await renderTurn({
      ...opts,
      promptOptions: {
        ...opts.promptOptions,
        model,
        turnOverlay: opts.promptOptions?.turnOverlay,
        suppressInlineErrors,
      },
      retryAttempt: attempt,
    });
    if (!result.error && result.stopReason !== 'error') {
      return { ...result, model, notice };
    }

    lastError = result.error;
    const fallback = await handleModelFailure({
      session: opts.session,
      error: result.error,
      env: opts.env,
      currentModel: model,
      cwd: opts.cwd,
    });
    if (!fallback) {
      if (opts.output && lastError) {
        opts.output.write(`${opts.colors?.red || ''}[error]${opts.colors?.reset || ''} ${formatUserFacingError(lastError)}\n`);
      }
      return { ...result, model, notice };
    }

    model = fallback.modelId;
    if (opts.session) opts.session.model = model;
    notice = fallback.notice;
    if (fallback.persistPin) {
      persistFallbackModel(opts.session, model, { cwd: opts.cwd });
    }
    if (opts.output && notice) {
      opts.output.write(`${opts.colors?.yellow || ''}[notice]${opts.colors?.reset || ''} ${notice}\n`);
    }
  }

  const result = await renderTurn({
    ...opts,
    promptOptions: { ...opts.promptOptions, model, turnOverlay: opts.promptOptions?.turnOverlay },
  });
  if ((result.error || result.stopReason === 'error') && opts.output) {
    opts.output.write(`${opts.colors?.red || ''}[error]${opts.colors?.reset || ''} ${formatUserFacingError(result.error || lastError)}\n`);
  }
  return { ...result, model, notice };
}

function writeHeader({ output, colors, host, version, model, pinnedModel, layers, session, env, flags, plain }) {
  renderSessionBanner(output, colors, {
    host,
    version,
    model,
    pinnedModel,
    layers,
    width: termWidth(output),
    plain,
    ascii: session?.ui?.ascii,
    showBanner: bannerEnabled({ env, flags, session, plain }),
  });
}

function accumulateTurnTiming(session, turnTiming) {
  if (!session?.timing || !turnTiming) return;
  session.timing.toolMs = (session.timing.toolMs || 0) + (turnTiming.toolMs || 0);
  session.timing.apiMs = (session.timing.apiMs || 0) + (turnTiming.apiMs || 0);
  session.timing.activeMs = (session.timing.activeMs || 0) + (turnTiming.activeMs || 0);
}

function renderFarewellIfEnabled({
  output, colors, env, flags, session, plain, interactive, turnBlocks, persist,
}) {
  if (!interactive || plain || !bannerEnabled({ env, flags, session, plain })) return;
  const summary = buildSessionSummary({
    turnBlocks,
    session,
    persist,
    timing: session?.timing,
  });
  renderSessionFarewell(output, colors, summary, {
    width: termWidth(output),
    plain,
    env,
  });
}

export async function runChatLoop({
  driver, host, version, layers, input = process.stdin, output = process.stdout, env = process.env,
  persist = null, commands = null, session = null, notices = [], permissionBridge = null,
  initialTranscript = [], initialTurnBlocks = [], cwd = process.cwd(), flags = {},
  turnBlocksStore = null,
}) {
  const colors = resolveChatColors({ stream: output, env, configTheme: session?.ui?.theme });
  const plain = plainCopyMode(env, flags);
  const turnBlocks = turnBlocksStore?.blocks ?? [...(initialTurnBlocks || [])];
  if (turnBlocksStore) turnBlocksStore.blocks = turnBlocks;
  writeHeader({
    output, colors, host, version,
    model: session?.model,
    pinnedModel: session?.savedModel && session.savedModel !== session?.model ? session.savedModel : null,
    layers,
    session,
    env,
    flags,
    plain,
  });
  for (const notice of notices) {
    const level = notice.startsWith('OpenRouter unavailable') || notice.startsWith('Provider unavailable')
      ? colors.yellow
      : notice.startsWith('Active model:')
        ? colors.dim
        : colors.dim;
    const glyph = notice.startsWith('OpenRouter unavailable') || notice.startsWith('Provider unavailable')
      ? '\u26a0'
      : notice.startsWith('Active model:')
        ? '\u2192'
        : '\u2139';
    output.write(`${level}${glyph} ${notice}${colors.reset}\n`);
  }
  if (notices.length) output.write('\n');
  if (Boolean(input.isTTY) && !plain) {
    output.write(`${colors.dim}tip: type / for commands (live filter) · /layers for transparency · /set thinking on for reasoning summary · attach with @path${colors.reset}\n`);
    reservePaletteZone(output, { plain });
    output.write('\n');
  }

  if (initialTurnBlocks?.length) {
    for (const item of initialTurnBlocks) {
      if (item.kind !== 'turn') continue;
      const t = item.block;
      renderUserTurn(output, colors, t.userText, { plain });
      renderRoutePhase(output, colors, t, layers, { width: termWidth(output), plain });
      if (t.thinking && layers?.thinking !== false) {
        renderThinkingSummary(output, colors, t.thinking, { width: termWidth(output), plain });
      }
      if (t.tools?.length && layers?.tools !== false) {
        renderGroupedTools(output, colors, t.tools);
      }
      renderSourcesPhase(output, colors, t);
      if (t.assistant) {
        renderAssistantLabel(output, colors, { plain });
        if (colors.reset && !plain) {
          writeMarkdownAnsi(output, t.assistant, { width: termWidth(output), colors, prefix: '  │ ', cwd, plain, env });
        } else {
          output.write(`${markdownToPlain(t.assistant, { width: termWidth(output) })}\n\n`);
        }
      }
    }
  } else {
    for (const entry of initialTranscript) {
      if (entry.role === 'you') renderUserTurn(output, colors, entry.text, { plain });
      else if (entry.role === 'construct') {
        renderAssistantLabel(output, colors, { plain });
        output.write(`${entry.text}\n\n`);
      }
    }
  }

  const interactive = Boolean(input.isTTY);
  const promptBadge = plain ? `${colors.green}you >${colors.reset} ` : `${colors.ok}${colors.bold}you ▸${colors.reset} `;
  const slashCompletion = buildSlashCompletionContext({ cwd, env });
  const rl = createInterface({
    input,
    output: interactive ? output : undefined,
    prompt: promptBadge,
    completer: interactive ? createSlashCompleter(slashCompletion) : undefined,
    historySize: 100,
    terminal: interactive,
    escapeCodeTimeout: interactive ? 50 : undefined,
  });

  const slashPaletteState = interactive
    ? attachSlashPalette(rl, output, colors, slashCompletion, { plain, width: termWidth(output) })
    : { lines: 0 };

  const historyFile = path.join(cwd, '.cx', 'chat-history.jsonl');
  function appendHistory(line) {
    if (!line?.trim()) return;
    try {
      fs.mkdirSync(path.dirname(historyFile), { recursive: true });
      fs.appendFileSync(historyFile, `${JSON.stringify({ ts: new Date().toISOString(), line })}\n`);
    } catch { /* non-fatal */ }
  }

  if (permissionBridge) {
    permissionBridge.prompt = async (req) => {
      if (interactive) detachPromptLine(output, rl);
      output.write(`${colors.yellow}${formatPermissionQuestion({ tool: req.tool, input: req.input })}${colors.reset}\n`);
      const answer = await new Promise((resolve) => rl.question(`${colors.green}?${colors.reset} `, resolve));
      return parsePermissionDecision(answer) || 'reject';
    };
  }

  // During a turn, Ctrl-C cancels the in-flight run and returns to the prompt; outside
  // a turn it ends the session. This keeps a long or stuck turn recoverable.

  let turnActive = false;
  let turnActiveStart = null;
  let farewellShown = false;

  const showFarewell = () => {
    if (farewellShown) return;
    farewellShown = true;
    renderFarewellIfEnabled({
      output, colors, env, flags, session, plain, interactive, turnBlocks, persist,
    });
  };

  const endTurnActive = () => {
    if (turnActiveStart != null && session?.timing) {
      session.timing.activeMs = (session.timing.activeMs || 0) + (Date.now() - turnActiveStart);
    }
    turnActive = false;
    turnActiveStart = null;
  };

  const beginTurnActive = () => {
    turnActive = true;
    turnActiveStart = Date.now();
  };

  const onSigint = () => {
    if (turnActive) { output.write(`${colors.dim} (cancelling)${colors.reset}\n`); try { driver.cancel?.(); } catch { /* nothing to cancel */ } }
    else rl.close();
  };
  if (interactive) {
    rl.on('SIGINT', onSigint);
    rl.on('close', () => {
      showFarewell();
    });
  }

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

    const expanded = expandUserInput(text, { cwd });
    if (expanded.skipped.length) {
      for (const note of expanded.skipped) {
        output.write(`${colors.yellow}ℹ${colors.reset} ${note}\n`);
      }
    }
    if (expanded.attachments.length) {
      const names = expanded.attachments.map((a) => a.relPath).join(', ');
      output.write(`${colors.dim}attached${colors.reset}  ${colors.highlight}${names}${colors.reset}\n`);
    }
    text = expanded.text;
    if (!text) { if (interactive) rl.prompt(); continue; }
    appendHistory(text);

    if (text.startsWith('/')) {
      clearSlashPalette(output, slashPaletteState, rl);
      if (interactive) detachPromptLine(output, rl);
      let keepGoing = true;
      if (commands) {
        keepGoing = await commands.handle(text, { output, colors, layers, session, rl, env });
      } else if (text === '/exit' || text === '/quit') {
        keepGoing = false;
      } else {
        output.write(`${colors.dim}unknown command: ${text}${colors.reset}\n`);
      }
      if (!keepGoing) {
        showFarewell();
        break;
      }
      if (interactive) rl.prompt();
      continue;
    }

    if (detectConstructLoopIntent(text, { turnBlocks })) {
      beginTurnActive();
      if (interactive) detachPromptLine(output, rl);
      logTranscript(persist, 'you', text);
      try {
        renderUserTurn(output, colors, text, { plain });
        const chatTurn = await runArtifactLoopChatTurn({
          text,
          turnBlocks,
          cwd,
          driver,
          layers,
          output,
          colors,
          env,
          persist,
          session,
          plain,
          renderRoutePhase: (out, cols, turn, lyr, opts) => renderRoutePhase(out, cols, turn, lyr, opts),
          renderTurnWithFallback,
        });
        if (!chatTurn) {
          output.write(`${colors.yellow}Could not resolve artifact loop request.${colors.reset}\n`);
        } else if (chatTurn.error) {
          output.write(`${colors.red}[artifact-loop]${colors.reset} ${chatTurn.error}\n`);
        } else if (chatTurn.loopResult) {
          const turn = createTurnBlock(text);
          if (chatTurn.routeOverlay) applyOverlayToTurn(turn, chatTurn.routeOverlay);
          if (chatTurn.loopResult?.overlay) applyOverlayToTurn(turn, chatTurn.loopResult.overlay);
          writeArtifactLoopReport(output, colors, chatTurn.loopResult, { cwd, env, plain });
          turn.assistant = chatTurn.turn.assistant;
          finalizeTurn(turn, { evidenceVisible: false });
          turnBlocks.push({ kind: 'turn', block: turn });
          logTranscript(persist, 'construct', chatTurn.turn.assistant);
        }
      } catch (err) {
        output.write(`${colors.red}[artifact-loop error]${colors.reset} ${err?.message || String(err)}\n`);
      } finally {
        endTurnActive();
      }
      if (interactive) rl.prompt();
      continue;
    }

    beginTurnActive();
    clearSlashPalette(output, slashPaletteState, rl);
    if (interactive) detachPromptLine(output, rl);
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
      accumulateTurnTiming(session, result.timing);
      if (result.turn) {
        turnBlocks.push({ kind: 'turn', block: result.turn });
        if (turnBlocksStore) turnBlocksStore.blocks = turnBlocks;
      }
      if (result.assistant && !persist?.transcriptBlock) logTranscript(persist, 'construct', result.assistant);
    } catch (err) {
      output.write(`${colors.red}[error]${colors.reset} ${formatUserFacingError(err.message)}\n`);
    } finally {
      endTurnActive();
    }
    if (interactive) rl.prompt();
  }

  if (interactive) rl.removeListener('SIGINT', onSigint);
  rl.close();
}
