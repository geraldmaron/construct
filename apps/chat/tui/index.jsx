/**
 * apps/chat/tui/index.jsx — the rich, multi-pane Ink cockpit for `construct chat`.
 *
 * This is the first-class transparency surface ADR-0041 calls for, and the
 * product's differentiator over delegate-the-loop hosts: a branded header (model,
 * provider, sandbox, permission, live status), a conversation pane with role
 * badges and a welcoming empty state, and a dedicated transparency cockpit that
 * shows, live, what the owned loop is doing — context budget meter, token/cost
 * ledger, the tool timeline, and the specialist route Construct's policy selects.
 * It is a thin projection of the normalized event union (lib/chat/harness/driver.mjs)
 * through the pure turn-state reducer (turn-state.mjs); it adds no protocol of its
 * own and never fabricates a number the host did not report (no-fabrication).
 * Slash commands route through lib/chat/commands.mjs — the same handler as the
 * linear renderer — and layer visibility uses lib/chat/transparency.mjs isVisible().
 *
 * Built to a bundle by `npm run build:chat` and loaded by the zero-dep launcher
 * (lib/chat/cli.mjs) only on a capable interactive TTY; every non-TTY, --plain,
 * --accessible, NO_COLOR, or TERM=dumb context uses the linear renderer instead.
 * Status is carried by glyph as well as colour, so meaning never relies on colour
 * alone. Input uses Ink's useInput; slash commands reuse lib/chat/commands.mjs.
 */

import React, { useState, useRef, useCallback, useEffect, useMemo } from 'react';
import { render, Box, Text, useApp, useInput, useStdout } from 'ink';
import { runTurnInto } from './turn-state.mjs';
import { formatTokens, formatUsageFooter } from '../../../lib/chat/tui/usage.mjs';
import { LAYER_KEYS } from '../../../lib/chat/config.mjs';
import { createCommands, createCollectWriter, PLAIN_COLORS } from '../../../lib/chat/commands.mjs';
import { stripAnsi } from '../../../lib/term-format.mjs';
import {
  palette, glyphs, spinnerFrames, toolGlyph, toolColor, splitModel, meter, ratioColor, percent,
} from './theme.mjs';

function Rule({ width, color = palette.muted }) {
  return <Text color={color}>{'\u2500'.repeat(Math.max(1, width))}</Text>;
}

function Badge({ bg, color = 'black', children }) {
  return <Text backgroundColor={bg} color={color} bold>{` ${children} `}</Text>;
}

function HeaderBar({ cols, model, sandbox, permissionMode, working, spin }) {
  const { provider, name } = splitModel(model);
  return (
    <Box flexDirection="column">
      <Box width={cols} justifyContent="space-between">
        <Box>
          <Text color={palette.accent} bold>{`${glyphs.brand} construct`}</Text>
          <Text color={palette.muted}>{`  ${glyphs.gutter}  chat`}</Text>
        </Box>
        <Box>
          {provider ? <Text color={palette.muted}>{`${provider}/`}</Text> : null}
          <Text color={palette.text} bold>{name}</Text>
          <Text color={palette.muted}>{`   ${sandbox}  ${glyphs.gutter}  ${permissionMode}  `}</Text>
          <Text color={working ? palette.warn : palette.ok}>{working ? spin : glyphs.dot}</Text>
        </Box>
      </Box>
      <Rule width={cols} />
    </Box>
  );
}

function EmptyState({ model }) {
  const { provider, name } = splitModel(model);
  return (
    <Box flexDirection="column" paddingY={1}>
      <Text color={palette.accent} bold>{`${glyphs.brand} welcome to construct chat`}</Text>
      <Box marginTop={1}>
        <Text color={palette.muted} wrap="wrap">
          Transparency-first coding. Every token, tool call, and the specialist route Construct would take stays in view in the panel on the right — nothing is hidden behind a host.
        </Text>
      </Box>
      <Box marginTop={1} flexDirection="column">
        <Text color={palette.muted}>To get going</Text>
        <Text>{`  ${glyphs.caret} ask a question or describe the change you want`}</Text>
        <Text color={palette.muted}>{`  ${glyphs.caret} /help  /model  /models  /set  /settings  /layers  /usage`}</Text>
      </Box>
      {name ? (
        <Box marginTop={1}>
          <Text color={palette.muted}>{`ready on `}</Text>
          <Text color={palette.text} bold>{provider ? `${provider}/${name}` : name}</Text>
        </Box>
      ) : (
        <Box marginTop={1}><Text color={palette.warn}>{`${glyphs.caret} no model selected — set one with /model or a provider key`}</Text></Box>
      )}
    </Box>
  );
}

function Message({ role, text }) {
  if (role === 'thinking') {
    return (
      <Box flexDirection="column" marginBottom={1}>
        <Text color={palette.muted}>{`${glyphs.gutter} thinking`}</Text>
        <Box paddingLeft={2}><Text color={palette.muted} wrap="wrap">{text}</Text></Box>
      </Box>
    );
  }
  const isYou = role === 'you';
  const isError = typeof text === 'string' && text.startsWith('[error]');
  return (
    <Box flexDirection="column" marginBottom={1}>
      <Badge bg={isYou ? palette.ok : palette.accent}>{isYou ? 'you' : 'construct'}</Badge>
      <Box paddingLeft={1}><Text color={isError ? palette.danger : undefined} wrap="wrap">{text}</Text></Box>
    </Box>
  );
}

function planGlyph(status) {
  if (status === 'completed') return glyphs.toolDone;
  if (status === 'in_progress') return glyphs.toolBusy;
  return glyphs.toolPending;
}

function ConversationPane({ width, transcript, live, thinking, showThinking, model, working, spin }) {
  if (transcript.length === 0 && !live && !thinking) {
    return (
      <Box flexDirection="column" width={width} paddingRight={2}>
        <EmptyState model={model} />
      </Box>
    );
  }
  const lines = transcript.map((entry) => ({ role: entry.role, text: entry.text }));
  if (showThinking && thinking) lines.push({ role: 'thinking', text: thinking });
  if (live) lines.push({ role: 'construct', text: `${live}${working ? glyphs.block : ''}` });
  return (
    <Box flexDirection="column" width={width} paddingRight={2}>
      {lines.map((l, i) => <Message key={i} role={l.role} text={l.text} />)}
      {working && !live ? <Text color={palette.warn}>{`${spin} working\u2026`}</Text> : null}
    </Box>
  );
}

function PanelSection({ title, children, marginTop = 1 }) {
  return (
    <Box flexDirection="column" marginTop={marginTop}>
      <Text color={palette.accent}>{title}</Text>
      {children}
    </Box>
  );
}

function TransparencyPanel({
  width, session, route, routeMeta, tools, plan, permissions, lastTurnUsage, layers,
  working, model, sandbox, permissionMode, ctx, spin,
}) {
  const u = session.usage;
  const t = u.tokens || {};
  const { provider, name } = splitModel(model);

  const ledger = [];
  if (t.input) ledger.push(['prompt', formatTokens(t.input)]);
  if (t.output) ledger.push(['output', formatTokens(t.output)]);
  if (t.reasoning) ledger.push(['reasoning', formatTokens(t.reasoning)]);
  if (t.cacheRead) ledger.push(['cache in', formatTokens(t.cacheRead)]);
  if (t.cacheWrite) ledger.push(['cache out', formatTokens(t.cacheWrite)]);
  if (t.total) ledger.push(['total', formatTokens(t.total)]);
  if (u.cost?.amount > 0) ledger.push(['cost', `~$${u.cost.amount.toFixed(u.cost.amount < 1 ? 3 : 2)}`]);

  const ctxMeter = ctx?.size ? meter(ctx.used, ctx.size, Math.max(10, width - 8)) : null;
  const recentTools = tools.slice(-7);
  const turnUsage = lastTurnUsage && layers?.observability
    ? stripAnsi(formatUsageFooter(lastTurnUsage, {})).replace(/^\[usage\] /, '')
    : null;

  return (
    <Box flexDirection="column" width={width} borderStyle="round" borderColor={palette.accent} paddingX={1}>
      <Text color={palette.accent} bold>{`${glyphs.brand} transparency`}</Text>

      <PanelSection title="model" marginTop={1}>
        <Text>
          {provider ? <Text color={palette.muted}>{`${provider}/`}</Text> : null}
          <Text bold>{name}</Text>
        </Text>
        {(sandbox || permissionMode) ? (
          <Text color={palette.muted}>{[sandbox, permissionMode].filter(Boolean).join(` ${glyphs.gutter} `)}</Text>
        ) : null}
      </PanelSection>

      <PanelSection title="layers">
        <Text color={palette.muted} wrap="wrap">
          {LAYER_KEYS.map((k) => `${k}=${layers?.[k] ? 'on' : 'off'}`).join(`  ${glyphs.gutter}  `)}
        </Text>
      </PanelSection>

      <PanelSection title="context">
        {ctxMeter ? (
          <Box flexDirection="column">
            <Text color={ratioColor(ctxMeter.ratio)}>{ctxMeter.bar}</Text>
            <Text color={palette.muted}>{`${formatTokens(ctx.used)}/${formatTokens(ctx.size)}  ${percent(ctxMeter.ratio)}`}</Text>
          </Box>
        ) : (
          <Text color={palette.muted}>not reported yet</Text>
        )}
      </PanelSection>

      {turnUsage ? (
        <PanelSection title="this turn">
          <Text color={palette.muted} wrap="wrap">{turnUsage}</Text>
        </PanelSection>
      ) : null}

      <PanelSection title={`usage ${glyphs.gutter} ${u.turns} turn${u.turns === 1 ? '' : 's'}`}>
        {ledger.length ? ledger.map(([k, v]) => (
          <Box key={k} justifyContent="space-between">
            <Text color={palette.muted}>{k}</Text>
            <Text>{v}</Text>
          </Box>
        )) : <Text color={palette.muted}>no tokens yet</Text>}
      </PanelSection>

      {routeMeta?.intent || routeMeta?.workCategory ? (
        <PanelSection title="intent">
          <Text color={palette.muted} wrap="wrap">{[routeMeta.intent, routeMeta.workCategory].filter(Boolean).join(` ${glyphs.gutter} `)}</Text>
        </PanelSection>
      ) : null}

      {route.length > 0 ? (
        <PanelSection title="route">
          <Text color={palette.accentAlt} wrap="wrap">{route.join(` ${glyphs.arrow} `)}</Text>
        </PanelSection>
      ) : null}

      {layers?.path && plan.length > 0 ? (
        <PanelSection title="plan">
          {plan.map((entry, i) => (
            <Text key={`${entry.content}-${i}`} color={palette.muted} wrap="wrap">{`${planGlyph(entry.status)} ${entry.content}`}</Text>
          ))}
        </PanelSection>
      ) : null}

      {permissions.length > 0 ? (
        <PanelSection title="permissions">
          {permissions.slice(-5).map((entry, i) => (
            <Text key={`${entry.title}-${i}`} color={palette.warn} wrap="wrap">{`${glyphs.gutter} ${entry.title} ${glyphs.gutter} ${entry.detail}`}</Text>
          ))}
        </PanelSection>
      ) : null}

      {layers?.tools !== false ? (
        <PanelSection title={`tools ${glyphs.gutter} ${tools.length}`}>
          {recentTools.length ? recentTools.map((tool, i) => (
            <Text key={`${tool.id}-${i}`} color={toolColor(tool.status)}>{`${toolGlyph(tool.status)} ${tool.title}`}</Text>
          )) : <Text color={palette.muted}>none this turn</Text>}
        </PanelSection>
      ) : null}

      <Box marginTop={1}>
        <Text color={working ? palette.warn : palette.ok}>{working ? `${spin} working\u2026` : `${glyphs.dot} idle`}</Text>
      </Box>
    </Box>
  );
}

function Footer({ cols, input, working, notice }) {
  return (
    <Box flexDirection="column">
      <Rule width={cols} />
      {notice ? <Text color={palette.warn}>{notice}</Text> : null}
      <Box>
        <Text color={palette.accent} bold>{`you ${glyphs.caret} `}</Text>
        <Text>{input}</Text>
        <Text color={palette.muted}>{working ? '' : glyphs.block}</Text>
      </Box>
      <Text color={palette.muted}>{`enter send   ${glyphs.gutter}   /help  /models  /settings  /clear   ${glyphs.gutter}   Ctrl-C ${working ? 'cancel' : 'exit'}`}</Text>
    </Box>
  );
}

function App({ driver, session, layers, planTurn, persist, cwd }) {
  const { exit } = useApp();
  const { stdout } = useStdout();
  const cols = stdout?.columns || 100;
  const panelWidth = Math.min(42, Math.max(30, Math.floor(cols * 0.34)));
  const convWidth = Math.max(20, cols - panelWidth - 2);

  const commands = useMemo(
    () => createCommands({ driver, host: 'construct', hostId: 'construct', cwd }),
    [driver, cwd],
  );

  const [transcript, setTranscript] = useState([]);
  const [live, setLive] = useState('');
  const [thinking, setThinking] = useState('');
  const [tools, setTools] = useState([]);
  const [plan, setPlan] = useState([]);
  const [permissions, setPermissions] = useState([]);
  const [route, setRoute] = useState([]);
  const [routeMeta, setRouteMeta] = useState(null);
  const [lastTurnUsage, setLastTurnUsage] = useState(null);
  const [working, setWorking] = useState(false);
  const [input, setInput] = useState('');
  const [notice, setNotice] = useState(session.modelNotice || '');
  const [ctx, setCtx] = useState(null);
  const [frame, setFrame] = useState(0);
  const [, forceTick] = useState(0);
  const busy = useRef(false);

  useEffect(() => {
    if (!working) return undefined;
    const timer = setInterval(() => setFrame((f) => (f + 1) % spinnerFrames.length), 90);
    return () => clearInterval(timer);
  }, [working]);
  const spin = spinnerFrames[frame];

  const append = useCallback((role, text) => setTranscript((prev) => [...prev, { role, text }]), []);

  const handleCommand = useCallback(async (text) => {
    const out = createCollectWriter();
    const keep = await commands.handle(text, {
      output: out.stream,
      colors: PLAIN_COLORS,
      layers,
      session,
      rl: null,
      onClear: () => {
        setTranscript([]);
        setNotice('');
        setRoute([]);
        setRouteMeta(null);
        setTools([]);
        setPlan([]);
        setPermissions([]);
      },
    });
    const msg = stripAnsi(out.text()).trim();
    if (msg) append('construct', msg);
    if (!keep) exit();
  }, [append, commands, exit, layers, session]);

  const submit = useCallback(async (text) => {
    if (!text.trim() || busy.current) return;
    if (text.startsWith('/')) { await handleCommand(text); return; }
    busy.current = true;
    setWorking(true);
    setNotice('');
    append('you', text);
    setLive('');
    setThinking('');
    setTools([]);
    setPlan([]);
    setPermissions([]);
    setLastTurnUsage(null);

    if (layers.specialists || layers.path) {
      try {
        const overlay = await planTurn?.(text);
        if (overlay?.specialists?.length) setRoute(overlay.specialists);
        if (overlay) setRouteMeta({ intent: overlay.intent, workCategory: overlay.workCategory });
      } catch { /* overlay is best-effort */ }
    }

    try {
      const state = await runTurnInto(
        driver,
        text,
        { model: session.model, permissionMode: session.permissionMode, sandbox: session.sandbox },
        {
          session,
          layers,
          onUpdate: (s, event) => {
            if (persist) { try { persist(event); } catch { /* best-effort */ } }
            if (event.type === 'text') setLive(s.assistant);
            else if (event.type === 'thinking') setThinking(s.thinking);
            else if (event.type === 'tool_call' || event.type === 'tool_update') setTools([...s.tools]);
            else if (event.type === 'plan') setPlan([...s.plan]);
            else if (event.type === 'permission') setPermissions([...s.permissions]);
            else if (event.type === 'usage') {
              if (event.context) setCtx(event.context);
              setLastTurnUsage(s.lastUsage);
              forceTick((n) => n + 1);
            }
          },
        },
      );
      if (state.assistant) append('construct', state.assistant);
      else if (state.error) append('construct', `[error] ${state.error}`);
      else append('construct', '[no output] check that a model is selected and the provider is authenticated');
    } catch (err) {
      append('construct', `[error] ${err.message}`);
    } finally {
      setLive('');
      setThinking('');
      setWorking(false);
      busy.current = false;
    }
  }, [append, driver, handleCommand, layers, persist, planTurn, session]);

  useInput((char, key) => {
    if (key.ctrl && char === 'c') {
      if (busy.current) { try { driver.cancel?.(); } catch { /* nothing to cancel */ } }
      else exit();
      return;
    }
    if (key.return) { const text = input; setInput(''); submit(text); return; }
    if (key.backspace || key.delete) { setInput((v) => v.slice(0, -1)); return; }
    if (char && !key.ctrl && !key.meta) setInput((v) => v + char);
  });

  return (
    <Box flexDirection="column">
      <HeaderBar cols={cols} model={session.model} sandbox={session.sandbox} permissionMode={session.permissionMode} working={working} spin={spin} />
      <Box>
        <ConversationPane
          width={convWidth}
          transcript={transcript}
          live={live}
          thinking={thinking}
          showThinking={layers.thinking}
          model={session.model}
          working={working}
          spin={spin}
        />
        <TransparencyPanel
          width={panelWidth}
          session={session}
          route={route}
          routeMeta={routeMeta}
          tools={tools}
          plan={plan}
          permissions={permissions}
          lastTurnUsage={lastTurnUsage}
          layers={layers}
          working={working}
          model={session.model}
          sandbox={session.sandbox}
          permissionMode={session.permissionMode}
          ctx={ctx}
          spin={spin}
        />
      </Box>
      <Footer cols={cols} input={input} working={working} notice={notice} />
    </Box>
  );
}

// Entry point loaded by the launcher. Resolves when the user exits so the launcher
// can tear the driver down. Kept as a named export so the built bundle exposes it.

export function runInkChat({ driver, session, layers, planTurn = null, persist = null, cwd = process.cwd() } = {}) {
  const instance = render(
    <App driver={driver} session={session} layers={layers} planTurn={planTurn} persist={persist} cwd={cwd} />,
  );
  return instance.waitUntilExit();
}

export { App, TransparencyPanel, ConversationPane, HeaderBar, EmptyState };
export default runInkChat;
