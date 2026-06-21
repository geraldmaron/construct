/**
 * lib/chat/commands.mjs — in-session slash commands for `construct chat`.
 *
 * Owns the interactive control surface: changing the model, toggling transparency
 * layers, editing and persisting settings, and inspecting token usage — without
 * leaving the chat. Each command mutates the shared `session` object (which the
 * renderer reads per turn) and, for settings, writes through to the project config
 * via lib/chat/config.mjs. handle() returns false only for /exit so the REPL loop
 * stays the single owner of the readline lifecycle. Ink passes `onClear` instead of
 * ANSI clear-screen codes; both surfaces share `createCollectWriter` for capture.
 *
 * Model enumeration is delegated to the driver's optional listModels(); hosts that
 * cannot enumerate models degrade to a clear notice rather than failing.
 */

import { saveChatConfig, LAYER_KEYS, PERMISSION_MODES, SANDBOX_LEVELS } from './config.mjs';
import { exportTurns } from './export.mjs';
import { formatUsagePanel } from './tui/usage.mjs';
import { applySessionSetting } from './session-settings.mjs';
import { commitPickerModel, promptModelPickerTerminal } from './model-picker.mjs';
import { handleDemoCommand, registerDemoCommands } from './demo-guide.mjs';

export const HELP = [
  ['/help', 'show this help'],
  ['/model [id]', 'show or set the model (no id opens a searchable picker)'],
  ['/free', 'set OpenRouter free-router mode (--free equivalent)'],
  ['/export [last|session]', 'write plain markdown answer to .cx/chat-sessions/exports/'],
  ['/set <key> <on|off|value>', 'change a setting (thinking, tools, path, specialists, observability, permission, sandbox, model)'],
  ['/settings', 'show current settings'],
  ['/layers', 'show transparency layers'],
  ['/usage', 'show session token and cost breakdown'],
  ['/oracle', 'show Oracle overseer verdict and pending approvals'],
  ['/host', 'show the active host'],
  ['/clear', 'clear the screen'],
  ['/inspect', 'toggle turn inspector panel (on/off/auto)'],
  ['/exit', 'quit'],
];

function ask(rl, question) {
  return new Promise((resolve) => rl.question(question, (answer) => resolve(answer)));
}

export function createCommands({ driver, host, hostId = host, version, cwd = process.cwd(), env = process.env, turnBlocksRef = null, demoGuide = null } = {}) {
  async function handle(input, ctx) {
    const { output, colors, layers, session, rl, onClear } = ctx;
    const runtimeEnv = ctx.env || env;
    const [cmd, ...rest] = input.trim().split(/\s+/);
    const arg = rest.join(' ').trim();
    const activeGuide = demoGuide || session?.demoGuide || null;

    switch (cmd) {
      case '/exit':
      case '/quit':
        return false;

      case '/help':
        output.write(`${colors.bold}commands${colors.reset}\n`);
        for (const [name, desc] of registerDemoCommands(HELP, activeGuide)) {
          output.write(`  ${colors.cyan}${name.padEnd(28)}${colors.reset}${colors.dim}${desc}${colors.reset}\n`);
        }
        break;

      case '/demo':
        handleDemoCommand(arg, { demoGuide: activeGuide, output, colors });
        break;

      case '/host': {
        const mode = session.modelMode === 'free-router' ? 'free-router' : 'pinned';
        output.write(`${colors.dim}engine:${colors.reset} ${host} (owned loop)${version ? ` (${version})` : ''}  ${colors.dim}model:${colors.reset} ${session.model || '(default)'}  ${colors.dim}mode:${colors.reset} ${mode}\n`);
        output.write(`${colors.dim}construct runs the loop itself; switch models with /model${colors.reset}\n`);
        break;
      }

      case '/models':
      case '/model':
        if (arg) {
          commitPickerModel(session, { mode: 'pinned', modelId: arg }, { cwd, hostId, layers: session.layers });
          output.write(`${colors.green}model set:${colors.reset} ${arg} ${colors.dim}(pinned, saved)${colors.reset}\n`);
          break;
        }
        await promptModelPickerTerminal({
          output,
          colors,
          session,
          rl,
          askFn: ctx.ask,
          env: runtimeEnv,
          cwd,
          hostId,
          layers: session.layers,
        });
        break;

      case '/free': {
        const { resolveFreeOpenRouterModel } = await import('../../apps/chat/engine/models.mjs');
        const freeId = await resolveFreeOpenRouterModel({ env: runtimeEnv, tier: 'standard' });
        if (!freeId) {
          output.write(`${colors.red}OpenRouter free router needs OPENROUTER_API_KEY${colors.reset}\n`);
          break;
        }
        commitPickerModel(session, { mode: 'free-router', modelId: freeId }, { cwd, hostId, layers: session.layers });
        output.write(`${colors.green}model mode:${colors.reset} free-router → ${freeId} ${colors.dim}(saved)${colors.reset}\n`);
        break;
      }

      case '/export': {
        const scope = arg === 'session' ? 'session' : 'last';
        const blocks = turnBlocksRef?.() || [];
        const result = exportTurns(blocks, { scope, cwd });
        if (!result.ok) output.write(`${colors.red}${result.error}${colors.reset}\n`);
        else output.write(`${colors.green}exported${colors.reset} ${result.count} turn(s) to ${result.path}\n`);
        break;
      }

      case '/set':
        applySetting(output, colors, session, layers, rest);
        break;

      case '/settings':
        showSettings(output, colors, session, layers);
        break;

      case '/layers':
        output.write(`${colors.dim}layers:${colors.reset} ${LAYER_KEYS.map((k) => `${k}=${layers[k] ? 'on' : 'off'}`).join('  ')}\n`);
        output.write(`${colors.dim}toggle with: /set <layer> on|off${colors.reset}\n`);
        break;

      case '/usage':
        output.write(formatUsagePanel(session.usage, colors) + '\n');
        break;

      case '/oracle': {
        const { readOracleDockState, formatOracleDockDetail } = await import('../intake/session-prelude.mjs');
        const state = readOracleDockState({ cwd, env: runtimeEnv });
        output.write(`${colors.bold}oracle${colors.reset}\n`);
        output.write(`${formatOracleDockDetail(state)}\n`);
        break;
      }

      case '/inspect': {
        session.inspectorForced = session.inspectorForced === true ? false : session.inspectorForced === false ? null : true;
        const label = session.inspectorForced === true ? 'on' : session.inspectorForced === false ? 'off' : 'auto';
        output.write(`${colors.green}inspector:${colors.reset} ${label}\n`);
        break;
      }

      case '/clear':
        if (typeof onClear === 'function') onClear();
        else output.write('\u001b[2J\u001b[H');
        break;

      default:
        output.write(`${colors.dim}unknown command: ${cmd} \u2014 try /help${colors.reset}\n`);
    }
    return true;
  }

  function applySetting(output, colors, session, layers, parts) {
    if (parts.length < 2) {
      output.write(`${colors.dim}usage: /set <key> <value>  (keys: ${[...LAYER_KEYS, 'thinking', 'permission', 'sandbox', 'model', 'ascii', 'inspector'].join(', ')})${colors.reset}\n`);
      output.write(`${colors.dim}or run /set alone in the Ink UI for a searchable picker${colors.reset}\n`);
      return;
    }
    const [key, ...valueParts] = parts;
    const value = valueParts.join(' ');
    if (key === 'host') {
      output.write(`${colors.dim}host can only be changed by relaunching: construct chat --host ${value}${colors.reset}\n`);
      return;
    }
    const result = applySessionSetting(session, layers, key, value, { cwd, hostId });
    if (!result.ok) { output.write(`${colors.red}${result.error}${colors.reset}\n`); return; }
    output.write(`${colors.green}set:${colors.reset} ${result.key} = ${result.value} ${colors.dim}(saved)${colors.reset}\n`);
  }

  function showSettings(output, colors, session, layers) {
    output.write(`${colors.bold}settings${colors.reset}\n`);
    output.write(`  ${colors.cyan}host${colors.reset}        ${host}\n`);
    output.write(`  ${colors.cyan}model${colors.reset}       ${session.model || '(host default)'} ${colors.dim}(${session.modelMode || 'pinned'})${colors.reset}\n`);
    output.write(`  ${colors.cyan}thinking${colors.reset}    ${layers.thinking ? 'on' : 'off'}\n`);
    output.write(`  ${colors.cyan}layers${colors.reset}      ${LAYER_KEYS.map((k) => `${k}=${layers[k] ? 'on' : 'off'}`).join('  ')}\n`);
    const perm = session.permissionMode || 'allow_once';
    output.write(`  ${colors.cyan}permission${colors.reset}  ${perm} ${colors.dim}(${PERMISSION_MODES.join('/')})${colors.reset}\n`);
    output.write(`  ${colors.cyan}ascii${colors.reset}       ${session.ui?.ascii ? 'on' : 'off'} ${colors.dim}(glyph fallback for limited terminals)${colors.reset}\n`);
    output.write(`  ${colors.cyan}inspector${colors.reset}   ${session.ui?.inspector || 'auto'} ${colors.dim}(off/auto/on — per-turn detail panel)${colors.reset}\n`);
    output.write(`  ${colors.cyan}sandbox${colors.reset}     ${session.sandbox || '(host default)'} ${colors.dim}(${SANDBOX_LEVELS.join('/')})${colors.reset}\n`);
    output.write(`  ${colors.dim}chat sandbox gates tools in this session; isolated project copies use \`construct sandbox create\`${colors.reset}\n`);
  }

  function persist(session, layers = session.layers) {
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
    } catch { /* settings persistence is best-effort */ }
  }

  return { handle };
}

export function createCollectWriter() {
  const parts = [];
  return {
    stream: { write(chunk) { parts.push(String(chunk)); } },
    text() { return parts.join(''); },
  };
}

export const PLAIN_COLORS = Object.freeze({ bold: '', dim: '', reset: '', cyan: '', green: '', red: '', yellow: '' });
