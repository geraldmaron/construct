var __getOwnPropNames = Object.getOwnPropertyNames;
var __esm = (fn, res, err) => function __init() {
  if (err) throw err[0];
  try {
    return fn && (res = (0, fn[__getOwnPropNames(fn)[0]])(fn = 0)), res;
  } catch (e) {
    throw err = [e], e;
  }
};

// lib/project-root.mjs
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { createHash } from "node:crypto";
function findProjectRoot(start = process.cwd()) {
  let dir = path.resolve(start);
  const stop = path.resolve(HOME);
  while (true) {
    if (MARKERS.some((m) => fs.existsSync(path.join(dir, m)))) return dir;
    if (dir === stop) return null;
    const parent = path.dirname(dir);
    if (parent === dir) return null;
    dir = parent;
  }
}
function projectIdFor(projectRoot) {
  if (!projectRoot) return null;
  return createHash("sha256").update(path.resolve(projectRoot)).digest("hex").slice(0, 12);
}
function resolveProjectScope(cwd = process.cwd()) {
  if (cache.has(cwd)) return cache.get(cwd);
  const projectRoot = findProjectRoot(cwd);
  if (!projectRoot) {
    cache.set(cwd, null);
    return null;
  }
  const result = {
    projectRoot,
    projectId: projectIdFor(projectRoot),
    cxDir: path.join(projectRoot, ".cx")
  };
  cache.set(cwd, result);
  return result;
}
function resolveProjectScopedPath(basename, { cwd, ensureDir = true } = {}) {
  const scope = resolveProjectScope(cwd ?? process.cwd());
  const dir = scope ? scope.cxDir : path.join(HOME, ".cx");
  if (ensureDir && !fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  return path.join(dir, basename);
}
var HOME, MARKERS, cache;
var init_project_root = __esm({
  "lib/project-root.mjs"() {
    HOME = os.homedir();
    MARKERS = [".cx", ".construct"];
    cache = /* @__PURE__ */ new Map();
  }
});

// apps/chat/tui/index.jsx
import React, { useState, useRef, useCallback, useEffect, useMemo } from "react";
import { render, Box, Text, useApp, useInput, useStdout } from "ink";

// lib/chat/tui/usage.mjs
function addInto(target, tokens = {}) {
  for (const key of Object.keys(target)) {
    if (Number.isFinite(tokens[key])) target[key] += tokens[key];
  }
}
function addUsage(session, event) {
  if (!session || !event) return;
  session.turns += 1;
  addInto(session.tokens, event.tokens || {});
  if (event.cost && Number.isFinite(event.cost.amount)) {
    session.cost.amount += event.cost.amount;
    if (event.cost.currency) session.cost.currency = event.cost.currency;
  }
  if (event.subAgent && event.tokens) {
    const prev = session.bySubAgent.get(event.subAgent) || { input: 0, output: 0, total: 0 };
    addInto(prev, event.tokens);
    session.bySubAgent.set(event.subAgent, prev);
  }
  session.history.push({ tokens: event.tokens || null, cost: event.cost || null, model: event.model || null });
}
function formatTokens(n) {
  if (!Number.isFinite(n)) return null;
  if (n < 1e3) return String(n);
  if (n < 1e6) return `${(n / 1e3).toFixed(n < 1e4 ? 1 : 0)}k`;
  return `${(n / 1e6).toFixed(1)}M`;
}
function formatCost(cost) {
  if (!cost || !Number.isFinite(cost.amount)) return null;
  if (cost.amount === 0) return "$0";
  const digits = cost.amount < 0.01 ? 4 : cost.amount < 1 ? 3 : 2;
  return `~$${cost.amount.toFixed(digits)}`;
}
function usageParts(event) {
  const t = event.tokens || {};
  const parts = [];
  if (Number.isFinite(t.input)) parts.push(`prompt ${formatTokens(t.input)}`);
  if (Number.isFinite(t.output)) parts.push(`output ${formatTokens(t.output)}`);
  if (Number.isFinite(t.reasoning) && t.reasoning > 0) parts.push(`reasoning ${formatTokens(t.reasoning)}`);
  if (Number.isFinite(t.cacheRead) && t.cacheRead > 0) parts.push(`cache\u2193 ${formatTokens(t.cacheRead)}`);
  if (Number.isFinite(t.cacheWrite) && t.cacheWrite > 0) parts.push(`cache\u2191 ${formatTokens(t.cacheWrite)}`);
  if (Number.isFinite(t.total)) parts.push(`total ${formatTokens(t.total)}`);
  const cost = formatCost(event.cost);
  if (cost) parts.push(cost);
  if (event.context && Number.isFinite(event.context.used) && Number.isFinite(event.context.size)) {
    parts.push(`ctx ${formatTokens(event.context.used)}/${formatTokens(event.context.size)}`);
  }
  if (event.model) parts.push(`model ${event.model}`);
  return parts;
}
function formatUsageFooter(event, colors = {}) {
  const dim = colors.dim || "";
  const reset = colors.reset || "";
  const parts = usageParts(event);
  if (!parts.length) return `${dim}[usage] (host reported no token counts)${reset}`;
  return `${dim}[usage] ${parts.join(" \xB7 ")}${reset}`;
}
function formatUsagePanel(session, colors = {}) {
  const dim = colors.dim || "";
  const bold = colors.bold || "";
  const reset = colors.reset || "";
  const lines = [];
  lines.push(`${bold}session usage${reset} ${dim}(${session.turns} turn${session.turns === 1 ? "" : "s"})${reset}`);
  const t = session.tokens;
  const totalParts = [];
  if (t.input) totalParts.push(`prompt ${formatTokens(t.input)}`);
  if (t.output) totalParts.push(`output ${formatTokens(t.output)}`);
  if (t.reasoning) totalParts.push(`reasoning ${formatTokens(t.reasoning)}`);
  if (t.cacheRead) totalParts.push(`cache\u2193 ${formatTokens(t.cacheRead)}`);
  if (t.cacheWrite) totalParts.push(`cache\u2191 ${formatTokens(t.cacheWrite)}`);
  if (t.total) totalParts.push(`total ${formatTokens(t.total)}`);
  const cost = formatCost(session.cost);
  if (cost) totalParts.push(cost);
  lines.push(totalParts.length ? `  ${totalParts.join(" \xB7 ")}` : `  ${dim}no token counts reported yet${reset}`);
  if (session.bySubAgent.size) {
    lines.push(`${dim}  by sub-agent:${reset}`);
    for (const [name, st] of session.bySubAgent) {
      lines.push(`    ${name}: prompt ${formatTokens(st.input)} \xB7 output ${formatTokens(st.output)} \xB7 total ${formatTokens(st.total)}`);
    }
  }
  return lines.join("\n");
}

// lib/chat/transparency.mjs
var CHANNEL_BY_TYPE = {
  thinking: "thinking",
  text: "message",
  plan: "path",
  tool_call: "tools",
  tool_update: "tools",
  usage: "observability",
  specialist: "specialists",
  permission: "permission",
  error: "error",
  done: "system"
};
function channelFor(event) {
  return CHANNEL_BY_TYPE[event?.type] || "system";
}
function isVisible(event, layers) {
  const channel = channelFor(event);
  if (channel === "message" || channel === "permission" || channel === "error" || channel === "system") return true;
  return Boolean(layers[channel]);
}

// apps/chat/tui/turn-state.mjs
function createTurnState() {
  return {
    assistant: "",
    thinking: "",
    tools: [],
    plan: [],
    route: [],
    permissions: [],
    error: null,
    rendered: false,
    stopReason: null,
    lastUsage: null
  };
}
function applyTurnEvent(state, event, { session = null } = {}) {
  switch (event?.type) {
    case "text":
      state.assistant += event.text || "";
      state.rendered = true;
      break;
    case "thinking":
      state.thinking += event.text || "";
      state.rendered = true;
      break;
    case "plan":
      state.plan = Array.isArray(event.entries) ? event.entries : [];
      state.rendered = true;
      break;
    case "tool_call": {
      state.tools.push({ id: event.id, title: event.title || event.kind || "tool", status: "pending" });
      state.rendered = true;
      break;
    }
    case "tool_update": {
      const existing = state.tools.find((t) => t.id === event.id);
      if (existing) existing.status = event.status || existing.status;
      else state.tools.push({ id: event.id, title: event.id || "tool", status: event.status || "pending" });
      state.rendered = true;
      break;
    }
    case "usage":
      if (session) addUsage(session.usage, event);
      state.lastUsage = event;
      break;
    case "permission": {
      const title = event.toolCall?.title || event.toolCall?.callID || "tool";
      state.permissions.push({ title, detail: event.options?.length ? `${event.options.length} options` : "decision" });
      state.rendered = true;
      break;
    }
    case "error":
      state.error = event.message || "error";
      state.rendered = true;
      break;
    case "done":
      state.stopReason = event.stopReason || "end_turn";
      break;
    default:
      break;
  }
  return state;
}
async function runTurnInto(driver, text, opts, { session = null, layers = null, onUpdate = () => {
} } = {}) {
  const state = createTurnState();
  for await (const event of driver.prompt(text, opts)) {
    if (layers && !isVisible(event, layers)) continue;
    applyTurnEvent(state, event, { session });
    onUpdate(state, event);
  }
  return state;
}

// lib/chat/config.mjs
import fs2 from "node:fs";
init_project_root();
var LAYER_KEYS = ["thinking", "path", "specialists", "tools", "observability"];
var PERMISSION_MODES = ["ask", "allow_once", "allow_always", "reject"];
var SANDBOX_LEVELS = ["read-only", "workspace-write", "danger-full-access"];
var DEFAULTS = Object.freeze({
  host: null,
  model: null,
  layers: Object.freeze(Object.fromEntries(LAYER_KEYS.map((k) => [k, true]))),
  thinking: true,
  permissionMode: "allow_once",
  sandbox: null
});
var CONFIG_BASENAME = "chat-config.json";
function saveChatConfig(config, { cwd = process.cwd() } = {}) {
  const target = resolveProjectScopedPath(CONFIG_BASENAME, { cwd, ensureDir: true });
  const persisted = {};
  for (const key of Object.keys(DEFAULTS)) {
    if (config[key] == null) continue;
    persisted[key] = key === "layers" ? { ...config.layers } : config[key];
  }
  fs2.writeFileSync(target, `${JSON.stringify(persisted, null, 2)}
`);
  return target;
}
function validateSetting(key, rawValue) {
  switch (key) {
    case "host":
      return { ok: true, value: String(rawValue) };
    case "model":
      return { ok: true, value: String(rawValue) };
    case "thinking": {
      const v = parseBool(rawValue);
      return v == null ? { ok: false, error: "thinking must be on/off" } : { ok: true, value: v };
    }
    case "permissionMode":
    case "permission":
      return PERMISSION_MODES.includes(rawValue) ? { ok: true, key: "permissionMode", value: rawValue } : { ok: false, error: `permission must be one of: ${PERMISSION_MODES.join(", ")}` };
    case "sandbox":
      return SANDBOX_LEVELS.includes(rawValue) ? { ok: true, value: rawValue } : { ok: false, error: `sandbox must be one of: ${SANDBOX_LEVELS.join(", ")}` };
    default:
      if (LAYER_KEYS.includes(key)) {
        const v = parseBool(rawValue);
        return v == null ? { ok: false, error: `${key} must be on/off` } : { ok: true, key: `layers.${key}`, value: v };
      }
      return { ok: false, error: `unknown setting: ${key}` };
  }
}
function parseBool(v) {
  if (v === true || v === false) return v;
  const s = String(v).toLowerCase();
  if (["on", "true", "1", "yes", "show"].includes(s)) return true;
  if (["off", "false", "0", "no", "hide"].includes(s)) return false;
  return null;
}

// lib/chat/commands.mjs
var HELP = [
  ["/help", "show this help"],
  ["/model [id]", "show or set the model (no id opens a picker)"],
  ["/models", "list available models for this host"],
  ["/set <key> <on|off|value>", "change a setting (thinking, tools, path, specialists, observability, permission, sandbox, model)"],
  ["/settings", "show current settings"],
  ["/layers", "show transparency layers"],
  ["/usage", "show session token and cost breakdown"],
  ["/host", "show the active host"],
  ["/clear", "clear the screen"],
  ["/exit", "quit"]
];
function ask(rl, question) {
  return new Promise((resolve) => rl.question(question, (answer) => resolve(answer)));
}
function sortBySuitability(models) {
  return [...models].sort((a, b) => Number(b.suitable !== false) - Number(a.suitable !== false) || Number(Boolean(b.isProviderDefault)) - Number(Boolean(a.isProviderDefault)));
}
function modelTags(m, colors) {
  const tags = [];
  if (m.isProviderDefault) tags.push("provider default");
  if (m.imageOutput) tags.push("image \u2014 not for chat");
  else if (m.suitable === false) tags.push("non-text");
  else if (m.toolCall === false) tags.push("no tools");
  return tags.length ? `${colors.dim} (${tags.join(", ")})${colors.reset}` : "";
}
function createCommands({ driver, host, hostId = host, version, cwd = process.cwd() }) {
  async function handle(input, ctx) {
    const { output, colors, layers, session, rl, onClear } = ctx;
    const [cmd, ...rest] = input.trim().split(/\s+/);
    const arg = rest.join(" ").trim();
    switch (cmd) {
      case "/exit":
      case "/quit":
        return false;
      case "/help":
        output.write(`${colors.bold}commands${colors.reset}
`);
        for (const [name, desc] of HELP) output.write(`  ${colors.cyan}${name.padEnd(28)}${colors.reset}${colors.dim}${desc}${colors.reset}
`);
        break;
      case "/host":
        output.write(`${colors.dim}engine:${colors.reset} ${host} (owned loop)${version ? ` (${version})` : ""}  ${colors.dim}model:${colors.reset} ${session.model || "(default)"}
`);
        output.write(`${colors.dim}construct runs the loop itself; switch models with /model${colors.reset}
`);
        break;
      case "/models":
        await showModels(output, colors, session);
        break;
      case "/model":
        await setModel(output, colors, session, rl, arg, ctx.ask);
        break;
      case "/set":
        applySetting(output, colors, session, layers, rest);
        break;
      case "/settings":
        showSettings(output, colors, session, layers);
        break;
      case "/layers":
        output.write(`${colors.dim}layers:${colors.reset} ${LAYER_KEYS.map((k) => `${k}=${layers[k] ? "on" : "off"}`).join("  ")}
`);
        output.write(`${colors.dim}toggle with: /set <layer> on|off${colors.reset}
`);
        break;
      case "/usage":
        output.write(formatUsagePanel(session.usage, colors) + "\n");
        break;
      case "/clear":
        if (typeof onClear === "function") onClear();
        else output.write("\x1B[2J\x1B[H");
        break;
      default:
        output.write(`${colors.dim}unknown command: ${cmd} \u2014 try /help${colors.reset}
`);
    }
    return true;
  }
  async function listModelsSafe() {
    if (typeof driver.listModels !== "function") return null;
    try {
      return await driver.listModels();
    } catch {
      return null;
    }
  }
  async function showModels(output, colors, session) {
    const models = await listModelsSafe();
    if (!models) {
      output.write(`${colors.dim}this host does not expose a model list${colors.reset}
`);
      return;
    }
    if (!models.length) {
      output.write(`${colors.dim}no models reported by the host${colors.reset}
`);
      return;
    }
    output.write(`${colors.bold}available models${colors.reset} ${colors.dim}(${models.length})${colors.reset}
`);
    for (const m of sortBySuitability(models)) {
      const marker = session.model === m.id ? `${colors.green}\u25CF${colors.reset}` : " ";
      output.write(`  ${marker} ${m.id}${modelTags(m, colors)}
`);
    }
  }
  async function setModel(output, colors, session, rl, arg, askFn = null) {
    if (arg) {
      commitModel(output, colors, session, arg);
      return;
    }
    const models = await listModelsSafe();
    if (!models || !models.length) {
      output.write(`${colors.dim}no models to pick from; set one with /model <id>${colors.reset}
`);
      return;
    }
    output.write(`${colors.bold}select a model${colors.reset}
`);
    const ordered = sortBySuitability(models);
    ordered.forEach((m, i) => {
      const marker = session.model === m.id ? `${colors.green}\u25CF${colors.reset}` : " ";
      output.write(`  ${marker} ${String(i + 1).padStart(2)}. ${m.id}${modelTags(m, colors)}
`);
    });
    const prompt = `${colors.green}model #${colors.reset} `;
    const answer = rl ? (await ask(rl, prompt)).trim() : askFn ? String(await askFn(prompt)).trim() : "";
    if (!answer) {
      output.write(`${colors.dim}${rl || askFn ? "cancelled" : "pick one with /model <id>"}${colors.reset}
`);
      return;
    }
    const idx = Number(answer) - 1;
    if (!Number.isInteger(idx) || idx < 0 || idx >= ordered.length) {
      output.write(`${colors.red}invalid selection${colors.reset}
`);
      return;
    }
    commitModel(output, colors, session, ordered[idx].id);
  }
  function commitModel(output, colors, session, id) {
    session.model = id;
    persist(session);
    output.write(`${colors.green}model set:${colors.reset} ${id} ${colors.dim}(saved)${colors.reset}
`);
  }
  function applySetting(output, colors, session, layers, parts) {
    if (parts.length < 2) {
      output.write(`${colors.dim}usage: /set <key> <value>  (keys: ${[...LAYER_KEYS, "thinking", "permission", "sandbox", "model"].join(", ")})${colors.reset}
`);
      return;
    }
    const [key, ...valueParts] = parts;
    const value = valueParts.join(" ");
    const result = validateSetting(key, value);
    if (!result.ok) {
      output.write(`${colors.red}${result.error}${colors.reset}
`);
      return;
    }
    const targetKey = result.key || key;
    if (targetKey.startsWith("layers.")) {
      const layer = targetKey.slice("layers.".length);
      layers[layer] = result.value;
      session.layers = { ...layers };
    } else if (targetKey === "thinking") {
      layers.thinking = result.value;
      session.layers = { ...layers };
      session.thinking = result.value;
    } else if (targetKey === "model") {
      session.model = result.value;
    } else if (targetKey === "permissionMode") {
      session.permissionMode = result.value;
    } else if (targetKey === "sandbox") {
      session.sandbox = result.value;
    } else if (targetKey === "host") {
      output.write(`${colors.dim}host can only be changed by relaunching: construct chat --host ${result.value}${colors.reset}
`);
      return;
    }
    persist(session, layers);
    output.write(`${colors.green}set:${colors.reset} ${targetKey} = ${result.value} ${colors.dim}(saved)${colors.reset}
`);
  }
  function showSettings(output, colors, session, layers) {
    output.write(`${colors.bold}settings${colors.reset}
`);
    output.write(`  ${colors.cyan}host${colors.reset}        ${host}
`);
    output.write(`  ${colors.cyan}model${colors.reset}       ${session.model || "(host default)"}
`);
    output.write(`  ${colors.cyan}thinking${colors.reset}    ${layers.thinking ? "on" : "off"}
`);
    output.write(`  ${colors.cyan}layers${colors.reset}      ${LAYER_KEYS.map((k) => `${k}=${layers[k] ? "on" : "off"}`).join("  ")}
`);
    const perm = session.permissionMode || "allow_once";
    output.write(`  ${colors.cyan}permission${colors.reset}  ${perm} ${colors.dim}(${PERMISSION_MODES.join("/")})${colors.reset}
`);
    if (perm === "ask") {
      output.write(`  ${colors.dim}note: ask mode is not interactive yet; tool calls use allow_once until a prompt overlay ships${colors.reset}
`);
    }
    output.write(`  ${colors.cyan}sandbox${colors.reset}     ${session.sandbox || "(host default)"} ${colors.dim}(${SANDBOX_LEVELS.join("/")})${colors.reset}
`);
    output.write(`  ${colors.dim}chat sandbox gates tools in this session; isolated project copies use \`construct sandbox create\`${colors.reset}
`);
  }
  function persist(session, layers = session.layers) {
    try {
      saveChatConfig({
        host: hostId,
        model: session.model,
        layers,
        thinking: layers?.thinking,
        permissionMode: session.permissionMode,
        sandbox: session.sandbox
      }, { cwd });
    } catch {
    }
  }
  return { handle };
}
function createCollectWriter() {
  const parts = [];
  return {
    stream: { write(chunk) {
      parts.push(String(chunk));
    } },
    text() {
      return parts.join("");
    }
  };
}
var PLAIN_COLORS = Object.freeze({ bold: "", dim: "", reset: "", cyan: "", green: "", red: "", yellow: "" });

// lib/term-format.mjs
var CODES = { bold: "1", dim: "2", reset: "0", red: "31", green: "32", yellow: "33", cyan: "36" };
var PALETTE_KEYS = Object.keys(CODES);
var EMPTY_PALETTE = Object.freeze(Object.fromEntries(PALETTE_KEYS.map((k) => [k, ""])));
function stripAnsi(text) {
  return String(text).replace(/\[[0-9;]*m/g, "");
}

// apps/chat/tui/theme.mjs
var palette = {
  accent: "cyan",
  accentAlt: "magenta",
  ok: "green",
  warn: "yellow",
  danger: "red",
  muted: "gray",
  text: "white"
};
var glyphs = {
  brand: "\u25C6",
  dot: "\u25CF",
  arrow: "\u2192",
  caret: "\u25B8",
  gutter: "\u2502",
  block: "\u2588",
  track: "\u2591",
  toolDone: "\u2713",
  toolFail: "\u2717",
  toolBusy: "\u25B8",
  toolPending: "\xB7"
};
var spinnerFrames = ["\u280B", "\u2819", "\u2839", "\u2838", "\u283C", "\u2834", "\u2826", "\u2827", "\u2807", "\u280F"];
function toolGlyph(status) {
  if (status === "completed") return glyphs.toolDone;
  if (status === "failed") return glyphs.toolFail;
  if (status === "in_progress") return glyphs.toolBusy;
  return glyphs.toolPending;
}
function toolColor(status) {
  if (status === "completed") return palette.ok;
  if (status === "failed") return palette.danger;
  if (status === "in_progress") return palette.warn;
  return palette.muted;
}
function splitModel(id) {
  if (!id) return { provider: "", name: "(no model)" };
  const idx = id.indexOf("/");
  if (idx === -1) return { provider: "", name: id };
  return { provider: id.slice(0, idx), name: id.slice(idx + 1) };
}
function meter(used, size, width = 18) {
  const ratio = size > 0 ? Math.max(0, Math.min(1, used / size)) : 0;
  const filled = Math.round(ratio * width);
  return { bar: glyphs.block.repeat(filled) + glyphs.track.repeat(Math.max(0, width - filled)), ratio };
}
function ratioColor(ratio) {
  if (ratio >= 0.85) return palette.danger;
  if (ratio >= 0.6) return palette.warn;
  return palette.ok;
}
function percent(ratio) {
  return `${Math.round(ratio * 100)}%`;
}

// apps/chat/tui/index.jsx
import { jsx, jsxs } from "react/jsx-runtime";
function Rule({ width, color = palette.muted }) {
  return /* @__PURE__ */ jsx(Text, { color, children: "\u2500".repeat(Math.max(1, width)) });
}
function Badge({ bg, color = "black", children }) {
  return /* @__PURE__ */ jsx(Text, { backgroundColor: bg, color, bold: true, children: ` ${children} ` });
}
function HeaderBar({ cols, model, sandbox, permissionMode, working, spin }) {
  const { provider, name } = splitModel(model);
  return /* @__PURE__ */ jsxs(Box, { flexDirection: "column", children: [
    /* @__PURE__ */ jsxs(Box, { width: cols, justifyContent: "space-between", children: [
      /* @__PURE__ */ jsxs(Box, { children: [
        /* @__PURE__ */ jsx(Text, { color: palette.accent, bold: true, children: `${glyphs.brand} construct` }),
        /* @__PURE__ */ jsx(Text, { color: palette.muted, children: `  ${glyphs.gutter}  chat` })
      ] }),
      /* @__PURE__ */ jsxs(Box, { children: [
        provider ? /* @__PURE__ */ jsx(Text, { color: palette.muted, children: `${provider}/` }) : null,
        /* @__PURE__ */ jsx(Text, { color: palette.text, bold: true, children: name }),
        /* @__PURE__ */ jsx(Text, { color: palette.muted, children: `   ${sandbox}  ${glyphs.gutter}  ${permissionMode}  ` }),
        /* @__PURE__ */ jsx(Text, { color: working ? palette.warn : palette.ok, children: working ? spin : glyphs.dot })
      ] })
    ] }),
    /* @__PURE__ */ jsx(Rule, { width: cols })
  ] });
}
function EmptyState({ model }) {
  const { provider, name } = splitModel(model);
  return /* @__PURE__ */ jsxs(Box, { flexDirection: "column", paddingY: 1, children: [
    /* @__PURE__ */ jsx(Text, { color: palette.accent, bold: true, children: `${glyphs.brand} welcome to construct chat` }),
    /* @__PURE__ */ jsx(Box, { marginTop: 1, children: /* @__PURE__ */ jsx(Text, { color: palette.muted, wrap: "wrap", children: "Transparency-first coding. Every token, tool call, and the specialist route Construct would take stays in view in the panel on the right \u2014 nothing is hidden behind a host." }) }),
    /* @__PURE__ */ jsxs(Box, { marginTop: 1, flexDirection: "column", children: [
      /* @__PURE__ */ jsx(Text, { color: palette.muted, children: "To get going" }),
      /* @__PURE__ */ jsx(Text, { children: `  ${glyphs.caret} ask a question or describe the change you want` }),
      /* @__PURE__ */ jsx(Text, { color: palette.muted, children: `  ${glyphs.caret} /help  /model  /models  /set  /settings  /layers  /usage` })
    ] }),
    name ? /* @__PURE__ */ jsxs(Box, { marginTop: 1, children: [
      /* @__PURE__ */ jsx(Text, { color: palette.muted, children: `ready on ` }),
      /* @__PURE__ */ jsx(Text, { color: palette.text, bold: true, children: provider ? `${provider}/${name}` : name })
    ] }) : /* @__PURE__ */ jsx(Box, { marginTop: 1, children: /* @__PURE__ */ jsx(Text, { color: palette.warn, children: `${glyphs.caret} no model selected \u2014 set one with /model or a provider key` }) })
  ] });
}
function Message({ role, text }) {
  if (role === "thinking") {
    return /* @__PURE__ */ jsxs(Box, { flexDirection: "column", marginBottom: 1, children: [
      /* @__PURE__ */ jsx(Text, { color: palette.muted, children: `${glyphs.gutter} thinking` }),
      /* @__PURE__ */ jsx(Box, { paddingLeft: 2, children: /* @__PURE__ */ jsx(Text, { color: palette.muted, wrap: "wrap", children: text }) })
    ] });
  }
  const isYou = role === "you";
  const isError = typeof text === "string" && text.startsWith("[error]");
  return /* @__PURE__ */ jsxs(Box, { flexDirection: "column", marginBottom: 1, children: [
    /* @__PURE__ */ jsx(Badge, { bg: isYou ? palette.ok : palette.accent, children: isYou ? "you" : "construct" }),
    /* @__PURE__ */ jsx(Box, { paddingLeft: 1, children: /* @__PURE__ */ jsx(Text, { color: isError ? palette.danger : void 0, wrap: "wrap", children: text }) })
  ] });
}
function planGlyph(status) {
  if (status === "completed") return glyphs.toolDone;
  if (status === "in_progress") return glyphs.toolBusy;
  return glyphs.toolPending;
}
function ConversationPane({ width, transcript, live, thinking, showThinking, model, working, spin }) {
  if (transcript.length === 0 && !live && !thinking) {
    return /* @__PURE__ */ jsx(Box, { flexDirection: "column", width, paddingRight: 2, children: /* @__PURE__ */ jsx(EmptyState, { model }) });
  }
  const lines = transcript.map((entry) => ({ role: entry.role, text: entry.text }));
  if (showThinking && thinking) lines.push({ role: "thinking", text: thinking });
  if (live) lines.push({ role: "construct", text: `${live}${working ? glyphs.block : ""}` });
  return /* @__PURE__ */ jsxs(Box, { flexDirection: "column", width, paddingRight: 2, children: [
    lines.map((l, i) => /* @__PURE__ */ jsx(Message, { role: l.role, text: l.text }, i)),
    working && !live ? /* @__PURE__ */ jsx(Text, { color: palette.warn, children: `${spin} working\u2026` }) : null
  ] });
}
function PanelSection({ title, children, marginTop = 1 }) {
  return /* @__PURE__ */ jsxs(Box, { flexDirection: "column", marginTop, children: [
    /* @__PURE__ */ jsx(Text, { color: palette.accent, children: title }),
    children
  ] });
}
function TransparencyPanel({
  width,
  session,
  route,
  routeMeta,
  tools,
  plan,
  permissions,
  lastTurnUsage,
  layers,
  working,
  model,
  sandbox,
  permissionMode,
  ctx,
  spin
}) {
  const u = session.usage;
  const t = u.tokens || {};
  const { provider, name } = splitModel(model);
  const ledger = [];
  if (t.input) ledger.push(["prompt", formatTokens(t.input)]);
  if (t.output) ledger.push(["output", formatTokens(t.output)]);
  if (t.reasoning) ledger.push(["reasoning", formatTokens(t.reasoning)]);
  if (t.cacheRead) ledger.push(["cache in", formatTokens(t.cacheRead)]);
  if (t.cacheWrite) ledger.push(["cache out", formatTokens(t.cacheWrite)]);
  if (t.total) ledger.push(["total", formatTokens(t.total)]);
  if (u.cost?.amount > 0) ledger.push(["cost", `~$${u.cost.amount.toFixed(u.cost.amount < 1 ? 3 : 2)}`]);
  const ctxMeter = ctx?.size ? meter(ctx.used, ctx.size, Math.max(10, width - 8)) : null;
  const recentTools = tools.slice(-7);
  const turnUsage = lastTurnUsage && layers?.observability ? stripAnsi(formatUsageFooter(lastTurnUsage, {})).replace(/^\[usage\] /, "") : null;
  return /* @__PURE__ */ jsxs(Box, { flexDirection: "column", width, borderStyle: "round", borderColor: palette.accent, paddingX: 1, children: [
    /* @__PURE__ */ jsx(Text, { color: palette.accent, bold: true, children: `${glyphs.brand} transparency` }),
    /* @__PURE__ */ jsxs(PanelSection, { title: "model", marginTop: 1, children: [
      /* @__PURE__ */ jsxs(Text, { children: [
        provider ? /* @__PURE__ */ jsx(Text, { color: palette.muted, children: `${provider}/` }) : null,
        /* @__PURE__ */ jsx(Text, { bold: true, children: name })
      ] }),
      sandbox || permissionMode ? /* @__PURE__ */ jsx(Text, { color: palette.muted, children: [sandbox, permissionMode].filter(Boolean).join(` ${glyphs.gutter} `) }) : null
    ] }),
    /* @__PURE__ */ jsx(PanelSection, { title: "layers", children: /* @__PURE__ */ jsx(Text, { color: palette.muted, wrap: "wrap", children: LAYER_KEYS.map((k) => `${k}=${layers?.[k] ? "on" : "off"}`).join(`  ${glyphs.gutter}  `) }) }),
    /* @__PURE__ */ jsx(PanelSection, { title: "context", children: ctxMeter ? /* @__PURE__ */ jsxs(Box, { flexDirection: "column", children: [
      /* @__PURE__ */ jsx(Text, { color: ratioColor(ctxMeter.ratio), children: ctxMeter.bar }),
      /* @__PURE__ */ jsx(Text, { color: palette.muted, children: `${formatTokens(ctx.used)}/${formatTokens(ctx.size)}  ${percent(ctxMeter.ratio)}` })
    ] }) : /* @__PURE__ */ jsx(Text, { color: palette.muted, children: "not reported yet" }) }),
    turnUsage ? /* @__PURE__ */ jsx(PanelSection, { title: "this turn", children: /* @__PURE__ */ jsx(Text, { color: palette.muted, wrap: "wrap", children: turnUsage }) }) : null,
    /* @__PURE__ */ jsx(PanelSection, { title: `usage ${glyphs.gutter} ${u.turns} turn${u.turns === 1 ? "" : "s"}`, children: ledger.length ? ledger.map(([k, v]) => /* @__PURE__ */ jsxs(Box, { justifyContent: "space-between", children: [
      /* @__PURE__ */ jsx(Text, { color: palette.muted, children: k }),
      /* @__PURE__ */ jsx(Text, { children: v })
    ] }, k)) : /* @__PURE__ */ jsx(Text, { color: palette.muted, children: "no tokens yet" }) }),
    routeMeta?.intent || routeMeta?.workCategory ? /* @__PURE__ */ jsx(PanelSection, { title: "intent", children: /* @__PURE__ */ jsx(Text, { color: palette.muted, wrap: "wrap", children: [routeMeta.intent, routeMeta.workCategory].filter(Boolean).join(` ${glyphs.gutter} `) }) }) : null,
    route.length > 0 ? /* @__PURE__ */ jsx(PanelSection, { title: "route", children: /* @__PURE__ */ jsx(Text, { color: palette.accentAlt, wrap: "wrap", children: route.join(` ${glyphs.arrow} `) }) }) : null,
    layers?.path && plan.length > 0 ? /* @__PURE__ */ jsx(PanelSection, { title: "plan", children: plan.map((entry, i) => /* @__PURE__ */ jsx(Text, { color: palette.muted, wrap: "wrap", children: `${planGlyph(entry.status)} ${entry.content}` }, `${entry.content}-${i}`)) }) : null,
    permissions.length > 0 ? /* @__PURE__ */ jsx(PanelSection, { title: "permissions", children: permissions.slice(-5).map((entry, i) => /* @__PURE__ */ jsx(Text, { color: palette.warn, wrap: "wrap", children: `${glyphs.gutter} ${entry.title} ${glyphs.gutter} ${entry.detail}` }, `${entry.title}-${i}`)) }) : null,
    layers?.tools !== false ? /* @__PURE__ */ jsx(PanelSection, { title: `tools ${glyphs.gutter} ${tools.length}`, children: recentTools.length ? recentTools.map((tool, i) => /* @__PURE__ */ jsx(Text, { color: toolColor(tool.status), children: `${toolGlyph(tool.status)} ${tool.title}` }, `${tool.id}-${i}`)) : /* @__PURE__ */ jsx(Text, { color: palette.muted, children: "none this turn" }) }) : null,
    /* @__PURE__ */ jsx(Box, { marginTop: 1, children: /* @__PURE__ */ jsx(Text, { color: working ? palette.warn : palette.ok, children: working ? `${spin} working\u2026` : `${glyphs.dot} idle` }) })
  ] });
}
function Footer({ cols, input, working, notice }) {
  return /* @__PURE__ */ jsxs(Box, { flexDirection: "column", children: [
    /* @__PURE__ */ jsx(Rule, { width: cols }),
    notice ? /* @__PURE__ */ jsx(Text, { color: palette.warn, children: notice }) : null,
    /* @__PURE__ */ jsxs(Box, { children: [
      /* @__PURE__ */ jsx(Text, { color: palette.accent, bold: true, children: `you ${glyphs.caret} ` }),
      /* @__PURE__ */ jsx(Text, { children: input }),
      /* @__PURE__ */ jsx(Text, { color: palette.muted, children: working ? "" : glyphs.block })
    ] }),
    /* @__PURE__ */ jsx(Text, { color: palette.muted, children: `enter send   ${glyphs.gutter}   /help  /models  /settings  /clear   ${glyphs.gutter}   Ctrl-C ${working ? "cancel" : "exit"}` })
  ] });
}
function App({ driver, session, layers, planTurn, persist, cwd }) {
  const { exit } = useApp();
  const { stdout } = useStdout();
  const cols = stdout?.columns || 100;
  const panelWidth = Math.min(42, Math.max(30, Math.floor(cols * 0.34)));
  const convWidth = Math.max(20, cols - panelWidth - 2);
  const commands = useMemo(
    () => createCommands({ driver, host: "construct", hostId: "construct", cwd }),
    [driver, cwd]
  );
  const [transcript, setTranscript] = useState([]);
  const [live, setLive] = useState("");
  const [thinking, setThinking] = useState("");
  const [tools, setTools] = useState([]);
  const [plan, setPlan] = useState([]);
  const [permissions, setPermissions] = useState([]);
  const [route, setRoute] = useState([]);
  const [routeMeta, setRouteMeta] = useState(null);
  const [lastTurnUsage, setLastTurnUsage] = useState(null);
  const [working, setWorking] = useState(false);
  const [input, setInput] = useState("");
  const [notice, setNotice] = useState(session.modelNotice || "");
  const [ctx, setCtx] = useState(null);
  const [frame, setFrame] = useState(0);
  const [, forceTick] = useState(0);
  const busy = useRef(false);
  useEffect(() => {
    if (!working) return void 0;
    const timer = setInterval(() => setFrame((f) => (f + 1) % spinnerFrames.length), 90);
    return () => clearInterval(timer);
  }, [working]);
  const spin = spinnerFrames[frame];
  const append = useCallback((role, text) => setTranscript((prev) => [...prev, { role, text }]), []);
  const handleCommand = useCallback(async (text) => {
    const out = createCollectWriter();
    const keep = await commands.handle(text, {
      output: out.stream,
      colors: PLAIN_COLORS,
      layers,
      session,
      rl: null,
      onClear: () => {
        setTranscript([]);
        setNotice("");
        setRoute([]);
        setRouteMeta(null);
        setTools([]);
        setPlan([]);
        setPermissions([]);
      }
    });
    const msg = stripAnsi(out.text()).trim();
    if (msg) append("construct", msg);
    if (!keep) exit();
  }, [append, commands, exit, layers, session]);
  const submit = useCallback(async (text) => {
    if (!text.trim() || busy.current) return;
    if (text.startsWith("/")) {
      await handleCommand(text);
      return;
    }
    busy.current = true;
    setWorking(true);
    setNotice("");
    append("you", text);
    setLive("");
    setThinking("");
    setTools([]);
    setPlan([]);
    setPermissions([]);
    setLastTurnUsage(null);
    if (layers.specialists || layers.path) {
      try {
        const overlay = await planTurn?.(text);
        if (overlay?.specialists?.length) setRoute(overlay.specialists);
        if (overlay) setRouteMeta({ intent: overlay.intent, workCategory: overlay.workCategory });
      } catch {
      }
    }
    try {
      const state = await runTurnInto(
        driver,
        text,
        { model: session.model, permissionMode: session.permissionMode, sandbox: session.sandbox },
        {
          session,
          layers,
          onUpdate: (s, event) => {
            if (persist) {
              try {
                persist(event);
              } catch {
              }
            }
            if (event.type === "text") setLive(s.assistant);
            else if (event.type === "thinking") setThinking(s.thinking);
            else if (event.type === "tool_call" || event.type === "tool_update") setTools([...s.tools]);
            else if (event.type === "plan") setPlan([...s.plan]);
            else if (event.type === "permission") setPermissions([...s.permissions]);
            else if (event.type === "usage") {
              if (event.context) setCtx(event.context);
              setLastTurnUsage(s.lastUsage);
              forceTick((n) => n + 1);
            }
          }
        }
      );
      if (state.assistant) append("construct", state.assistant);
      else if (state.error) append("construct", `[error] ${state.error}`);
      else append("construct", "[no output] check that a model is selected and the provider is authenticated");
    } catch (err) {
      append("construct", `[error] ${err.message}`);
    } finally {
      setLive("");
      setThinking("");
      setWorking(false);
      busy.current = false;
    }
  }, [append, driver, handleCommand, layers, persist, planTurn, session]);
  useInput((char, key) => {
    if (key.ctrl && char === "c") {
      if (busy.current) {
        try {
          driver.cancel?.();
        } catch {
        }
      } else exit();
      return;
    }
    if (key.return) {
      const text = input;
      setInput("");
      submit(text);
      return;
    }
    if (key.backspace || key.delete) {
      setInput((v) => v.slice(0, -1));
      return;
    }
    if (char && !key.ctrl && !key.meta) setInput((v) => v + char);
  });
  return /* @__PURE__ */ jsxs(Box, { flexDirection: "column", children: [
    /* @__PURE__ */ jsx(HeaderBar, { cols, model: session.model, sandbox: session.sandbox, permissionMode: session.permissionMode, working, spin }),
    /* @__PURE__ */ jsxs(Box, { children: [
      /* @__PURE__ */ jsx(
        ConversationPane,
        {
          width: convWidth,
          transcript,
          live,
          thinking,
          showThinking: layers.thinking,
          model: session.model,
          working,
          spin
        }
      ),
      /* @__PURE__ */ jsx(
        TransparencyPanel,
        {
          width: panelWidth,
          session,
          route,
          routeMeta,
          tools,
          plan,
          permissions,
          lastTurnUsage,
          layers,
          working,
          model: session.model,
          sandbox: session.sandbox,
          permissionMode: session.permissionMode,
          ctx,
          spin
        }
      )
    ] }),
    /* @__PURE__ */ jsx(Footer, { cols, input, working, notice })
  ] });
}
function runInkChat({ driver, session, layers, planTurn = null, persist = null, cwd = process.cwd() } = {}) {
  const instance = render(
    /* @__PURE__ */ jsx(App, { driver, session, layers, planTurn, persist, cwd })
  );
  return instance.waitUntilExit();
}
var index_default = runInkChat;
export {
  App,
  ConversationPane,
  EmptyState,
  HeaderBar,
  TransparencyPanel,
  index_default as default,
  runInkChat
};
