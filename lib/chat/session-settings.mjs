/**
 * lib/chat/session-settings.mjs — apply validated chat settings to session + config.
 *
 * Shared by slash commands and Ink list pickers so /set and picker commits stay aligned.
 */

import { saveChatConfig, validateSetting } from './config.mjs';

export function applySessionSetting(session, layers, key, rawValue, { cwd, hostId = 'construct' } = {}) {
  const result = validateSetting(key, rawValue);
  if (!result.ok) return result;

  const targetKey = result.key || key;
  if (targetKey.startsWith('layers.')) {
    const layer = targetKey.slice('layers.'.length);
    layers[layer] = result.value;
    session.layers = { ...layers };
  } else if (targetKey === 'thinking') {
    layers.thinking = result.value;
    session.layers = { ...layers };
    session.thinking = result.value;
  } else if (targetKey === 'model') {
    session.model = result.value;
    session.modelMode = 'pinned';
    session.savedModel = result.value;
    session.modelNotice = null;
  } else if (targetKey === 'permissionMode') {
    session.permissionMode = result.value;
  } else if (targetKey === 'sandbox') {
    session.sandbox = result.value;
  } else if (targetKey === 'ui.ascii') {
    session.ui = { ...(session.ui || { ascii: false, inspector: 'auto', theme: 'auto' }), ascii: result.value };
  } else if (targetKey === 'ui.inspector') {
    session.ui = { ...(session.ui || { ascii: false, inspector: 'auto', theme: 'auto' }), inspector: result.value };
  } else if (targetKey === 'ui.theme') {
    session.ui = { ...(session.ui || { ascii: false, inspector: 'auto', theme: 'auto' }), theme: result.value };
  }

  try {
    saveChatConfig({
      host: hostId,
      model: session.modelMode === 'pinned' ? session.model : null,
      modelMode: session.modelMode || 'pinned',
      layers,
      thinking: layers?.thinking,
      permissionMode: session.permissionMode,
      sandbox: session.sandbox,
      ui: session.ui,
    }, { cwd });
  } catch { /* persistence is best-effort */ }

  return { ok: true, key: targetKey, value: result.value };
}
