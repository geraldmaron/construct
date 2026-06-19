/**
 * apps/chat/tui/index.jsx — the rich, multi-pane Ink cockpit for `construct chat`.
 *
 * Transparency-first transcript in the main column (route, thinking, tools,
 * sources, answer, usage inline). SessionHeader surfaces model, context, and
 * layer pills; SessionRail stays persistent on the right. /inspect toggles
 * expanded tool detail inline — not a sidebar swap.
 */

import React, { useState, useRef, useCallback, useEffect, useMemo, createContext, useContext } from 'react';
import { render, Box, Text, useApp, useInput, useStdout } from 'ink';
import { runTurnInto } from './turn-state.mjs';
import { runTurnWithFallback, parseOpenRouterError } from '../../../lib/chat/openrouter-fallback.mjs';
import { buildPlanContext } from '../../../lib/chat/session-context.mjs';
import { exportTurns } from '../../../lib/chat/export.mjs';
import { createCommands, createCollectWriter, PLAIN_COLORS } from '../../../lib/chat/commands.mjs';
import { stripAnsi } from '../../../lib/term-format.mjs';
import { parsePermissionKey } from '../../../lib/chat/permission-prompt.mjs';
import {
  createTurnBlock, applyOverlayToTurn, applyEventToTurn, finalizeTurn,
  turnBlocksFromTranscript,
} from '../../../lib/chat/tui/turn-block.mjs';
import { createTheme, splitModel } from './theme.mjs';
import {
  SessionRail, SessionHeader, Rule,
} from './turn-ui.jsx';
import { CompactTurnLog, SystemLogLine } from './event-log-ui.jsx';
import { ListPickerOverlay } from './picker-ui.jsx';
import {
  slashCommandGhost, commandSuggestHint, applyTabCompletion,
  cycleSlashCommand, slashCommandMatches,
} from '../../../lib/chat/command-suggest.mjs';
import {
  createListPickerState, reducePickerKey, getPickerSelectedItem,
} from '../../../lib/chat/list-picker.mjs';
import {
  loadModelPickerItems, commitPickerModel, resolveModelPickerSelection,
  pickerSelectedId,
} from '../../../lib/chat/model-picker.mjs';
import { resolveFreeOpenRouterModel } from '../engine/models.mjs';
import {
  PERMISSION_PICKER_ITEMS, settingKeyPickerItems, enumPickerItems,
  BOOL_PICKER_ITEMS, isBoolSetting, isEnumSetting,
} from '../../../lib/chat/picker-catalog.mjs';
import { applySessionSetting } from '../../../lib/chat/session-settings.mjs';
import { LAYER_KEYS } from '../../../lib/chat/config.mjs';
import { resolveTerminalColorScheme } from '../../../lib/chat/tui/color-scheme.mjs';

const ChatThemeContext = createContext(createTheme());

function useChatTheme() {
  return useContext(ChatThemeContext);
}

function EmptyState({ model, savedModel, demoGuide, demoTitle }) {
  const { palette, glyphs } = useChatTheme();
  const { provider, name } = splitModel(model);
  const saved = savedModel && savedModel !== model ? splitModel(savedModel) : null;
  if (demoGuide?.script) {
    return (
      <Box flexDirection="column" paddingY={1}>
        <Text color={palette.accent} bold>{`${glyphs.brand} demo: ${demoTitle || demoGuide.script.title}`}</Text>
        <Box marginTop={1}>
          <Text color={palette.muted} wrap="wrap">{demoGuide.script.summary}</Text>
        </Box>
        <Box marginTop={1} flexDirection="column">
          <Text color={palette.muted}>Steps — type /demo next for the next prompt</Text>
          {demoGuide.script.steps.map((step, i) => (
            <Text key={i} color={palette.text}>{`  ${i + 1}. ${step.title || 'step'}`}</Text>
          ))}
        </Box>
      </Box>
    );
  }
  return (
    <Box flexDirection="column" paddingY={1}>
      <Text color={palette.accent} bold>{`${glyphs.brand} welcome to construct chat`}</Text>
      <Box marginTop={1}>
        <Text color={palette.muted} wrap="wrap">
          Each turn shows route, thinking, tools, sources, and usage inline before the answer. Session metrics stay in the rail on the right. /set toggles layers; /inspect expands tool detail.
        </Text>
      </Box>
      <Box marginTop={1} flexDirection="column">
        <Text color={palette.muted}>To get going</Text>
        <Text color={palette.text}>{`  ${glyphs.caret} ask a question or describe the change you want`}</Text>
        <Text color={palette.muted}>{`  ${glyphs.caret} shift+enter newline   tab completes /commands   /model /set open searchable pickers`}</Text>
        <Text color={palette.muted}>{`  ${glyphs.caret} construct chat --resume restores the last session`}</Text>
      </Box>
      {name && name !== '(no model)' ? (
        <Box marginTop={1} flexDirection="column">
          <Box>
            <Text color={palette.muted}>{`active model `}</Text>
            <Text color={palette.text} bold>{provider ? `${provider}/${name}` : name}</Text>
          </Box>
          {saved ? (
            <Box marginTop={0}>
              <Text color={palette.warn} wrap="wrap">
                {`saved ${saved.provider ? `${saved.provider}/` : ''}${saved.name} — OpenRouter unavailable; /model to change`}
              </Text>
            </Box>
          ) : null}
        </Box>
      ) : (
        <Box marginTop={1}><Text color={palette.warn}>{`${glyphs.caret} no model selected — set one with /model or a provider key`}</Text></Box>
      )}
    </Box>
  );
}

function ConversationColumn({
  width, turnBlocks, activeTurn, liveAssistant, liveThinking, layers, working, model, savedModel,
  detailDense, theme, demoGuide, demoTitle,
}) {
  if (!turnBlocks.length && !activeTurn) {
    return (
      <Box flexDirection="column" width={width} paddingRight={2}>
        <EmptyState model={model} savedModel={savedModel} demoGuide={demoGuide} demoTitle={demoTitle} />
      </Box>
    );
  }

  const completed = activeTurn ? turnBlocks.slice(0, -1) : turnBlocks;
  let turnNum = 0;

  return (
    <Box flexDirection="column" width={width} paddingRight={2}>
      {completed.map((item) => {
        if (item.kind === 'system') {
          return <SystemLogLine key={`sys-${item.text?.slice(0, 24)}-${turnNum}`} text={item.text} width={width} palette={theme.palette} />;
        }
        if (item.kind !== 'turn') return null;
        turnNum += 1;
        return (
          <CompactTurnLog
            key={item.block.id}
            turn={item.block}
            width={width}
            layers={layers}
            turnIndex={turnNum}
            detailDense={detailDense}
            theme={theme}
          />
        );
      })}
      {activeTurn ? (
        <CompactTurnLog
          turn={activeTurn}
          width={width}
          layers={layers}
          liveAssistant={liveAssistant}
          liveThinking={liveThinking}
          working={working}
          turnIndex={turnNum + 1}
          detailDense={detailDense}
          theme={theme}
        />
      ) : null}
    </Box>
  );
}

function Footer({
  cols, input, working, notice, permissionActive, listPickerActive, pickerQuery, ghost, suggestHint,
}) {
  const { palette, glyphs } = useChatTheme();
  return (
    <Box flexDirection="column">
      <Rule width={cols} palette={palette} />
      {notice ? <Text color={palette.warn}>{notice}</Text> : null}
      {suggestHint && !listPickerActive && !permissionActive ? (
        <Text color={palette.muted} wrap="wrap">{`tab complete   ${suggestHint}`}</Text>
      ) : null}
      <Box>
        <Text color={palette.accent} bold>
          {permissionActive ? `${glyphs.caret} permission ` : listPickerActive ? `${glyphs.caret} pick ` : `you ${glyphs.caret} `}
        </Text>
        {listPickerActive ? (
          <Text color={palette.text}>{pickerQuery || ''}</Text>
        ) : (
          <>
            <Text color={palette.text}>{input}</Text>
            {ghost ? <Text color={palette.muted}>{ghost}</Text> : null}
          </>
        )}
        {!permissionActive && !listPickerActive && !working ? <Text color={palette.muted}>{glyphs.block}</Text> : null}
      </Box>
      <Text color={palette.muted}>
        {permissionActive
          ? '↑/↓ move   enter select   y/a/n shortcut   esc cancel'
          : listPickerActive
            ? 'type to filter   ↑/↓ move   enter select   esc cancel'
            : `enter send   tab complete   shift+enter newline   ${glyphs.gutter}   /help   Ctrl+1-5 layers   Ctrl-C ${working ? 'cancel' : 'exit'}`}
      </Text>
    </Box>
  );
}

function toggleDetailDense(session) {
  session.detailDense = !session.detailDense;
  return session.detailDense ? 'expanded' : 'compact';
}

function App({
  driver, session, layers, planTurn, persist, cwd, permissionBridge, env = process.env,
  initialTurnBlocks = [], initialTranscript = [],
}) {
  const { exit } = useApp();
  const { stdout } = useStdout();
  const [cols, setCols] = useState(stdout?.columns || 100);

  useEffect(() => {
    const onResize = () => setCols(stdout?.columns || 100);
    stdout?.on?.('resize', onResize);
    return () => stdout?.off?.('resize', onResize);
  }, [stdout]);

  const [uiEpoch, setUiEpoch] = useState(0);
  const theme = useMemo(() => createTheme({
    ascii: Boolean(session.ui?.ascii),
    scheme: resolveTerminalColorScheme(env, session.ui?.theme),
  }), [uiEpoch, session.ui?.ascii, session.ui?.theme, env]);
  const { spinnerFrames } = theme;

  const commands = useMemo(
    () => createCommands({
      driver,
      host: 'construct',
      hostId: 'construct',
      cwd,
      turnBlocksRef: () => turnBlocksRef.current,
      demoGuide: session.demoGuide || null,
    }),
    [driver, cwd, session.demoGuide],
  );

  const seedBlocks = initialTurnBlocks?.length
    ? initialTurnBlocks
    : turnBlocksFromTranscript(initialTranscript);

  const [turnBlocks, setTurnBlocks] = useState(seedBlocks);
  const turnBlocksRef = useRef(seedBlocks);
  turnBlocksRef.current = turnBlocks;
  const [activeTurn, setActiveTurn] = useState(null);
  const [liveAssistant, setLiveAssistant] = useState('');
  const [liveThinking, setLiveThinking] = useState('');
  const [plan, setPlan] = useState([]);
  const [permissions, setPermissions] = useState([]);
  const [lastTurnUsage, setLastTurnUsage] = useState(null);
  const [working, setWorking] = useState(false);
  const [input, setInput] = useState('');
  const [notice, setNotice] = useState(session.modelNotice || '');
  const [ctx, setCtx] = useState(null);
  const [frame, setFrame] = useState(0);
  const [listPicker, setListPicker] = useState(null);
  const [routeOverlay, setRouteOverlay] = useState(null);
  const [, forceTick] = useState(0);
  const busy = useRef(false);
  const inputHistory = useRef([]);
  const historyPos = useRef(-1);
  const activeTurnRef = useRef(null);

  const workingBranch = useMemo(() => {
    try {
      return buildPlanContext({ session, cwd, turnBlocks, text: '' }).workingBranch || null;
    } catch {
      return null;
    }
  }, [cwd, session, turnBlocks.length]);

  const railWidth = Math.min(36, Math.max(28, Math.floor(cols * 0.15)));
  const convWidth = Math.max(20, cols - railWidth - 2);
  const spin = spinnerFrames[frame];

  const inputGhost = useMemo(() => {
    if (listPicker || !input.trimStart().startsWith('/')) return '';
    return slashCommandGhost(input);
  }, [input, listPicker]);

  const inputSuggestHint = useMemo(() => {
    if (listPicker || !input.trimStart().startsWith('/')) return '';
    return commandSuggestHint(input);
  }, [input, listPicker]);

  const openModelPicker = useCallback(async () => {
    const items = await loadModelPickerItems(driver, {
      env,
      currentModel: session.model,
      modelMode: session.modelMode || 'pinned',
    });
    if (!items.length) {
      setNotice('no models to pick from — use /model <id>');
      return;
    }
    setListPicker(createListPickerState({
      kind: 'model',
      title: 'Select a model',
      items,
      selectedId: pickerSelectedId(session),
    }));
    setNotice('');
  }, [driver, env, session.model]);

  const openSettingKeyPicker = useCallback(() => {
    setListPicker(createListPickerState({
      kind: 'setting-key',
      title: 'Select a setting',
      items: settingKeyPickerItems(),
    }));
    setNotice('');
  }, []);

  const commitListPicker = useCallback(async () => {
    if (!listPicker) return;
    const item = getPickerSelectedItem(listPicker);
    if (!item) return;

    if (listPicker.kind === 'model') {
      if (item.disabled) {
        setNotice(item.detail || 'OpenRouter not configured — set OPENROUTER_API_KEY in ~/.construct/config.env');
        return;
      }
      const selection = await resolveModelPickerSelection(item, { env });
      if (!selection) {
        setNotice('free router unavailable — set OPENROUTER_API_KEY in ~/.construct/config.env');
        setListPicker(null);
        return;
      }
      commitPickerModel(session, selection, { cwd, layers: session.layers });
      const label = selection.mode === 'free-router'
        ? `free-router → ${selection.modelId}`
        : selection.modelId;
      setNotice(`model set: ${label} (saved)`);
      setListPicker(null);
      setUiEpoch((n) => n + 1);
      return;
    }

    if (listPicker.kind === 'permission') {
      listPicker.context?.resolve?.(item.id);
      setListPicker(null);
      return;
    }

    if (listPicker.kind === 'setting-key') {
      const key = item.id;
      if (key === 'model') {
        setListPicker(null);
        await openModelPicker();
        return;
      }
      if (isBoolSetting(key)) {
        setListPicker(createListPickerState({
          kind: 'setting-value',
          title: `Set ${key}`,
          items: BOOL_PICKER_ITEMS,
          context: { key },
        }));
        return;
      }
      if (isEnumSetting(key)) {
        const selectedId = key === 'inspector' ? session.ui?.inspector
          : key === 'theme' ? session.ui?.theme
            : key === 'permission' ? session.permissionMode
              : session.sandbox;
        setListPicker(createListPickerState({
          kind: 'setting-value',
          title: `Set ${key}`,
          items: enumPickerItems(key),
          selectedId,
          context: { key },
        }));
        return;
      }
    }

    if (listPicker.kind === 'setting-value') {
      const key = listPicker.context?.key;
      const result = applySessionSetting(session, layers, key, item.id, { cwd });
      if (!result.ok) setNotice(result.error || 'invalid setting');
      else setNotice(`set: ${result.key} = ${result.value} (saved)`);
      setListPicker(null);
      setUiEpoch((n) => n + 1);
    }
  }, [cwd, env, layers, listPicker, openModelPicker, session]);

  useEffect(() => {
    if (permissionBridge) {
      permissionBridge.prompt = (req) => new Promise((resolve) => {
        setListPicker(createListPickerState({
          kind: 'permission',
          title: `Allow "${req.tool || 'tool'}"?`,
          items: PERMISSION_PICKER_ITEMS,
          context: { resolve, req },
        }));
      });
      return () => { permissionBridge.prompt = null; };
    }
    return undefined;
  }, [permissionBridge]);

  useEffect(() => {
    if (!working) return undefined;
    const timer = setInterval(() => setFrame((f) => (f + 1) % spinnerFrames.length), 90);
    return () => clearInterval(timer);
  }, [working, spinnerFrames.length]);

  const bumpTurnBlocks = useCallback((turn) => {
    setTurnBlocks((prev) => {
      const idx = prev.findIndex((b) => b.kind === 'turn' && b.block.id === turn.id);
      if (idx >= 0) {
        const next = [...prev];
        next[idx] = { kind: 'turn', block: { ...turn } };
        return next;
      }
      return [...prev, { kind: 'turn', block: { ...turn } }];
    });
  }, []);

  const resolvePermission = useCallback((decision) => {
    if (listPicker?.kind === 'permission') {
      listPicker.context?.resolve?.(decision);
      setListPicker(null);
    }
  }, [listPicker]);

  const toggleDetail = useCallback(() => {
    setNotice(`tool detail: ${toggleDetailDense(session)}`);
    setUiEpoch((n) => n + 1);
  }, [session]);

  const toggleLayerShortcut = useCallback((layerKey) => {
    const on = layers[layerKey] !== false;
    const result = applySessionSetting(session, layers, layerKey, on ? 'off' : 'on', { cwd });
    if (!result.ok) setNotice(result.error || 'invalid layer');
    else setNotice(`${layerKey}: ${on ? 'off' : 'on'}`);
    setUiEpoch((n) => n + 1);
  }, [cwd, layers, session]);

  const handleCommand = useCallback(async (text) => {
    const trimmed = text.trim();
    if (trimmed === '/inspect') {
      toggleDetail();
      return;
    }
    if (trimmed === '/model' || trimmed === '/models') {
      await openModelPicker();
      return;
    }
    if (trimmed === '/free') {
      const id = await resolveFreeOpenRouterModel({ env, tier: 'standard' });
      if (!id) {
        setNotice('OpenRouter free router needs OPENROUTER_API_KEY');
        return;
      }
      commitPickerModel(session, { mode: 'free-router', modelId: id }, { cwd, layers: session.layers });
      setNotice(`free-router mode → ${id} (saved)`);
      setUiEpoch((n) => n + 1);
      return;
    }
    if (trimmed.startsWith('/export')) {
      const scope = trimmed.split(/\s+/)[1] === 'session' ? 'session' : 'last';
      const result = exportTurns(turnBlocksRef.current, { scope, cwd });
      setNotice(result.ok ? `exported to ${result.path}` : result.error || 'export failed');
      return;
    }
    if (trimmed === '/set') {
      openSettingKeyPicker();
      return;
    }
    const out = createCollectWriter();
    const keep = await commands.handle(text, {
      output: out.stream,
      colors: PLAIN_COLORS,
      layers,
      session,
      rl: null,
      onClear: () => {
        setTurnBlocks([]);
        setActiveTurn(null);
        setNotice('');
        setPlan([]);
        setPermissions([]);
        setRouteOverlay(null);
      },
    });
    const msg = stripAnsi(out.text()).trim();
    if (msg) {
      setTurnBlocks((prev) => [...prev, { kind: 'system', text: msg }]);
    }
    setUiEpoch((n) => n + 1);
    if (!keep) exit();
  }, [commands, env, exit, layers, openModelPicker, openSettingKeyPicker, session, toggleDetail]);

  const submit = useCallback(async (text) => {
    if (!text.trim() || busy.current) return;
    if (text.startsWith('/')) { await handleCommand(text); return; }
    busy.current = true;
    setWorking(true);
    setNotice('');
    if (!inputHistory.current.length || inputHistory.current[inputHistory.current.length - 1] !== text) {
      inputHistory.current.push(text);
    }
    historyPos.current = -1;
    setLiveAssistant('');
    setLiveThinking('');
    setPlan([]);
    setPermissions([]);
    setLastTurnUsage(null);

    const turn = createTurnBlock(text);
    activeTurnRef.current = turn;
    setActiveTurn({ ...turn });
    setTurnBlocks((prev) => [...prev, { kind: 'turn', block: turn }]);

    let overlay = null;
    try {
      overlay = await planTurn?.(text, { turnBlocks: turnBlocksRef.current });
      if (overlay) {
        applyOverlayToTurn(turn, overlay);
        setRouteOverlay(overlay);
      }
      bumpTurnBlocks(turn);
    } catch { /* overlay is best-effort */ }

    try {
      const { state, model, notice: fallbackNotice } = await runTurnWithFallback({
        driver,
        text,
        session,
        layers,
        env,
        promptOptions: {
          permissionMode: session.permissionMode,
          sandbox: session.sandbox,
          turnOverlay: overlay,
        },
        runTurnInto,
        onUpdate: (s, event) => {
          if (persist?.event) { try { persist.event(event); } catch { /* best-effort */ } }
          applyEventToTurn(turn, event, s);
          if (event.type === 'text') setLiveAssistant(s.assistant);
          else if (event.type === 'thinking') setLiveThinking(s.thinking);
          else if (event.type === 'plan') setPlan([...s.plan]);
          else if (event.type === 'permission') setPermissions([...s.permissions]);
          else if (event.type === 'usage') {
            if (event.context) setCtx(event.context);
            setLastTurnUsage(s.lastUsage);
            forceTick((n) => n + 1);
          }
          bumpTurnBlocks(turn);
        },
      });

      if (model && model !== session.model) session.model = model;
      if (fallbackNotice) setNotice(fallbackNotice);

      if (state.assistant) turn.assistant = state.assistant;
      else if (state.error) turn.assistant = `[error] ${parseOpenRouterError(state.error).summary}`;
      else if (!state.rendered) turn.assistant = '[no output] check that a model is selected and the provider is authenticated';

      finalizeTurn(turn);
      bumpTurnBlocks(turn);
      if (persist?.transcriptBlock) {
        try { persist.transcriptBlock(turn); } catch { /* best-effort */ }
      }
    } catch (err) {
      turn.assistant = `[error] ${parseOpenRouterError(err.message).summary}`;
      finalizeTurn(turn);
      bumpTurnBlocks(turn);
    } finally {
      setLiveAssistant('');
      setLiveThinking('');
      setActiveTurn(null);
      activeTurnRef.current = null;
      setWorking(false);
      busy.current = false;
    }
  }, [bumpTurnBlocks, driver, handleCommand, layers, persist, planTurn, session]);

  useInput((char, key) => {
    if (listPicker) {
      if (listPicker.kind === 'permission') {
        const shortcut = parsePermissionKey(char);
        if (shortcut) { resolvePermission(shortcut); return; }
      }
      const { state, action } = reducePickerKey(listPicker, { char, key });
      if (action === 'cancel') { setListPicker(null); return; }
      if (action === 'commit') { commitListPicker(); return; }
      if (state) setListPicker(state);
      return;
    }
    if (key.ctrl && char >= '1' && char <= '5' && !input) {
      toggleLayerShortcut(LAYER_KEYS[Number(char) - 1]);
      return;
    }
    if (key.ctrl && char === 'c') {
      if (busy.current) { try { driver.cancel?.(); } catch { /* nothing to cancel */ } }
      else exit();
      return;
    }
    if (key.ctrl && char === 'o') {
      toggleDetail();
      return;
    }
    if (key.return && (key.shift || key.meta)) {
      setInput((v) => `${v}\n`);
      return;
    }
    if (key.tab) {
      setInput((v) => applyTabCompletion(v));
      return;
    }
    if (key.return) { const text = input; setInput(''); submit(text); return; }
    const slashMode = input.trimStart().startsWith('/') && !input.trim().includes(' ');
    if (key.upArrow) {
      if (slashMode && slashCommandMatches(input).length > 1) {
        setInput((v) => cycleSlashCommand(v, -1));
        return;
      }
      const hist = inputHistory.current;
      if (!hist.length) return;
      const next = historyPos.current < 0 ? hist.length - 1 : Math.max(0, historyPos.current - 1);
      historyPos.current = next;
      setInput(hist[next]);
      return;
    }
    if (key.downArrow) {
      if (slashMode && slashCommandMatches(input).length > 1) {
        setInput((v) => cycleSlashCommand(v, 1));
        return;
      }
      const hist = inputHistory.current;
      if (!hist.length || historyPos.current < 0) return;
      const next = historyPos.current + 1;
      if (next >= hist.length) { historyPos.current = -1; setInput(''); return; }
      historyPos.current = next;
      setInput(hist[next]);
      return;
    }
    if (key.backspace || key.delete) { setInput((v) => v.slice(0, -1)); return; }
    if (char && !key.ctrl && !key.meta) setInput((v) => v + char);
  });

  return (
    <ChatThemeContext.Provider value={theme}>
      <Box flexDirection="column">
        <SessionHeader
          cols={cols}
          session={session}
          layers={layers}
          sandbox={session.sandbox}
          permissionMode={session.permissionMode}
          working={working}
          spin={spin}
          ctx={ctx}
          theme={theme}
          workingBranch={workingBranch}
        />
        {listPicker ? (
          <ListPickerOverlay
            picker={listPicker}
            width={convWidth}
            theme={theme}
            currentId={listPicker.kind === 'model' ? pickerSelectedId(session) : null}
            markerId={listPicker.kind === 'model' && session.modelMode !== 'free-router' ? session.model : null}
          />
        ) : null}
        <Box>
          <ConversationColumn
            width={convWidth}
            turnBlocks={turnBlocks}
            activeTurn={activeTurn}
            liveAssistant={liveAssistant}
            liveThinking={liveThinking}
            layers={layers}
            working={working}
            model={session.model}
            savedModel={session.savedModel}
            detailDense={Boolean(session.detailDense)}
            theme={theme}
            demoGuide={session.demoGuide}
            demoTitle={session.demoTitle}
          />
          <SessionRail
            width={railWidth}
            session={session}
            layers={layers}
            working={working}
            model={session.model}
            modelMode={session.modelMode}
            savedModel={session.savedModel}
            sandbox={session.sandbox}
            permissionMode={session.permissionMode}
            ctx={ctx}
            spin={spin}
            theme={theme}
            cwd={cwd}
            modelNotice={session.modelNotice || notice || ''}
            routeOverlay={routeOverlay}
          />
        </Box>
        <Footer
          cols={cols}
          input={input}
          working={working}
          notice={notice && notice !== session.modelNotice ? notice : ''}
          permissionActive={listPicker?.kind === 'permission'}
          listPickerActive={Boolean(listPicker)}
          pickerQuery={listPicker?.query || ''}
          ghost={inputGhost}
          suggestHint={inputSuggestHint}
        />
      </Box>
    </ChatThemeContext.Provider>
  );
}

export function runInkChat({
  driver, session, layers, planTurn = null, persist = null, cwd = process.cwd(),
  permissionBridge = null, env = process.env,
  initialTurnBlocks = [], initialTranscript = [],
} = {}) {
  const instance = render(
    <App
      driver={driver}
      session={session}
      layers={layers}
      env={env}
      planTurn={planTurn}
      persist={persist}
      cwd={cwd}
      permissionBridge={permissionBridge}
      initialTurnBlocks={initialTurnBlocks}
      initialTranscript={initialTranscript}
    />,
  );
  return instance.waitUntilExit();
}

export { SessionRail, SessionDock, TurnContextBar, TurnTranscript, TurnView, TransparencyPanel, SessionHeader } from './turn-ui.jsx';
export { CompactTurnLog, SystemLogLine, RouteRailPanel } from './event-log-ui.jsx';
export { EmptyState, App, createTheme };
export default runInkChat;
