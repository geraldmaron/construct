/**
 * lib/mcp-platform-config.mjs — Resolve MCP server config paths for Claude and OpenCode.
 *
 * Provides platform-aware path resolution for ~/.claude/claude_desktop_config.json
 * and the OpenCode settings file, abstracting OS and install-location differences.
 * Backs mcp-manager and setup when they read and write MCP server registrations.
 */
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { memoryPort } from "./home-namespace.mjs";

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

// A value is unsafe to write into a host MCP env block when it is an unresolved
// `__NAME__` template or a 1Password `op://` reference. The op:// form must never
// be written verbatim: a host that cannot run `op read` would pass the literal
// reference to the child process, and writing it persists secret topology into a
// host-readable MCP config file on disk (claude_desktop_config.json, OpenCode
// settings) — a different sink from Construct's own audit JSONL, where recording
// the ref (not the value) is the accepted design (secret-audit-wiring.mjs,
// remediation plan Epic 6, construct-trxz.6).

function isUnwritableEnvValue(value) {
  return typeof value !== "string" || value.includes("__") || value.startsWith("op://");
}

function resolveArgs(args, resolvedValues) {
  return (args ?? []).map((arg) =>
    typeof arg === "string" ? resolveTemplateString(arg, resolvedValues) : arg,
  );
}

// Remote MCP header values carry secrets (e.g. `Authorization: Bearer __GITHUB_TOKEN__`).
// Emit a host-resolved env reference rather than the literal token value, so a live
// credential never lands in a config file on disk. Each host expands a different
// reference syntax; the secret stays in one place (config.env / the shell env) and the
// host resolves it at launch.

const SECRET_REF = {
  claude: (name) => `\${${name}}`,
  vscode: (name) => `\${env:${name}}`,
  opencode: (name) => `{env:${name}}`,
};

// A stdio MCP env value that is a whole-value secret template (`__NAME__` as the
// entire string) is a credential carrier: emit the host's env-reference form so the
// live value never lands on disk, exactly as the remote `headers` path does. Claude
// Code (`${VAR}`), VS Code (`${env:VAR}`), and OpenCode (`{env:VAR}`) each expand
// their reference syntax inside a stdio env block, and the child still inherits the
// resolved env from the parent (config.env -> loadConstructEnv -> process.env) as a
// backstop. A composed value (a URL with an embedded port template, a plain literal)
// is not a secret and is materialized so the child receives the concrete string;
// op:// references and unresolved embedded templates are stripped, never persisted.

const WHOLE_SECRET_TEMPLATE = /^__([A-Z0-9_]+)__$/;

// VS Code's own MCP configuration reference (code.visualstudio.com/docs/agents/
// reference/mcp-configuration, confirmed 2026-07 for construct-trxz.12) documents only
// `${workspaceFolder}`-style predefined variables and `${input:id}` prompts for
// mcp.json — no `${env:VAR}` substitution is listed as supported. Writing `${env:NAME}`
// into a VS Code stdio `env` block would hand the child process that literal,
// unexpanded string instead of the credential, so VS Code's local/stdio env keeps the
// Codex-style materialize-or-strip treatment (flipWholeSecret: false) rather than the
// reference flip Claude and OpenCode confirm via their own documented `${VAR}` /
// `{env:VAR}` expansion.

function buildLocalEnvironment(mcpDef, resolvedValues, secretRef, { flipWholeSecret = true } = {}) {
  const source = mcpDef.env ?? {};
  const out = {};
  for (const [key, raw] of Object.entries(source)) {
    const whole = flipWholeSecret && typeof raw === "string" ? raw.match(WHOLE_SECRET_TEMPLATE) : null;
    if (whole) {
      out[key] = secretRef(whole[1]);
      continue;
    }
    const materialized = typeof raw === "string" ? resolveTemplateString(raw, resolvedValues) : raw;
    if (!isUnwritableEnvValue(materialized)) out[key] = materialized;
  }
  return out;
}

function buildRemoteHeaders(mcpDef, secretRef) {
  return resolveTemplateObject(mcpDef.headers ?? {}, {}, secretRef);
}

// The memory bridge URL is templated from MEMORY_PORT; when a caller does not supply
// one (an entry built outside a populated config.env), fall back to the derived per-home
// port from home-namespace, never the dead legacy 8765 literal that produced the
// split-brain against the actually-allocated port.

function withMemoryDefaults(id, values) {
  if (id !== "memory") return values;
  if (values.MEMORY_PORT) return values;
  return { ...values, MEMORY_PORT: String(memoryPort()) };
}

// auth defaults to "oauth": remote MCP servers (e.g. GitHub's hosted server) are
// configured by URL only, and the host runs the browser OAuth flow and stores the
// token in its own secure store — nothing secret touches the config file. "pat"
// is the opt-in fallback for non-OAuth contexts (headless/CI), emitting an env
// reference for the credential, never the literal value.

export function buildClaudeMcpEntry(id, mcpDef, resolvedValues = {}, { host = "claude", auth = "oauth" } = {}) {
  const values = withMemoryDefaults(id, { CX_TOOLKIT_DIR: ROOT_DIR, ...resolvedValues });
  const secretRef = SECRET_REF[host] ?? SECRET_REF.claude;

  if (mcpDef.type === "url") {
    const headers = auth === "pat" ? buildRemoteHeaders(mcpDef, secretRef) : {};
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

  const env = buildLocalEnvironment(mcpDef, values, secretRef, { flipWholeSecret: host !== "vscode" });
  return {
    command: mcpDef.command,
    args: resolveArgs(mcpDef.args, values),
    ...(Object.keys(env).length > 0 ? { env } : {}),
  };
}

export function buildOpenCodeMcpEntry(id, mcpDef, resolvedValues = {}, { auth = "oauth" } = {}) {
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
    const headers = auth === "pat" ? buildRemoteHeaders(mcpDef, SECRET_REF.opencode) : {};
    return {
      id: openCodeId,
      entry: {
        type: "remote",
        url,
        ...(Object.keys(headers).length > 0 ? { headers } : {}),
      },
    };
  }

  const environment = buildLocalEnvironment(mcpDef, runtimeValues, SECRET_REF.opencode);
  return {
    id: openCodeId,
    entry: {
      type: "local",
      command: [mcpDef.command, ...resolveArgs(mcpDef.args, runtimeValues)],
      ...(Object.keys(environment).length > 0 ? { environment } : {}),
    },
  };
}
