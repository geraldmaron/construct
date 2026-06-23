/**
 * lib/chat/web-commands.mjs — slash-command handler for dashboard web chat.
 *
 * Mirrors lib/chat/commands.mjs without readline. Returns plain-text output
 * and optional side effects (clear, open picker) for the web cockpit.
 */

import { HELP } from './commands.mjs';
import { LAYER_KEYS, loadChatConfig } from './config.mjs';
import { formatUsagePanel } from './tui/usage.mjs';
import { applySessionSetting } from './session-settings.mjs';
import { commitPickerModel } from './model-picker.mjs';
import { resolveFreeOpenRouterModel } from '../../apps/chat/engine/models.mjs';
import { exportTurns } from './export.mjs';
import { readOracleDockState, formatOracleDockDetail } from '../intake/session-prelude.mjs';
import { handleDemoCommand } from './demo-guide.mjs';

export { HELP };

export async function handleWebChatCommand(input, {
  runtime = null,
  cwd = process.cwd(),
  turnBlocks = [],
  version = null,
} = {}) {
  const text = String(input || '').trim();
  if (!text.startsWith('/')) {
    return { ok: false, error: 'not a command' };
  }

  const [cmd, ...rest] = text.split(/\s+/);
  const arg = rest.join(' ').trim();
  const session = runtime?.session || {};
  const layers = runtime?.layers || {};

  switch (cmd) {
    case '/help': {
      const lines = ['commands'];
      for (const [name, desc] of HELP) lines.push(`  ${name.padEnd(28)}${desc}`);
      return { ok: true, output: lines.join('\n') };
    }

    case '/host': {
      const mode = session.modelMode === 'free-router' ? 'free-router' : 'pinned';
      const lines = [
        `engine: construct (owned loop)${version ? ` (${version})` : ''}  model: ${session.model || '(default)'}  mode: ${mode}`,
        'construct runs the loop itself; switch models with /model',
      ];
      return { ok: true, output: lines.join('\n') };
    }

    case '/models':
    case '/model':
      if (arg) {
        commitPickerModel(session, { mode: 'pinned', modelId: arg }, { cwd, layers });
        return { ok: true, output: `model set: ${arg} (pinned, saved)`, sessionMeta: true };
      }
      return { ok: true, picker: 'model' };

    case '/free': {
      const freeId = await resolveFreeOpenRouterModel({ env: runtime?.env || process.env, tier: 'standard' });
      if (!freeId) return { ok: true, output: 'OpenRouter free router needs OPENROUTER_API_KEY' };
      commitPickerModel(session, { mode: 'free-router', modelId: freeId }, { cwd, layers });
      return { ok: true, output: `model mode: free-router → ${freeId} (saved)`, sessionMeta: true };
    }

    case '/set':
      if (!rest.length) return { ok: true, picker: 'set' };
      return applySetCommand(session, layers, rest, { cwd });

    case '/settings': {
      const { config } = loadChatConfig({ cwd });
      const lines = [
        'settings',
        `  model: ${session.modelMode === 'free-router' ? `free-router → ${session.model || '?'}` : (session.model || '(default)')}`,
        `  permission: ${session.permissionMode || config.permissionMode || 'allow_once'}`,
        `  sandbox: ${session.sandbox || config.sandbox || 'workspace-write'}`,
        `  layers: ${LAYER_KEYS.map((k) => `${k}=${layers[k] !== false ? 'on' : 'off'}`).join('  ')}`,
      ];
      return { ok: true, output: lines.join('\n') };
    }

    case '/layers':
      return {
        ok: true,
        output: [
          `layers: ${LAYER_KEYS.map((k) => `${k}=${layers[k] !== false ? 'on' : 'off'}`).join('  ')}`,
          'toggle with: /set <layer> on|off',
        ].join('\n'),
      };

    case '/usage':
      return { ok: true, output: formatUsagePanel(session.usage || { turns: 0, tokens: {}, cost: { amount: 0 } }) };

    case '/oracle': {
      const state = readOracleDockState({ cwd, env: runtime?.env || process.env });
      return { ok: true, output: `oracle\n${formatOracleDockDetail(state)}` };
    }

    case '/export': {
      const scope = arg === 'session' ? 'session' : 'last';
      const result = exportTurns(turnBlocks, { scope, cwd });
      if (!result.ok) return { ok: true, output: result.error || 'export failed' };
      return { ok: true, output: `exported ${result.count} turn(s) to ${result.path}` };
    }

    case '/clear':
      return { ok: true, clear: true };

    case '/demo': {
      const guide = runtime?.session?.demoGuide;
      if (!guide) {
        return { ok: true, output: 'No active demo. Launch with `construct demo <name>` or set CONSTRUCT_DEMO.' };
      }
      const chunks = [];
      const output = { write: (text) => { chunks.push(String(text)); } };
      handleDemoCommand(arg, {
        demoGuide: guide,
        output,
        colors: { dim: '', reset: '', bold: '', green: '' },
      });
      return { ok: true, output: chunks.join('').trim() || 'demo command complete' };
    }

    case '/inspect':
      return { ok: true, output: 'inspector toggle is Ink-only; web shows full inline detail by default' };

    case '/exit':
    case '/quit':
      return { ok: true, output: 'exit is terminal-only — close the tab or navigate away' };

    default:
      return { ok: true, output: `unknown command: ${cmd} — try /help` };
  }
}

function applySetCommand(session, layers, rest, { cwd }) {
  const [key, ...valueParts] = rest;
  if (!key) return { ok: true, picker: 'set' };
  const rawValue = valueParts.join(' ').trim();
  if (!rawValue) return { ok: true, output: `usage: /set ${key} <on|off|value>` };

  const result = applySessionSetting(session, layers, key, rawValue, { cwd, hostId: 'construct' });
  if (!result.ok) return { ok: true, output: result.error || 'invalid setting' };
  return { ok: true, output: `${result.key}: ${result.value}`, sessionMeta: true, layers: { ...layers } };
}
