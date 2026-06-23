/**
 * lib/chat/picker-catalog.mjs — predefined list-picker item sets for construct chat.
 */

import { LAYER_KEYS, PERMISSION_MODES, SANDBOX_LEVELS, INSPECTOR_MODES } from './config.mjs';

export const PERMISSION_PICKER_ITEMS = Object.freeze([
  { id: 'allow', label: 'Allow once', detail: 'y' },
  { id: 'allow_always', label: 'Allow always', detail: 'a' },
  { id: 'reject', label: 'Reject', detail: 'n' },
]);

export const BOOL_PICKER_ITEMS = Object.freeze([
  { id: 'on', label: 'on', detail: 'true' },
  { id: 'off', label: 'off', detail: 'false' },
]);

export function settingKeyPickerItems() {
  return [
    { id: 'thinking', label: 'thinking', tag: 'bool' },
    ...LAYER_KEYS.map((k) => ({ id: k, label: k, tag: 'layer' })),
    { id: 'permission', label: 'permission mode', tag: 'enum' },
    { id: 'sandbox', label: 'sandbox', tag: 'enum' },
    { id: 'inspector', label: 'inspector panel', tag: 'enum' },
    { id: 'ascii', label: 'ascii glyphs', tag: 'bool' },
    { id: 'theme', label: 'color theme', tag: 'enum' },
    { id: 'model', label: 'model', tag: 'model' },
  ];
}

export function enumPickerItems(key) {
  if (key === 'permission') return PERMISSION_MODES.map((v) => ({ id: v, label: v }));
  if (key === 'sandbox') return SANDBOX_LEVELS.map((v) => ({ id: v, label: v }));
  if (key === 'inspector') return INSPECTOR_MODES.map((v) => ({ id: v, label: v }));
  if (key === 'theme') return ['auto', 'light', 'dark'].map((v) => ({ id: v, label: v }));
  return [];
}

export function isBoolSetting(key) {
  return key === 'thinking' || key === 'ascii' || LAYER_KEYS.includes(key);
}

export function isEnumSetting(key) {
  return key === 'permission' || key === 'sandbox' || key === 'inspector' || key === 'theme';
}
