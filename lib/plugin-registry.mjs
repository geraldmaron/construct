/**
 * lib/plugin-registry.mjs — load and validate Construct plugin manifests.
 *
 * Built-in integrations and external manifests share one registry so new
 * integrations can plug into Construct without editing core source files.
 */
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, extname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
export const MANIFEST_VERSION = 1;

function readJson(filePath) {
  return JSON.parse(readFileSync(filePath, "utf8"));
}

function isPlainObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function normalizeMcp(mcp, plugin) {
  return {
    ...mcp,
    pluginId: plugin.id,
    pluginName: plugin.name,
    aliases: Array.isArray(mcp.aliases) ? mcp.aliases : [],
    args: Array.isArray(mcp.args) ? mcp.args : [],
    env: isPlainObject(mcp.env) ? mcp.env : {},
    headers: isPlainObject(mcp.headers) ? mcp.headers : {},
    requiredEnv: Array.isArray(mcp.requiredEnv) ? mcp.requiredEnv : [],
    setupModes: Array.isArray(mcp.setupModes) ? mcp.setupModes : ["manual"],
    usedBy: Array.isArray(mcp.usedBy) ? mcp.usedBy : [],
    hostSupport: isPlainObject(mcp.hostSupport) ? mcp.hostSupport : {},
  };
}

function validateMcp(mcp, { pluginId, manifestPath }) {
  const errors = [];
  const label = `${pluginId}:${mcp?.id ?? "(missing-id)"}`;
  if (!isPlainObject(mcp)) {
    return [`${manifestPath}: MCP entry must be an object (${label})`];
  }
  if (!mcp.id || typeof mcp.id !== "string") errors.push(`${manifestPath}: MCP entry missing string id (${label})`);
  if (!mcp.name || typeof mcp.name !== "string") errors.push(`${manifestPath}: MCP entry missing string name (${label})`);
  if (!mcp.category || typeof mcp.category !== "string") errors.push(`${manifestPath}: MCP entry missing string category (${label})`);
  if (!mcp.description || typeof mcp.description !== "string") errors.push(`${manifestPath}: MCP entry missing string description (${label})`);
  if (!Array.isArray(mcp.requiredEnv)) errors.push(`${manifestPath}: MCP ${label} missing requiredEnv array`);
  if (!Array.isArray(mcp.usedBy)) errors.push(`${manifestPath}: MCP ${label} missing usedBy array`);
  if (!isPlainObject(mcp.env)) errors.push(`${manifestPath}: MCP ${label} missing env object`);
  if (mcp.headers !== undefined && !isPlainObject(mcp.headers)) errors.push(`${manifestPath}: MCP ${label} headers must be an object when present`);
  if (mcp.type === "url" && typeof mcp.url !== "string") errors.push(`${manifestPath}: MCP ${label} with type=url must declare url`);
  if (mcp.type !== "url" && typeof mcp.command !== "string") errors.push(`${manifestPath}: MCP ${label} must declare command unless type=url`);
  return errors;
}

export function validatePluginManifest(manifest, { manifestPath = "<memory>" } = {}) {
  const errors = [];
  if (!isPlainObject(manifest)) {
    return { valid: false, errors: [`${manifestPath}: manifest must be a JSON object`] };
  }
  if (manifest.version !== MANIFEST_VERSION) {
    errors.push(`${manifestPath}: unsupported manifest version ${JSON.stringify(manifest.version)} (expected ${MANIFEST_VERSION})`);
  }
  if (!Array.isArray(manifest.plugins) || manifest.plugins.length === 0) {
    errors.push(`${manifestPath}: manifest must contain a non-empty plugins array`);
  }

  const pluginIds = new Set();
  for (const plugin of manifest.plugins ?? []) {
    const pluginLabel = plugin?.id ?? "(missing-id)";
    if (!isPlainObject(plugin)) {
      errors.push(`${manifestPath}: plugin entry must be an object (${pluginLabel})`);
      continue;
    }
    if (!plugin.id || typeof plugin.id !== "string") errors.push(`${manifestPath}: plugin missing string id`);
    if (!plugin.name || typeof plugin.name !== "string") errors.push(`${manifestPath}: plugin ${pluginLabel} missing string name`);
    if (!plugin.version || typeof plugin.version !== "string") errors.push(`${manifestPath}: plugin ${pluginLabel} missing string version`);
    if (!plugin.description || typeof plugin.description !== "string") errors.push(`${manifestPath}: plugin ${pluginLabel} missing string description`);
    if (plugin.capabilities !== undefined && !Array.isArray(plugin.capabilities)) {
      errors.push(`${manifestPath}: plugin ${pluginLabel} capabilities must be an array when present`);
    }
    if (!Array.isArray(plugin.mcps)) errors.push(`${manifestPath}: plugin ${pluginLabel} missing mcps array`);
    if (plugin.id) {
      if (pluginIds.has(plugin.id)) errors.push(`${manifestPath}: duplicate plugin id ${plugin.id}`);
      pluginIds.add(plugin.id);
    }
    for (const mcp of plugin.mcps ?? []) {
      errors.push(...validateMcp(mcp, { pluginId: pluginLabel, manifestPath }));
    }
  }

  return { valid: errors.length === 0, errors };
}

function loadBuiltinPlugin(rootDir) {
  const rootCatalogPath = join(rootDir, "lib", "mcp-catalog.json");
  const catalogPath = existsSync(rootCatalogPath) ? rootCatalogPath : join(__dirname, "mcp-catalog.json");
  const catalog = readJson(catalogPath);
  const plugin = {
    id: "construct-builtins",
    name: "Construct Built-ins",
    version: "1.0.0",
    description: "Built-in Construct integrations bundled with the CLI.",
    capabilities: ["mcp"],
    manifestPath: catalogPath,
    builtIn: true,
  };
  plugin.mcps = (catalog.mcps ?? []).map((mcp) => ({
    ...normalizeMcp(mcp, plugin),
    manifestPath: catalogPath,
  }));
  return plugin;
}

export function resolvePluginDirs({ cwd = process.cwd(), homeDir = homedir(), env = process.env } = {}) {
  const extra = String(env.CONSTRUCT_PLUGIN_DIRS || "")
    .split(env.PATH?.includes(";") ? ";" : ":")
    .map((entry) => entry.trim())
    .filter(Boolean);

  return [...new Set([
    join(cwd, ".cx", "plugins"),
    join(cwd, ".construct", "plugins"),
    join(homeDir, ".construct", "plugins"),
    ...extra,
  ].map((dir) => resolve(dir)))];
}

function findManifestFiles(pluginDirs) {
  const files = [];
  for (const dir of pluginDirs) {
    if (!existsSync(dir)) continue;
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (!entry.isFile()) continue;
      if (extname(entry.name).toLowerCase() !== ".json") continue;
      files.push(join(dir, entry.name));
    }
  }
  return files.sort();
}

export function loadPluginRegistry({ cwd = process.cwd(), homeDir = homedir(), rootDir = resolve(__dirname, ".."), env = process.env } = {}) {
  const errors = [];
  const plugins = [loadBuiltinPlugin(rootDir)];
  const pluginDirs = resolvePluginDirs({ cwd, homeDir, env });

  for (const manifestPath of findManifestFiles(pluginDirs)) {
    try {
      const manifest = readJson(manifestPath);
      const validation = validatePluginManifest(manifest, { manifestPath });
      if (!validation.valid) {
        errors.push(...validation.errors);
        continue;
      }
      for (const rawPlugin of manifest.plugins) {
        const plugin = {
          ...rawPlugin,
          capabilities: Array.isArray(rawPlugin.capabilities) ? rawPlugin.capabilities : ["mcp"],
          manifestPath,
          builtIn: false,
        };
        plugin.mcps = (rawPlugin.mcps ?? []).map((mcp) => ({
          ...normalizeMcp(mcp, plugin),
          manifestPath,
        }));
        plugins.push(plugin);
      }
    } catch (error) {
      errors.push(`${manifestPath}: failed to load manifest (${error.message})`);
    }
  }

  const pluginIds = new Set();
  const mcpIds = new Set();
  const dedupedPlugins = [];
  const mcps = [];

  for (const plugin of plugins) {
    if (pluginIds.has(plugin.id)) {
      errors.push(`${plugin.manifestPath}: duplicate plugin id ${plugin.id}`);
      continue;
    }
    pluginIds.add(plugin.id);
    dedupedPlugins.push(plugin);
    for (const mcp of plugin.mcps ?? []) {
      if (mcpIds.has(mcp.id)) {
        errors.push(`${mcp.manifestPath}: duplicate MCP id ${mcp.id}`);
        continue;
      }
      mcpIds.add(mcp.id);
      mcps.push(mcp);
    }
  }

  return {
    valid: errors.length === 0,
    errors,
    pluginDirs,
    plugins: dedupedPlugins,
    mcps,
  };
}

export function getPluginById(id, options = {}) {
  const registry = loadPluginRegistry(options);
  return registry.plugins.find((plugin) => plugin.id === id) ?? null;
}

export function getMcpById(id, options = {}) {
  const registry = loadPluginRegistry(options);
  return registry.mcps.find((mcp) => mcp.id === id) ?? null;
}

export function initPluginManifest(id, {
  cwd = process.cwd(),
  force = false,
  version = "0.1.0",
  name = null,
  description = "External Construct plugin.",
} = {}) {
  if (!id || typeof id !== "string" || !id.trim()) {
    throw new Error("plugin id is required");
  }
  const safeId = id.trim();
  const dir = join(cwd, ".cx", "plugins");
  const filePath = join(dir, `${safeId}.json`);
  if (existsSync(filePath) && !force) {
    throw new Error(`plugin manifest already exists at ${filePath}`);
  }

  mkdirSync(dir, { recursive: true });
  const manifest = {
    version: MANIFEST_VERSION,
    plugins: [
      {
        id: safeId,
        name: name ?? safeId,
        version,
        description,
        capabilities: ["mcp"],
        mcps: [
          {
            id: `${safeId}-example`,
            name: `${name ?? safeId} Example`,
            category: "integration",
            description: "Example MCP entry. Replace with your real integration.",
            command: "npx",
            args: ["-y", "@example/mcp-server"],
            env: {},
            requiredEnv: [],
            setupModes: ["manual"],
            hostSupport: {
              claude: { mode: "managed" },
              opencode: { mode: "managed" },
              codex: { mode: "managed" },
            },
            usedBy: ["construct"],
            degradedMessage: "Example integration unavailable.",
          },
        ],
      },
    ],
  };
  writeFileSync(filePath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
  return filePath;
}
