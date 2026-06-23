/**
 * apps/chat/tui/picker-ui.jsx — searchable list picker overlay for construct chat.
 */

import React from 'react';
import { Box, Text } from 'ink';
import { getPickerVisibleItems, pickerViewport } from '../../../lib/chat/list-picker.mjs';

export function ListPickerOverlay({ picker, width, theme, currentId = null, markerId = null }) {
  const { palette, glyphs } = theme;
  if (!picker?.items?.length) return null;

  const visible = getPickerVisibleItems(picker);
  const { items, offset } = pickerViewport(picker, 14);
  const queryLine = picker.query ? `filter: ${picker.query}` : 'type to search';

  return (
    <Box flexDirection="column" marginY={1} borderStyle="round" borderColor={palette.accent} paddingX={1} width={Math.min(width, 80)}>
      <Text color={palette.accent} bold>{picker.title || 'select'}</Text>
      <Text color={palette.muted}>{`${queryLine}   ${glyphs.gutter}   ↑/↓ move   enter select   esc cancel`}</Text>
      {!visible.length ? (
        <Text color={palette.warn}>no matches — backspace to edit filter</Text>
      ) : items.map((item, i) => {
        const absolute = offset + i;
        const selected = absolute === picker.index;
        const marked = (markerId && item.id === markerId) || (currentId && item.id === currentId);
        const muted = item.disabled && !selected;
        return (
          <Text key={`${item.id}-${absolute}`} color={selected ? palette.accent : muted ? palette.muted : undefined} bold={selected} wrap="wrap">
            {`${selected ? glyphs.caret : ' '} ${String(absolute + 1).padStart(2)}. ${marked ? `${glyphs.dot} ` : '  '}${item.label || item.id}`}
            {item.tag ? <Text color={palette.muted}>{` [${item.tag}]`}</Text> : null}
            {item.detail ? <Text color={item.disabled ? palette.warn : palette.muted}>{` — ${item.detail}`}</Text> : null}
          </Text>
        );
      })}
      {visible.length > items.length ? (
        <Text color={palette.muted}>{`${offset + 1}-${offset + items.length} of ${visible.length} shown (${picker.items.length} total)`}</Text>
      ) : visible.length ? (
        <Text color={palette.muted}>{`${visible.length} item${visible.length === 1 ? '' : 's'}`}</Text>
      ) : null}
    </Box>
  );
}

export const ModelPickerOverlay = ListPickerOverlay;
