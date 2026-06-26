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
import { LAYER_GUIDANCE } from './transparency.mjs';
import { exportTurns } from './export.mjs';
import { formatUsagePanel } from './tui/usage.mjs';
import { applySessionSetting } from './session-settings.mjs';
import { commitPickerModel, promptModelPickerTerminal } from './model-picker.mjs';
import { handleDemoCommand, registerDemoCommands } from './demo-guide.mjs';

export const HELP = [
  ['/loop [subject]', 'draft and validate an artifact (or validate a prior draft)'],
  ['/help', 'show this help'],
  ['/model [id]', 'show or set the model (no id opens a searchable picker)'],
  ['/follow', 'follow CX_MODEL_* tier defaults (clears pin)'],
  ['/free', 'set OpenRouter free-router mode (--free equivalent)'],
  ['/export [last|session]', 'write plain markdown answer to .cx/chat-sessions/exports/'],
  ['@file or drop a path', 'attach a file — paste a path or use @docs/foo.md'],
  ['/set <key> <on|off|value>', 'change a setting — run /set alone for keys and guidance'],
  ['/settings', 'show current settings and allowed values'],
  ['/layers', 'show transparency layers and how to toggle them'],
  ['/usage', 'show session token and cost breakdown'],
  ['/oracle', 'show Oracle overseer verdict and pending approvals'],
  ['/team [id]', 'list squads or show squad charter and collaborators'],
  ['/skills suggest <query>', 'rank skills from the central catalog'],
  ['/context', 'show transparency layers and active org context'],
  ['/resume', 'alias for /export session'],
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

      case '/loop': {
        const blocks = turnBlocksRef?.() || [];
        const loopText = arg ? `/loop ${arg}` : '/loop';
        const { runArtifactLoopChatTurn, writeArtifactLoopReport, resolveArtifactLoopRequest } = await import('./artifact-loop.mjs');
        const request = resolveArtifactLoopRequest(loopText, { turnBlocks: blocks, explicit: true });
        if (!request) {
          output.write(`${colors.yellow}No draft to validate.${colors.reset} Try \`/loop <subject>\` (e.g. \`/loop OIDC platform PRD\`) or describe what to write in chat.\n`);
          break;
        }
        const chatTurn = await runArtifactLoopChatTurn({
          text: loopText,
          turnBlocks: blocks,
          cwd,
          explicit: true,
          driver,
          layers,
          output,
          colors,
          env: runtimeEnv,
          session,
          renderRoutePhase: null,
          renderTurnWithFallback: (await import('./tui/render.mjs')).renderTurnWithFallback,
        });
        if (chatTurn?.error) {
          output.write(`${colors.red}[artifact-loop]${colors.reset} ${chatTurn.error}\n`);
          break;
        }
        if (chatTurn?.loopResult) {
          writeArtifactLoopReport(output, colors, chatTurn.loopResult, { cwd, env: runtimeEnv });
        }
        break;
      }

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
        const mode = session.modelMode || 'follow-tier';
        output.write(`${colors.dim}engine:${colors.reset} ${host} (owned loop)${version ? ` (${version})` : ''}  ${colors.dim}model:${colors.reset} ${session.model || '(default)'}  ${colors.dim}mode:${colors.reset} ${mode}\n`);
        output.write(`${colors.dim}construct runs the loop itself; switch models with /model or /follow${colors.reset}\n`);
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

      case '/follow':
      case '/tier': {
        const { resolveValidatedChatModel } = await import('../model-router.mjs');
        const tier = resolveValidatedChatModel({ env: runtimeEnv, requested: null });
        if (!tier?.id) {
          output.write(`${colors.red}no tier default resolved — configure CX_MODEL_STANDARD${colors.reset}\n`);
          break;
        }
        commitPickerModel(session, { mode: 'follow-tier', modelId: tier.id }, { cwd, hostId, layers: session.layers });
        output.write(`${colors.green}model mode:${colors.reset} follow-tier → ${tier.id} ${colors.dim}(saved)${colors.reset}\n`);
        break;
      }

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

      case '/resume': {
        const blocks = turnBlocksRef?.() || [];
        const result = exportTurns(blocks, { scope: 'session', cwd });
        if (!result.ok) output.write(`${colors.red}${result.error}${colors.reset}\n`);
        else output.write(`${colors.green}session exported${colors.reset} to ${result.path}\n`);
        break;
      }

      case '/team': {
        const { loadRegistry } = await import('../registry/loader.mjs');
        const reg = loadRegistry({ rootDir: cwd });
        if (arg) {
          const team = reg.teams[arg];
          if (!team) {
            output.write(`${colors.red}unknown team:${colors.reset} ${arg}\n`);
            break;
          }
          output.write(`${colors.bold}${team.name || arg}${colors.reset} ${colors.dim}(${team.kind || 'squad'})${colors.reset}\n`);
          if (team.groupId) output.write(`  ${colors.cyan}group${colors.reset}  ${team.groupId}\n`);
          if (team.owner) output.write(`  ${colors.cyan}owner${colors.reset}  ${team.owner}\n`);
          if (team.charter) output.write(`  ${colors.dim}${team.charter}${colors.reset}\n`);
          if (team.collaborators?.length) {
            output.write(`  ${colors.cyan}collaborators${colors.reset}  ${team.collaborators.join(', ')}\n`);
          }
          break;
        }
        const squads = Object.entries(reg.teams).filter(([, t]) => t.kind === 'squad');
        output.write(`${colors.bold}squads${colors.reset}\n`);
        for (const [id, team] of squads) {
          output.write(`  ${colors.cyan}${id.padEnd(28)}${colors.reset}${team.name || ''}\n`);
        }
        break;
      }

      case '/skills': {
        const sub = rest[0];
        const query = sub === 'suggest' ? rest.slice(1).join(' ') : rest.join(' ');
        if (!query) {
          output.write(`${colors.dim}usage: /skills suggest <intent>${colors.reset}\n`);
          break;
        }
        const { suggestSkills } = await import('../skills/router.mjs');
        const { suggestions } = suggestSkills({ intent: query, rootDir: cwd, limit: 8 });
        output.write(`${colors.bold}suggested skills${colors.reset} ${colors.dim}(${query})${colors.reset}\n`);
        for (const s of suggestions) {
          const flag = s.entitled === false ? `${colors.yellow}○${colors.reset}` : `${colors.green}●${colors.reset}`;
          output.write(`  ${flag} ${s.path} ${colors.dim}(${s.score})${colors.reset}\n`);
        }
        break;
      }

      case '/context': {
        output.write(`${colors.bold}context${colors.reset}\n`);
        output.write(`  ${colors.cyan}layers${colors.reset}     ${LAYER_KEYS.map((k) => `${k}=${layers[k] ? 'on' : 'off'}`).join('  ')}\n`);
        output.write(`  ${colors.cyan}model${colors.reset}      ${session.model || '(default)'}\n`);
        output.write(`  ${colors.cyan}host${colors.reset}       ${host}\n`);
        try {
          const { loadRegistry } = await import('../registry/loader.mjs');
          const reg = loadRegistry({ rootDir: cwd });
          const squadCount = Object.values(reg.teams).filter((t) => t.kind === 'squad').length;
          output.write(`  ${colors.cyan}org${colors.reset}        ${Object.keys(reg.teams).length} teams (${squadCount} squads) — \`construct team list\`\n`);
        } catch {
          output.write(`  ${colors.cyan}org${colors.reset}        (registry unavailable)\n`);
        }
        break;
      }

      case '/set':
        applySetting(output, colors, session, layers, rest);
        break;

      case '/settings':
        showSettings(output, colors, session, layers);
        break;

      case '/layers':
        output.write(`${colors.bold}transparency layers${colors.reset}\n`);
        for (const key of LAYER_KEYS) {
          const state = layers[key] ? `${colors.green}on${colors.reset}` : `${colors.dim}off${colors.reset}`;
          const guide = LAYER_GUIDANCE[key] || '';
          output.write(`  ${colors.cyan}${key.padEnd(14)}${colors.reset}${state}  ${colors.dim}${guide}${colors.reset}\n`);
        }
        output.write(`\n${colors.dim}toggle:${colors.reset} /set <layer> on|off   ${colors.dim}example:${colors.reset} /set thinking on\n`);
        output.write(`${colors.dim}see also:${colors.reset} /settings · /help\n`);
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
    if (parts.length < 1) {
      output.write(`${colors.bold}settings keys${colors.reset}\n`);
      for (const key of LAYER_KEYS) {
        output.write(`  ${colors.cyan}${key.padEnd(14)}${colors.reset}${colors.dim}${LAYER_GUIDANCE[key] || ''}${colors.reset}\n`);
      }
      output.write(`  ${colors.cyan}${'thinking'.padEnd(14)}${colors.reset}${colors.dim}alias for the thinking layer${colors.reset}\n`);
      output.write(`  ${colors.cyan}${'permission'.padEnd(14)}${colors.reset}${colors.dim}ask · allow_once · allow_always · reject${colors.reset}\n`);
      output.write(`  ${colors.cyan}${'sandbox'.padEnd(14)}${colors.reset}${colors.dim}${SANDBOX_LEVELS.join(' · ')}${colors.reset}\n`);
      output.write(`  ${colors.cyan}${'model'.padEnd(14)}${colors.reset}${colors.dim}pin a model id (or use /model picker)${colors.reset}\n`);
      output.write(`  ${colors.cyan}${'ascii'.padEnd(14)}${colors.reset}${colors.dim}glyph-safe banner (on/off)${colors.reset}\n`);
      output.write(`  ${colors.cyan}${'inspector'.padEnd(14)}${colors.reset}${colors.dim}off · auto · on${colors.reset}\n`);
      output.write(`  ${colors.cyan}${'banner'.padEnd(14)}${colors.reset}${colors.dim}startup banner and exit summary (on/off)${colors.reset}\n`);
      output.write(`\n${colors.dim}usage:${colors.reset} /set <key> <value>   ${colors.dim}example:${colors.reset} /set tools off\n`);
      return;
    }
    if (parts.length < 2) {
      output.write(`${colors.dim}usage: /set <key> <value>  — run /set alone to list keys${colors.reset}\n`);
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
    output.write(`  ${colors.cyan}model${colors.reset}       ${session.model || '(host default)'} ${colors.dim}(${session.modelMode || 'follow-tier'})${colors.reset}\n`);
    output.write(`  ${colors.cyan}thinking${colors.reset}    ${layers.thinking ? 'on' : 'off'} ${colors.dim}(off by default — shows a short summary when on)${colors.reset}\n`);
    output.write(`  ${colors.cyan}layers${colors.reset}      ${LAYER_KEYS.map((k) => `${k}=${layers[k] ? 'on' : 'off'}`).join('  ')}\n`);
    const perm = session.permissionMode || 'allow_once';
    output.write(`  ${colors.cyan}permission${colors.reset}  ${perm} ${colors.dim}(${PERMISSION_MODES.join('/')})${colors.reset}\n`);
    output.write(`  ${colors.cyan}ascii${colors.reset}       ${session.ui?.ascii ? 'on' : 'off'} ${colors.dim}(glyph fallback for limited terminals)${colors.reset}\n`);
    output.write(`  ${colors.cyan}banner${colors.reset}     ${session.ui?.banner !== false ? 'on' : 'off'} ${colors.dim}(startup banner and exit summary)${colors.reset}\n`);
    output.write(`  ${colors.cyan}inspector${colors.reset}   ${session.ui?.inspector || 'auto'} ${colors.dim}(off/auto/on — per-turn detail panel)${colors.reset}\n`);
    output.write(`  ${colors.cyan}sandbox${colors.reset}     ${session.sandbox || '(host default)'} ${colors.dim}(${SANDBOX_LEVELS.join('/')})${colors.reset}\n`);
    output.write(`  ${colors.dim}chat sandbox gates tools in this session; isolated project copies use \`construct sandbox create\`${colors.reset}\n`);
  }

  function persist(session, layers = session.layers) {
    try {
      saveChatConfig({
        host: hostId,
        model: session.modelMode === 'pinned' ? session.model : null,
        modelMode: session.modelMode || 'follow-tier',
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
