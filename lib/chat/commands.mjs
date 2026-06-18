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

import { saveChatConfig, validateSetting, LAYER_KEYS, PERMISSION_MODES, SANDBOX_LEVELS } from './config.mjs';
import { formatUsagePanel } from './tui/usage.mjs';

export const HELP = [
  ['/help', 'show this help'],
  ['/model [id]', 'show or set the model (no id opens a picker)'],
  ['/models', 'list available models for this host'],
  ['/set <key> <on|off|value>', 'change a setting (thinking, tools, path, specialists, observability, permission, sandbox, model)'],
  ['/settings', 'show current settings'],
  ['/layers', 'show transparency layers'],
  ['/usage', 'show session token and cost breakdown'],
  ['/host', 'show the active host'],
  ['/clear', 'clear the screen'],
  ['/exit', 'quit'],
];

function ask(rl, question) {
  return new Promise((resolve) => rl.question(question, (answer) => resolve(answer)));
}

// Suitable (text/agent) models first so the obvious choices are at the top of the
// list; image/non-text models are kept visible but sink to the bottom and tagged.

function sortBySuitability(models) {
  return [...models].sort((a, b) => Number(b.suitable !== false) - Number(a.suitable !== false) || Number(Boolean(b.isProviderDefault)) - Number(Boolean(a.isProviderDefault)));
}

function modelTags(m, colors) {
  const tags = [];
  if (m.isProviderDefault) tags.push('provider default');
  if (m.imageOutput) tags.push('image \u2014 not for chat');
  else if (m.suitable === false) tags.push('non-text');
  else if (m.toolCall === false) tags.push('no tools');
  return tags.length ? `${colors.dim} (${tags.join(', ')})${colors.reset}` : '';
}

export function createCommands({ driver, host, hostId = host, version, cwd = process.cwd() }) {
  async function handle(input, ctx) {
    const { output, colors, layers, session, rl, onClear } = ctx;
    const [cmd, ...rest] = input.trim().split(/\s+/);
    const arg = rest.join(' ').trim();

    switch (cmd) {
      case '/exit':
      case '/quit':
        return false;

      case '/help':
        output.write(`${colors.bold}commands${colors.reset}\n`);
        for (const [name, desc] of HELP) output.write(`  ${colors.cyan}${name.padEnd(28)}${colors.reset}${colors.dim}${desc}${colors.reset}\n`);
        break;

      case '/host':
        output.write(`${colors.dim}engine:${colors.reset} ${host} (owned loop)${version ? ` (${version})` : ''}  ${colors.dim}model:${colors.reset} ${session.model || '(default)'}\n`);
        output.write(`${colors.dim}construct runs the loop itself; switch models with /model${colors.reset}\n`);
        break;

      case '/models':
        await showModels(output, colors, session);
        break;

      case '/model':
        await setModel(output, colors, session, rl, arg, ctx.ask);
        break;

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

      case '/clear':
        if (typeof onClear === 'function') onClear();
        else output.write('\u001b[2J\u001b[H');
        break;

      default:
        output.write(`${colors.dim}unknown command: ${cmd} \u2014 try /help${colors.reset}\n`);
    }
    return true;
  }

  async function listModelsSafe() {
    if (typeof driver.listModels !== 'function') return null;
    try { return await driver.listModels(); } catch { return null; }
  }

  async function showModels(output, colors, session) {
    const models = await listModelsSafe();
    if (!models) { output.write(`${colors.dim}this host does not expose a model list${colors.reset}\n`); return; }
    if (!models.length) { output.write(`${colors.dim}no models reported by the host${colors.reset}\n`); return; }
    output.write(`${colors.bold}available models${colors.reset} ${colors.dim}(${models.length})${colors.reset}\n`);
    for (const m of sortBySuitability(models)) {
      const marker = session.model === m.id ? `${colors.green}\u25cf${colors.reset}` : ' ';
      output.write(`  ${marker} ${m.id}${modelTags(m, colors)}\n`);
    }
  }

  async function setModel(output, colors, session, rl, arg, askFn = null) {
    if (arg) { commitModel(output, colors, session, arg); return; }
    const models = await listModelsSafe();
    if (!models || !models.length) { output.write(`${colors.dim}no models to pick from; set one with /model <id>${colors.reset}\n`); return; }
    output.write(`${colors.bold}select a model${colors.reset}\n`);
    const ordered = sortBySuitability(models);
    ordered.forEach((m, i) => {
      const marker = session.model === m.id ? `${colors.green}\u25cf${colors.reset}` : ' ';
      output.write(`  ${marker} ${String(i + 1).padStart(2)}. ${m.id}${modelTags(m, colors)}\n`);
    });
    const prompt = `${colors.green}model #${colors.reset} `;
    const answer = rl ? (await ask(rl, prompt)).trim() : askFn ? String(await askFn(prompt)).trim() : '';
    if (!answer) {
      output.write(`${colors.dim}${rl || askFn ? 'cancelled' : 'pick one with /model <id>'}${colors.reset}\n`);
      return;
    }
    const idx = Number(answer) - 1;
    if (!Number.isInteger(idx) || idx < 0 || idx >= ordered.length) { output.write(`${colors.red}invalid selection${colors.reset}\n`); return; }
    commitModel(output, colors, session, ordered[idx].id);
  }

  function commitModel(output, colors, session, id) {
    session.model = id;
    persist(session);
    output.write(`${colors.green}model set:${colors.reset} ${id} ${colors.dim}(saved)${colors.reset}\n`);
  }

  function applySetting(output, colors, session, layers, parts) {
    if (parts.length < 2) {
      output.write(`${colors.dim}usage: /set <key> <value>  (keys: ${[...LAYER_KEYS, 'thinking', 'permission', 'sandbox', 'model', 'ascii'].join(', ')})${colors.reset}\n`);
      return;
    }
    const [key, ...valueParts] = parts;
    const value = valueParts.join(' ');
    const result = validateSetting(key, value);
    if (!result.ok) { output.write(`${colors.red}${result.error}${colors.reset}\n`); return; }

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
    } else if (targetKey === 'permissionMode') {
      session.permissionMode = result.value;
    } else if (targetKey === 'sandbox') {
      session.sandbox = result.value;
    } else if (targetKey === 'ui.ascii') {
      session.ui = { ...(session.ui || { ascii: false }), ascii: result.value };
    } else if (targetKey === 'host') {
      output.write(`${colors.dim}host can only be changed by relaunching: construct chat --host ${result.value}${colors.reset}\n`);
      return;
    }
    persist(session, layers);
    output.write(`${colors.green}set:${colors.reset} ${targetKey} = ${result.value} ${colors.dim}(saved)${colors.reset}\n`);
  }

  function showSettings(output, colors, session, layers) {
    output.write(`${colors.bold}settings${colors.reset}\n`);
    output.write(`  ${colors.cyan}host${colors.reset}        ${host}\n`);
    output.write(`  ${colors.cyan}model${colors.reset}       ${session.model || '(host default)'}\n`);
    output.write(`  ${colors.cyan}thinking${colors.reset}    ${layers.thinking ? 'on' : 'off'}\n`);
    output.write(`  ${colors.cyan}layers${colors.reset}      ${LAYER_KEYS.map((k) => `${k}=${layers[k] ? 'on' : 'off'}`).join('  ')}\n`);
    const perm = session.permissionMode || 'allow_once';
    output.write(`  ${colors.cyan}permission${colors.reset}  ${perm} ${colors.dim}(${PERMISSION_MODES.join('/')})${colors.reset}\n`);
    output.write(`  ${colors.cyan}ascii${colors.reset}       ${session.ui?.ascii ? 'on' : 'off'} ${colors.dim}(glyph fallback for limited terminals)${colors.reset}\n`);
    output.write(`  ${colors.cyan}sandbox${colors.reset}     ${session.sandbox || '(host default)'} ${colors.dim}(${SANDBOX_LEVELS.join('/')})${colors.reset}\n`);
    output.write(`  ${colors.dim}chat sandbox gates tools in this session; isolated project copies use \`construct sandbox create\`${colors.reset}\n`);
  }

  function persist(session, layers = session.layers) {
    try {
      saveChatConfig({
        host: hostId,
        model: session.model,
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
