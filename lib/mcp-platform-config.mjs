/**
 * lib/mcp-platform-config.mjs — <one-line purpose>
 *
 * <2–6 line summary: what it does, who calls it, key side effects.>
 */
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT_DIR = resolve(dirname(fileURLToPath(import.meta.url)), "..");

export function getOpenCodeMcpId(id) {
  return id;
}

function resolveTemplateString(value, resolvedValues) {
  return value.replace(/__([A-Z0-9_]+)__/g, (_, name) => resolvedValues[name] ?? `__${name}__`);
}

function resolveTemplateObject(input, resolvedValues) {
  if (!input || typeof input !== "object" || Array.isArray(input)) return {};
  return Object.fromEntries(
    Object.entries(input).map(([key, value]) => [
      key,
      typeof value === "string" ? resolveTemplateString(value, resolvedValues) : value,
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
  return stripUnresolvedValues(resolveTemplateObject(mcpDef.headers ?? {}, resolvedValues));
}

export function buildClaudeMcpEntry(id, mcpDef, resolvedValues = {}) {
  if (mcpDef.type === "url") {
    const headers = buildRemoteHeaders(mcpDef, resolvedValues);
    const url =
      id === "memory" && resolvedValues.MEMORY_PORT
        ? `http://127.0.0.1:${resolvedValues.MEMORY_PORT}/`
        : resolveTemplateString(mcpDef.url, resolvedValues);
    return {
      type: "http",
      url,
      ...(Object.keys(headers).length > 0 ? { headers } : {}),
    };
  }

  const env = buildLocalEnvironment(mcpDef, resolvedValues);
  return {
    command: mcpDef.command,
    args: resolveArgs(mcpDef.args, resolvedValues),
    ...(Object.keys(env).length > 0 ? { env } : {}),
  };
}

export function buildOpenCodeMcpEntry(id, mcpDef, resolvedValues = {}) {
  const runtimeValues = {
    CX_TOOLKIT_DIR: ROOT_DIR,
    ...resolvedValues,
  };
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
