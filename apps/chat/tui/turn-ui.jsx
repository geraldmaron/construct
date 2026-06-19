/**
 * apps/chat/tui/turn-ui.jsx — inline turn layout components for construct chat.
 *
 * TurnContextBar, ToolTimeline, MarkdownMessage, SessionDock, and TurnInspector
 * render discriminated turn blocks in the conversation column. SessionDock holds
 * session-level telemetry; TurnInspector is the optional deep per-turn panel.
 */

import React from 'react';
import { Box, Text } from 'ink';
import { parseMarkdownLines } from '../../../lib/chat/tui/markdown.mjs';
import { formatTokens, formatUsageFooter } from '../../../lib/chat/tui/usage.mjs';
import { formatTurnUsageLine } from '../../../lib/chat/tui/turn-block.mjs';
import {
  summarizeToolCalls, summarizeSources, contextRows, splitSourceLines,
  formatSourceToolCounts, toolGroupLabel,
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

function TurnSection({ title, width, palette, glyphs, children, marginTop = 1, marginBottom = 1 }) {
  if (!children) return null;
  return (
    <Box flexDirection="column" marginTop={marginTop} marginBottom={marginBottom} width={width}>
      <Text color={palette.muted}>{`${glyphs.gutter} ${title}`}</Text>
      <Box flexDirection="column" paddingLeft={2} marginTop={0}>
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

export function TurnContextBar({ turn, width, layers, palette, glyphs, variant = 'compact' }) {
  const o = turn?.overlay;
  const src = summarizeSources(turn?.sources || []);
  const rows = contextRows(o, { layers });
  if (!rows.length && !src.total && !o) return null;

  const sourceSplit = splitSourceLines(src.refs, { limit: variant === 'compact' ? 4 : 12 });
  const toolCounts = formatSourceToolCounts(src.byTool);

  return (
    <TurnSection title="turn context" width={width} palette={palette} glyphs={glyphs} marginTop={0} marginBottom={0}>
      {rows.map((row) => (
        <ContextRow
          key={row.label}
          label={row.label}
          value={row.value}
          palette={palette}
          valueColor={row.label === 'research' ? palette.warn : row.label === 'route' ? palette.accentAlt : undefined}
        />
      ))}
      <ContextRow
        label="sources"
        value={src.total ? `${src.total} consulted${toolCounts ? ` (${toolCounts})` : ''}` : 'none yet'}
        palette={palette}
      />
      {sourceSplit.lines.map((line) => (
        <Box key={line} paddingLeft={LABEL_WIDTH}><Text color={palette.muted} wrap="wrap">{line}</Text></Box>
      ))}
      {sourceSplit.hidden > 0 ? (
        <Box paddingLeft={LABEL_WIDTH}><Text color={palette.muted}>{`+${sourceSplit.hidden} more`}</Text></Box>
      ) : null}
    </TurnSection>
  );
}

export function ToolTimeline({ tools, width, layers, palette, theme, variant = 'compact' }) {
  if (!tools?.length || layers?.tools === false) return null;
  const groups = summarizeToolCalls(tools);
  const totalCalls = tools.length;

  return (
    <TurnSection
      title={variant === 'compact' ? `tools (${totalCalls} call${totalCalls === 1 ? '' : 's'}, ${groups.length} kind${groups.length === 1 ? '' : 's'})` : `tools (${totalCalls})`}
      width={width}
      palette={palette}
      glyphs={theme.glyphs}
      marginTop={1}
      marginBottom={1}
    >
      {groups.map((group) => (
        <Text key={group.title} color={toolColor(group.status, theme)} wrap="wrap">
          {`${toolGlyph(group.status, theme)} ${toolGroupLabel(group)}`}
        </Text>
      ))}
    </TurnSection>
  );
}

export function ToolDetailList({ tools, width, theme }) {
  if (!tools?.length) return null;
  const { palette } = theme;
  return (
    <Box flexDirection="column" paddingLeft={2}>
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
    <Box flexDirection="column" paddingLeft={1} marginTop={0} width={width}>
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

export function TurnThinking({ text, width, layers, palette, glyphs }) {
  if (!text || layers?.thinking === false) return null;
  return (
    <TurnSection title="thinking" width={width} palette={palette} glyphs={glyphs} marginTop={1} marginBottom={1}>
      <Text color={palette.muted} wrap="wrap">{text}</Text>
    </TurnSection>
  );
}

export function TurnUsageFooter({ usage, width, layers, palette, glyphs }) {
  if (!usage || layers?.observability === false) return null;
  const line = stripAnsi(formatTurnUsageLine(usage, {}));
  return (
    <TurnSection title="turn usage" width={width} palette={palette} glyphs={glyphs} marginTop={1} marginBottom={0}>
      <Text color={palette.muted} wrap="wrap">{line}</Text>
    </TurnSection>
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

export function TurnView({
  turn, width, layers, liveAssistant = '', liveThinking = '', working = false, theme,
}) {
  const { palette, glyphs } = theme;
  const assistant = liveAssistant || turn.assistant || '';
  const thinking = liveThinking || turn.thinking || '';
  const isError = typeof assistant === 'string' && assistant.startsWith('[error]');
  const hasPreflight = turn.overlay || turn.sources?.length || turn.tools?.length || thinking;

  return (
    <Box flexDirection="column" marginBottom={2} width={width}>
      <Box marginBottom={1}>
        <Text backgroundColor={palette.ok} color={palette.badgeFg} bold>{' you '}</Text>
      </Box>
      <Box paddingLeft={1} marginBottom={hasPreflight ? 1 : 0}>
        <Text wrap="wrap">{turn.userText}</Text>
      </Box>

      {hasPreflight ? (
        <Box flexDirection="column" marginBottom={1} paddingX={1}>
          <Rule width={Math.min(width - 4, 52)} palette={palette} />
          <Box marginY={1}>
            <TurnContextBar turn={turn} width={width - 2} layers={layers} palette={palette} glyphs={glyphs} variant="compact" />
            <TurnThinking text={thinking} width={width - 2} layers={layers} palette={palette} glyphs={glyphs} />
            <ToolTimeline tools={turn.tools} width={width - 2} layers={layers} palette={palette} theme={theme} variant="compact" />
          </Box>
          <Rule width={Math.min(width - 4, 52)} palette={palette} />
        </Box>
      ) : null}

      {(assistant || working) ? (
        <Box flexDirection="column" marginTop={1} marginBottom={1}>
          <Box marginBottom={1}>
            <Text backgroundColor={palette.accent} color={palette.badgeFg} bold>{' construct '}</Text>
          </Box>
          {assistant ? <MarkdownMessage text={assistant} width={width} palette={palette} isError={isError} /> : null}
          {working && !assistant ? <Text color={palette.warn}>{`${glyphs.block} working\u2026`}</Text> : null}
          {working && assistant ? <Text color={palette.warn}>{glyphs.block}</Text> : null}
        </Box>
      ) : null}

      <TurnUsageFooter usage={turn.usage} width={width} layers={layers} palette={palette} glyphs={glyphs} />
      {(turn.notices || []).map((n, i) => <SystemNotice key={i} text={n} palette={palette} />)}
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

export function SessionDock({
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

export function TurnInspector({
  width, turn, layers, permissions, plan, lastTurnUsage, theme,
}) {
  const { palette, glyphs } = theme;
  if (!turn) {
    return (
      <Box flexDirection="column" width={width} borderStyle="round" borderColor={palette.muted} paddingX={1}>
        <Text color={palette.muted}>no active turn — submit a prompt or toggle /inspect</Text>
      </Box>
    );
  }

  const turnUsage = lastTurnUsage && layers?.observability
    ? stripAnsi(formatUsageFooter(lastTurnUsage, {})).replace(/^\[usage\] /, '')
    : null;
  const src = summarizeSources(turn.sources || []);
  const groups = summarizeToolCalls(turn.tools || []);

  return (
    <Box flexDirection="column" width={width} borderStyle="round" borderColor={palette.accentAlt} paddingX={1}>
      <Text color={palette.accentAlt} bold>{`${glyphs.brand} inspector`}</Text>

      {contextRows(turn.overlay, { layers }).length > 0 ? (
        <PanelSection title="policy" marginTop={1} palette={palette}>
          {contextRows(turn.overlay, { layers }).map((row) => (
            <ContextRow key={row.label} label={row.label} value={row.value} palette={palette} />
          ))}
        </PanelSection>
      ) : null}

      {src.total > 0 ? (
        <PanelSection title={`sources (${src.total})`} palette={palette}>
          {src.refs.map((ref) => (
            <Text key={ref} color={palette.muted} wrap="wrap">{ref}</Text>
          ))}
        </PanelSection>
      ) : null}

      {turn.thinking && layers?.thinking !== false ? (
        <PanelSection title="thinking" palette={palette}>
          <Text color={palette.muted} wrap="wrap">{turn.thinking}</Text>
        </PanelSection>
      ) : null}

      {groups.length > 0 && layers?.tools !== false ? (
        <PanelSection title={`tools (${turn.tools.length} calls)`} palette={palette}>
          {groups.map((g) => (
            <Text key={g.title} color={toolColor(g.status, theme)} wrap="wrap">
              {`${toolGlyph(g.status, theme)} ${toolGroupLabel(g)}`}
            </Text>
          ))}
          <ToolDetailList tools={turn.tools} width={width - 2} theme={theme} />
        </PanelSection>
      ) : null}

      {layers?.path && plan?.length > 0 ? (
        <PanelSection title="plan" palette={palette}>
          {plan.map((entry, i) => (
            <Text key={`${entry.content}-${i}`} color={palette.muted} wrap="wrap">{`${entry.status === 'completed' ? glyphs.toolDone : glyphs.toolPending} ${entry.content}`}</Text>
          ))}
        </PanelSection>
      ) : null}

      {permissions?.length > 0 ? (
        <PanelSection title="permissions" palette={palette}>
          {permissions.slice(-5).map((entry, i) => (
            <Text key={`${entry.title}-${i}`} color={palette.warn} wrap="wrap">{`${glyphs.gutter} ${entry.title}`}</Text>
          ))}
        </PanelSection>
      ) : null}

      {turnUsage ? (
        <PanelSection title="this turn" palette={palette}>
          <Text color={palette.muted} wrap="wrap">{turnUsage}</Text>
        </PanelSection>
      ) : null}

      {turn.assistant ? (
        <PanelSection title="answer (raw)" palette={palette}>
          <Text wrap="wrap">{turn.assistant.slice(0, 800)}{turn.assistant.length > 800 ? '\u2026' : ''}</Text>
        </PanelSection>
      ) : null}
    </Box>
  );
}

export const TransparencyPanel = SessionDock;
