/**
 * apps/chat/tui/turn-ui.jsx — transparency-first transcript layout for construct chat.
 *
 * TurnTranscript renders each turn as ordered phases (route, thinking, tools,
 * sources, answer, usage). SessionHeader holds session telemetry; SessionRail
 * (SessionDock) is the persistent right rail for session-level metrics only.
 */

import React from 'react';
import { Box, Text } from 'ink';
import { parseMarkdownLines } from '../../../lib/chat/tui/markdown.mjs';
import { formatTokens, formatUsageFooter } from '../../../lib/chat/tui/usage.mjs';
import { formatTurnUsageLine } from '../../../lib/chat/tui/turn-block.mjs';
import {
  summarizeToolCalls, summarizeSources, contextRows, splitSourceLines,
  toolGroupLabel,
} from '../../../lib/chat/tui/turn-present.mjs';
import { LAYER_KEYS } from '../../../lib/chat/config.mjs';
import { stripAnsi } from '../../../lib/term-format.mjs';
import { toolGlyph, toolColor, splitModel, meter, ratioColor, percent } from './theme.mjs';
import { formatModelHeader } from '../../../lib/chat/model-picker.mjs';
import { readOracleDockState } from '../../../lib/intake/session-prelude.mjs';

const LABEL_WIDTH = 10;

export function Rule({ width, color, palette, glyphs, heavy = false }) {
  const muted = color || palette?.muted || 'gray';
  const char = heavy && glyphs?.ruleHeavy ? glyphs.ruleHeavy : '\u2500';
  return <Text color={muted}>{char.repeat(Math.max(1, width))}</Text>;
}

function TurnPhase({ title, width, palette, glyphs, children, marginTop = 1, marginBottom = 0 }) {
  if (!children) return null;
  return (
    <Box flexDirection="column" marginTop={marginTop} marginBottom={marginBottom} width={width}>
      <Text color={palette.accent} bold>{title}</Text>
      <Box flexDirection="column" paddingLeft={2} borderStyle="single" borderColor={palette.border || palette.muted} borderLeft paddingX={1}>
        {children}
      </Box>
    </Box>
  );
}

function ContextRow({ label, value, palette, valueColor }) {
  return (
    <Box flexDirection="row" marginBottom={0}>
      <Box width={LABEL_WIDTH}><Text color={palette.muted}>{label}</Text></Box>
      <Text color={valueColor || undefined} wrap="wrap">{value}</Text>
    </Box>
  );
}

function RoutePhase({ turn, width, layers, palette, glyphs }) {
  const rows = contextRows(turn?.overlay, { layers });
  if (!rows.length) return null;
  return (
    <TurnPhase title="ROUTE" width={width} palette={palette} glyphs={glyphs}>
      {rows.map((row) => (
        <ContextRow
          key={row.label}
          label={row.label}
          value={row.value}
          palette={palette}
          valueColor={row.label === 'research' ? palette.warn : row.label === 'route' ? palette.accentAlt : undefined}
        />
      ))}
    </TurnPhase>
  );
}

function ThinkingPhase({ text, width, layers, palette, glyphs }) {
  if (!text || layers?.thinking === false) return null;
  return (
    <TurnPhase title="THINKING" width={width} palette={palette} glyphs={glyphs}>
      <Text color={palette.muted} wrap="wrap">{text}</Text>
    </TurnPhase>
  );
}

function ToolsPhase({ tools, width, layers, palette, theme, detailDense = false }) {
  if (!tools?.length || layers?.tools === false) return null;
  const groups = summarizeToolCalls(tools);
  return (
    <TurnPhase title="TOOLS" width={width} palette={palette} glyphs={theme.glyphs}>
      {groups.map((group) => (
        <Text key={group.title} color={toolColor(group.status, theme)} wrap="wrap">
          {`${toolGlyph(group.status, theme)} ${toolGroupLabel(group)}`}
        </Text>
      ))}
      {detailDense ? <ToolDetailList tools={tools} width={width - 4} theme={theme} /> : null}
    </TurnPhase>
  );
}

function SourcesPhase({ turn, width, layers, palette, glyphs }) {
  const src = summarizeSources(turn?.sources || []);
  if (!src.total) return null;
  const split = splitSourceLines(src.refs, { limit: 12 });
  return (
    <TurnPhase title="SOURCES" width={width} palette={palette} glyphs={glyphs}>
      {split.lines.map((line) => (
        <Text key={line} color={palette.muted} wrap="wrap">{line}</Text>
      ))}
      {split.hidden > 0 ? (
        <Text color={palette.muted}>{`+${split.hidden} more`}</Text>
      ) : null}
    </TurnPhase>
  );
}

function AnswerPhase({
  assistant, working, width, palette, glyphs, theme, isError,
}) {
  if (!assistant && !working) return null;
  return (
    <Box flexDirection="column" marginTop={1} marginBottom={1} width={width}>
      <TurnPhase title="CONSTRUCT" width={width} palette={palette} glyphs={glyphs} marginTop={0}>
        {assistant ? <MarkdownMessage text={assistant} width={width - 4} palette={palette} isError={isError} /> : null}
        {working && !assistant ? <Text color={palette.warn}>{`${glyphs.block} working\u2026`}</Text> : null}
        {working && assistant ? <Text color={palette.warn}>{glyphs.block}</Text> : null}
      </TurnPhase>
    </Box>
  );
}

function TurnMetricsPhase({ usage, width, layers, palette, glyphs }) {
  if (!usage || layers?.observability === false) return null;
  const line = stripAnsi(formatTurnUsageLine(usage, {}));
  return (
    <TurnPhase title="USAGE" width={width} palette={palette} glyphs={glyphs} marginBottom={1}>
      <Text color={palette.muted} wrap="wrap">{line}</Text>
    </TurnPhase>
  );
}

export function ToolDetailList({ tools, width, theme }) {
  if (!tools?.length) return null;
  return (
    <Box flexDirection="column" marginTop={0}>
      {tools.map((tool) => {
        const ref = tool.input?.path || tool.input?.pattern || tool.input?.glob || tool.input?.name;
        const detail = ref ? `  ${ref}` : '';
        return (
          <Text key={tool.id} color={toolColor(tool.status, theme)} wrap="wrap">
            {`${toolGlyph(tool.status, theme)} ${tool.title || 'tool'}${detail}`}
          </Text>
        );
      })}
    </Box>
  );
}

export function MarkdownMessage({ text, width, palette, isError = false }) {
  if (!text) return null;
  const parts = parseMarkdownLines(text, { width: Math.max(20, width - 2) });
  return (
    <Box flexDirection="column" marginTop={0} width={width}>
      {parts.map((part, i) => {
        if (part.type === 'heading') {
          return (
            <Box key={i} marginTop={i > 0 ? 1 : 0}>
              <Text bold color={isError ? palette.danger : palette.text} wrap="wrap">{part.text}</Text>
            </Box>
          );
        }
        if (part.type === 'bullet') {
          const pad = '  '.repeat(part.indent || 0);
          return <Text key={i} wrap="wrap">{`${pad}${'\u2022'} ${part.text}`}</Text>;
        }
        if (part.type === 'code') {
          return <Text key={i} color={palette.muted} wrap="wrap">{`  ${part.text}`}</Text>;
        }
        if (part.type === 'rule') {
          return <Rule key={i} width={Math.min(width, 40)} palette={palette} />;
        }
        if (part.type === 'blank') return <Box key={i} height={1} />;
        return (
          <Text key={i} color={isError ? palette.danger : undefined} wrap="wrap">{part.text || ''}</Text>
        );
      })}
    </Box>
  );
}

export function TurnContextBar({ turn, width, layers, palette, glyphs }) {
  return (
    <>
      <RoutePhase turn={turn} width={width} layers={layers} palette={palette} glyphs={glyphs} />
      <SourcesPhase turn={turn} width={width} layers={layers} palette={palette} glyphs={glyphs} />
    </>
  );
}

export function SystemNotice({ text, palette }) {
  if (!text) return null;
  return (
    <Box marginTop={1} marginBottom={1}>
      <Text color={palette.warn} wrap="wrap">{text}</Text>
    </Box>
  );
}

export function TurnTranscript({
  turn, width, layers, liveAssistant = '', liveThinking = '', working = false,
  turnIndex = null, detailDense = false, theme,
}) {
  const { palette, glyphs } = theme;
  const assistant = liveAssistant || turn.assistant || '';
  const thinking = liveThinking || turn.thinking || '';
  const isError = typeof assistant === 'string' && assistant.startsWith('[error]');

  return (
    <Box flexDirection="column" marginBottom={2} width={width}>
      {turnIndex != null ? (
        <Box marginBottom={0}>
          <Text color={palette.muted} bold>{`TURN ${turnIndex}`}</Text>
        </Box>
      ) : null}

      <TurnPhase title="YOU" width={width} palette={palette} glyphs={glyphs} marginTop={turnIndex != null ? 0 : 0}>
        <Text wrap="wrap">{turn.userText}</Text>
      </TurnPhase>

      <RoutePhase turn={turn} width={width} layers={layers} palette={palette} glyphs={glyphs} />
      <ThinkingPhase text={thinking} width={width} layers={layers} palette={palette} glyphs={glyphs} />
      <ToolsPhase tools={turn.tools} width={width} layers={layers} palette={palette} theme={theme} detailDense={detailDense} />
      <SourcesPhase turn={turn} width={width} layers={layers} palette={palette} glyphs={glyphs} />
      <AnswerPhase
        assistant={assistant}
        working={working}
        width={width}
        palette={palette}
        glyphs={glyphs}
        theme={theme}
        isError={isError}
      />
      <TurnMetricsPhase usage={turn.usage} width={width} layers={layers} palette={palette} glyphs={glyphs} />
      {(turn.notices || []).map((n, i) => <SystemNotice key={i} text={n} palette={palette} />)}
    </Box>
  );
}

export const TurnView = TurnTranscript;

function sessionUsageSummary(session) {
  const t = session?.usage?.tokens || {};
  const parts = [];
  if (t.total) parts.push(`${formatTokens(t.total)} tok`);
  if (session?.usage?.cost?.amount > 0) {
    const c = session.usage.cost.amount;
    parts.push(`~$${c.toFixed(c < 1 ? 3 : 2)}`);
  }
  if (session?.usage?.turns) parts.push(`${session.usage.turns} turn${session.usage.turns === 1 ? '' : 's'}`);
  return parts.join(' \u00b7 ') || 'no tokens yet';
}

function layerPills(layers, palette, glyphs) {
  return LAYER_KEYS.map((k) => {
    const on = layers?.[k] !== false;
    return `${k}${on ? '' : '\u2717'}`;
  }).join(`  ${glyphs.gutter}  `);
}

export function SessionHeader({
  cols, session, layers, sandbox, permissionMode, working, spin, ctx, theme, workingBranch,
}) {
  const { palette, glyphs } = theme;
  const { label, isRouter } = formatModelHeader(session);
  const ctxMeter = ctx?.size ? meter(ctx.used, ctx.size, Math.max(12, Math.floor(cols * 0.18)), theme) : null;

  return (
    <Box flexDirection="column" marginBottom={0}>
      <Box width={cols} justifyContent="space-between">
        <Box>
          <Text color={palette.accent} bold>{`${glyphs.brand} construct`}</Text>
          <Text color={palette.muted}>{`  ${glyphs.gutter}  chat`}</Text>
        </Box>
        <Box flexDirection="column" alignItems="flex-end">
          <Box>
            <Text bold color={palette.text} wrap="wrap">{label || '(no model)'}</Text>
            <Text color={palette.muted}>{`   ${sandbox || 'workspace-write'}  ${glyphs.gutter}  ${permissionMode || 'allow_once'}  `}</Text>
            <Text color={working ? palette.warn : palette.ok}>{working ? spin : glyphs.dot}</Text>
          </Box>
          {isRouter ? (
            <Text color={palette.muted} wrap="wrap">free-router \u2014 re-picks on launch and on failure</Text>
          ) : null}
        </Box>
      </Box>

      <Box width={cols} marginTop={0} flexDirection="row" justifyContent="space-between">
        <Box flexDirection="row">
          {ctxMeter ? (
            <>
              <Text color={palette.muted}>context </Text>
              <Text color={ratioColor(ctxMeter.ratio, theme)}>{ctxMeter.bar}</Text>
              <Text color={palette.muted}>{` ${percent(ctxMeter.ratio)}`}</Text>
            </>
          ) : (
            <Text color={palette.muted}>context not reported yet</Text>
          )}
        </Box>
        <Text color={palette.muted} wrap="wrap">{`session ${sessionUsageSummary(session)}`}</Text>
      </Box>

      <Box width={cols} marginTop={0}>
        <Text color={palette.muted} wrap="wrap">
          {`layers ${layerPills(layers, palette, glyphs)}`}
          {workingBranch ? `  ${glyphs.gutter}  branch ${workingBranch}` : ''}
        </Text>
      </Box>

      <Rule width={cols} palette={palette} glyphs={glyphs} heavy />
    </Box>
  );
}

function PanelSection({ title, children, marginTop = 1, palette }) {
  return (
    <Box flexDirection="column" marginTop={marginTop}>
      <Text color={palette.accent}>{title}</Text>
      {children}
    </Box>
  );
}

export function SessionRail({
  width, session, layers, working, model, modelMode, savedModel, sandbox, permissionMode,
  ctx, spin, theme, cwd, modelNotice,
}) {
  const { palette, glyphs } = theme;
  const u = session.usage;
  const t = u.tokens || {};
  const ledger = [];
  if (t.input) ledger.push(['prompt', formatTokens(t.input)]);
  if (t.output) ledger.push(['output', formatTokens(t.output)]);
  if (t.reasoning) ledger.push(['reasoning', formatTokens(t.reasoning)]);
  if (t.total) ledger.push(['total', formatTokens(t.total)]);
  if (u.cost?.amount > 0) ledger.push(['cost', `~$${u.cost.amount.toFixed(u.cost.amount < 1 ? 3 : 2)}`]);
  const ctxMeter = ctx?.size ? meter(ctx.used, ctx.size, Math.max(10, width - 8), theme) : null;
  const { label } = formatModelHeader({ model, modelMode, savedModel });
  const oracle = readOracleDockState({ cwd, env: process.env });

  return (
    <Box flexDirection="column" width={width} borderStyle="round" borderColor={palette.border || palette.accent} paddingX={1}>
      <Text color={palette.brandAccent || palette.accent} bold>{`${glyphs.brand} session`}</Text>
      <Rule width={width - 2} palette={palette} glyphs={glyphs} heavy />
      <PanelSection title="model" marginTop={1} palette={palette}>
        <Text bold color={palette.text} wrap="wrap">{label || '(none)'}</Text>
        {modelNotice ? (
          <Text color={palette.warn} wrap="wrap">{modelNotice}</Text>
        ) : null}
        {(sandbox || permissionMode) ? (
          <Text color={palette.muted}>{[sandbox, permissionMode].filter(Boolean).join(` ${glyphs.gutter} `)}</Text>
        ) : null}
      </PanelSection>
      {oracle.visible ? (
        <PanelSection title="oracle" palette={palette}>
          <Text color={palette.warn} wrap="wrap">{oracle.summary}</Text>
          {oracle.topGaps.slice(0, 2).map((g) => (
            <Text key={g.id} color={palette.muted} wrap="wrap">{`${g.id}: ${g.detail}`}</Text>
          ))}
          <Text color={palette.muted}>/oracle for detail</Text>
        </PanelSection>
      ) : null}
      <PanelSection title="layers" palette={palette}>
        <Text color={palette.muted} wrap="wrap">
          {LAYER_KEYS.map((k) => `${k}=${layers?.[k] ? 'on' : 'off'}`).join(`  ${glyphs.gutter}  `)}
        </Text>
      </PanelSection>
      <PanelSection title="context" palette={palette}>
        {ctxMeter ? (
          <Box flexDirection="column">
            <Text color={ratioColor(ctxMeter.ratio, theme)}>{ctxMeter.bar}</Text>
            <Text color={palette.muted}>{`${formatTokens(ctx.used)}/${formatTokens(ctx.size)}  ${percent(ctxMeter.ratio)}`}</Text>
          </Box>
        ) : (
          <Text color={palette.muted}>not reported yet</Text>
        )}
      </PanelSection>
      <PanelSection title={`usage ${glyphs.gutter} ${u.turns} turn${u.turns === 1 ? '' : 's'}`} palette={palette}>
        {ledger.length ? ledger.map(([k, v]) => (
          <Box key={k} justifyContent="space-between">
            <Text color={palette.muted}>{k}</Text>
            <Text>{v}</Text>
          </Box>
        )) : <Text color={palette.muted}>no tokens yet</Text>}
      </PanelSection>
      <Box marginTop={1}>
        <Text color={working ? palette.warn : palette.ok}>{working ? `${spin} working\u2026` : `${glyphs.dot} idle`}</Text>
      </Box>
    </Box>
  );
}

export const SessionDock = SessionRail;
export const TransparencyPanel = SessionRail;
