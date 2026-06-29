/**
 * lib/mcp-platform-config.mjs — Resolve MCP server config paths for Claude and OpenCode.
 *
 * Provides platform-aware path resolution for ~/.claude/claude_desktop_config.json
 * and the OpenCode settings file, abstracting OS and install-location differences.
 * Backs mcp-manager and setup when they read and write MCP server registrations.
 */
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT_DIR = resolve(dirname(fileURLToPath(import.meta.url)), "..");

export function getOpenCodeMcpId(id) {
  return id;
}

function resolveTemplateString(value, resolvedValues, fallback = (name) => `__${name}__`) {
  return value.replace(/__([A-Z0-9_]+)__/g, (_, name) => resolvedValues[name] ?? fallback(name));
}

function resolveTemplateObject(input, resolvedValues, fallback) {
  if (!input || typeof input !== "object" || Array.isArray(input)) return {};
  return Object.fromEntries(
    Object.entries(input).map(([key, value]) => [
      key,
      typeof value === "string" ? resolveTemplateString(value, resolvedValues, fallback) : value,
    ]),
  );
}

function stripUnresolvedValues(input) {
  return Object.fromEntries(
    Object.entries(input).filter(([, value]) => typeof value === "string" && !value.includes("__")),
  );
}

function resolveArgs(args, resolvedValues) {
  return (args ?? []).map((arg) =>
    typeof arg === "string" ? resolveTemplateString(arg, resolvedValues) : arg,
  );
}

function buildLocalEnvironment(mcpDef, resolvedValues) {
  return stripUnresolvedValues(resolveTemplateObject(mcpDef.env ?? {}, resolvedValues));
}

function buildRemoteHeaders(mcpDef, resolvedValues) {
  return stripUnresolvedValues(
    resolveTemplateObject(mcpDef.headers ?? {}, resolvedValues, (name) => `{env:${name}}`),
  );
}

function withMemoryDefaults(id, values) {
  if (id !== "memory") return values;
  if (values.MEMORY_PORT) return values;
  return { ...values, MEMORY_PORT: "8765" };
}

export function buildClaudeMcpEntry(id, mcpDef, resolvedValues = {}) {
  const values = withMemoryDefaults(id, { CX_TOOLKIT_DIR: ROOT_DIR, ...resolvedValues });

  if (mcpDef.type === "url") {
    const headers = buildRemoteHeaders(mcpDef, values);
    const url =
      id === "memory" && values.MEMORY_PORT
        ? `http://127.0.0.1:${values.MEMORY_PORT}/`
        : resolveTemplateString(mcpDef.url, values);
    return {
      type: "http",
      url,
      ...(Object.keys(headers).length > 0 ? { headers } : {}),
    };
  }

  const env = buildLocalEnvironment(mcpDef, values);
  return {
    command: mcpDef.command,
    args: resolveArgs(mcpDef.args, values),
    ...(Object.keys(env).length > 0 ? { env } : {}),
  };
}

export function buildOpenCodeMcpEntry(id, mcpDef, resolvedValues = {}) {
  const runtimeValues = withMemoryDefaults(id, {
    CX_TOOLKIT_DIR: ROOT_DIR,
    ...resolvedValues,
  });
  const openCodeId = getOpenCodeMcpId(id);

  if (mcpDef.type === "url") {
    const url =
      id === "memory" && runtimeValues.MEMORY_PORT
        ? `http://127.0.0.1:${runtimeValues.MEMORY_PORT}/`
        : resolveTemplateString(mcpDef.url, runtimeValues);
    return {
      id: openCodeId,
      entry: {
        type: "remote",
        url,
        ...(Object.keys(buildRemoteHeaders(mcpDef, runtimeValues)).length > 0 ? { headers: buildRemoteHeaders(mcpDef, runtimeValues) } : {}),
      },
    };
  }

  const environment = buildLocalEnvironment(mcpDef, runtimeValues);
  return {
    id: openCodeId,
    entry: {
      type: "local",
      command: [mcpDef.command, ...resolveArgs(mcpDef.args, runtimeValues)],
      ...(Object.keys(environment).length > 0 ? { environment } : {}),
    },
  };
}
