/**
 * apps/chat/tui/event-log-ui.jsx — compact mono event log for construct chat Ink.
 *
 * Each turn renders as prefixed log lines (T1 YOU, ROUTE, THINK, TOOL, SRC, OUT,
 * USAGE). Matches the web terminal cockpit event log and replaces boxed TurnPhase
 * layout in the main conversation column.
 */

import React from 'react';
import { Box, Text } from 'ink';
import { parseMarkdownLines } from '../../../lib/chat/tui/markdown.mjs';
import {
  summarizeToolCalls, summarizeSources, formatRouteLogLine,
  formatGateRows,
} from '../../../lib/chat/present.mjs';
import { formatTurnUsageLine } from '../../../lib/chat/tui/turn-block.mjs';
import { stripAnsi } from '../../../lib/term-format.mjs';
import { toolGlyph, toolColor } from './theme.mjs';

function LogLine({ tag, channel, children, palette, channelColor, width }) {
  return (
    <Box width={width} flexDirection="row">
      <Text color={palette.muted}>{`${tag} `}</Text>
      <Text color={channelColor || palette.accent} bold>{`${channel} `}</Text>
      <Box flexGrow={1}>{children}</Box>
    </Box>
  );
}

function routeSummary(overlay) {
  if (!overlay) return null;
  const line = formatRouteLogLine(overlay);
  return line || null;
}

function sourceRefs(sources) {
  const src = summarizeSources(sources || []);
  return src.refs || [];
}

export function SystemLogLine({ text, width, palette }) {
  if (!text) return null;
  return (
    <Box flexDirection="column" marginBottom={1} width={width}>
      <LogLine tag="—" channel="SYS" palette={palette} channelColor={palette.warn} width={width}>
        <Text color={palette.muted} wrap="wrap">{text}</Text>
      </LogLine>
    </Box>
  );
}

export function CompactTurnLog({
  turn, width, layers, turnIndex, liveAssistant = '', liveThinking = '', working = false, theme,
}) {
  const { palette } = theme;
  const tag = `T${turnIndex}`;
  const assistant = liveAssistant || turn.assistant || '';
  const thinking = liveThinking || turn.thinking || '';
  const isError = assistant.startsWith('[error]');
  const toolGroups = summarizeToolCalls(turn.tools || []);
  const refs = sourceRefs(turn.sources);
  const srcLimit = 8;

  return (
    <Box flexDirection="column" marginBottom={1} width={width}>
      <LogLine tag={tag} channel="YOU" palette={palette} width={width}>
        <Text wrap="wrap">{turn.userText}</Text>
      </LogLine>

      {turn.overlay && layers?.specialists !== false && routeSummary(turn.overlay) ? (
        <LogLine tag={tag} channel="ROUTE" palette={palette} channelColor={palette.accentAlt} width={width}>
          <Text color={palette.muted} wrap="wrap">{routeSummary(turn.overlay)}</Text>
        </LogLine>
      ) : null}

      {thinking && layers?.thinking !== false ? (
        <Box flexDirection="column" marginLeft={2} marginBottom={0}>
          <LogLine tag={tag} channel="THINK" palette={palette} width={width}>
            <Text color={palette.muted} wrap="wrap">{thinking}</Text>
          </LogLine>
        </Box>
      ) : null}

      {toolGroups.length > 0 && layers?.tools !== false ? (
        <LogLine tag={tag} channel="TOOL" palette={palette} width={width}>
          <Text wrap="wrap">
            {toolGroups.map((g, i) => (
              <Text key={g.title} color={toolColor(g.status, theme)}>
                {`${i > 0 ? ' ' : ''}${toolGlyph(g.status, theme)} ${g.title}${g.count > 1 ? ` ×${g.count}` : ''}`}
              </Text>
            ))}
          </Text>
        </LogLine>
      ) : null}

      {refs.length > 0 ? (
        <Box flexDirection="column" marginLeft={2}>
          <LogLine tag={tag} channel="SRC" palette={palette} width={width}>
            <Text color={palette.muted} wrap="wrap">{refs.slice(0, srcLimit).join('\n')}</Text>
          </LogLine>
          {refs.length > srcLimit ? (
            <Text color={palette.muted}>{`  +${refs.length - srcLimit} more`}</Text>
          ) : null}
        </Box>
      ) : null}

      {(assistant || working) ? (
        <Box flexDirection="column" marginTop={0}>
          <LogLine tag={tag} channel="OUT" palette={palette} channelColor={palette.ok} width={width}>
            {working && !assistant ? (
              <Text color={palette.warn}>working…</Text>
            ) : null}
          </LogLine>
          {assistant ? (
            <Box marginLeft={2} flexDirection="column">
              <CompactMarkdown text={assistant} width={width - 4} palette={palette} isError={isError} />
            </Box>
          ) : null}
        </Box>
      ) : null}

      {turn.usage && layers?.observability !== false ? (
        <LogLine tag={tag} channel="USAGE" palette={palette} width={width}>
          <Text color={palette.muted} wrap="wrap">{stripAnsi(formatTurnUsageLine(turn.usage))}</Text>
        </LogLine>
      ) : null}
    </Box>
  );
}

function CompactMarkdown({ text, width, palette, isError = false }) {
  const parts = parseMarkdownLines(text, { width: Math.max(20, width - 2) });
  return (
    <Box flexDirection="column">
      {parts.map((part, i) => {
        if (part.type === 'heading') {
          return (
            <Text key={i} bold color={isError ? palette.danger : palette.text} wrap="wrap">{part.text}</Text>
          );
        }
        if (part.type === 'bullet') {
          return <Text key={i} wrap="wrap">{`${'  '.repeat(part.indent || 0)}• ${part.text}`}</Text>;
        }
        if (part.type === 'code') {
          return <Text key={i} color={palette.muted} wrap="wrap">{part.text}</Text>;
        }
        if (part.type === 'blank') return <Box key={i} height={1} />;
        return (
          <Text key={i} color={isError ? palette.danger : undefined} wrap="wrap">{part.text || ''}</Text>
        );
      })}
    </Box>
  );
}

export function RouteRailPanel({ overlay, width, palette, glyphs }) {
  if (!overlay) return null;
  const risks = overlay.riskFlags
    ? Object.entries(overlay.riskFlags).filter(([, v]) => v).map(([k]) => k)
    : [];
  const chain = overlay.specialists || [];
  const gates = formatGateRows(overlay);

  return (
    <Box flexDirection="column" marginTop={1}>
      <Text color={palette.accent}>route</Text>
      {overlay.track ? (
        <Box justifyContent="space-between"><Text color={palette.muted}>track</Text><Text>{overlay.track}</Text></Box>
      ) : null}
      {overlay.intent ? (
        <Box justifyContent="space-between"><Text color={palette.muted}>intent</Text><Text>{overlay.intent}</Text></Box>
      ) : null}
      {risks.length ? (
        <Text color={palette.warn} wrap="wrap">{`risk: ${risks.join(', ')}`}</Text>
      ) : null}
      {chain.length ? (
        <Text wrap="wrap">{chain.join(` ${glyphs.arrow} `)}</Text>
      ) : (
        <Text color={palette.muted}>immediate — Construct responds directly</Text>
      )}
      {overlay.dispatchSummary ? (
        <Text color={palette.muted} wrap="wrap">{overlay.dispatchSummary}</Text>
      ) : null}
      {gates.length ? (
        <Box flexDirection="column" marginTop={1}>
          <Text color={palette.accent}>gates</Text>
          {gates.map((g) => (
            <Text key={g.label} color={palette.warn} wrap="wrap">{`${g.label}: ${g.value}`}</Text>
          ))}
        </Box>
      ) : null}
    </Box>
  );
}
