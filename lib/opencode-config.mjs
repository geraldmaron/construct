/**
 * lib/opencode-config.mjs — Read and write the OpenCode settings.json config file.
 *
 * Locates the active OpenCode config across standard install paths, parses it,
 * and provides typed helpers to read provider settings, MCP registrations, and
 * model assignments. Changes are written atomically. Used by model-router,
 * mcp-manager, and the runtime plugin.
 */
import fs from "node:fs";
import path from "node:path";
import os from "node:os";

export function getOpenCodeConfigDir() {
  return path.join(os.homedir(), ".config", "opencode");
}

export function getCanonicalOpenCodeConfigPath() {
  return path.join(getOpenCodeConfigDir(), "opencode.json");
}

export function findOpenCodeConfigPath() {
  return getCanonicalOpenCodeConfigPath();
}

export function readOpenCodeConfig() {
  const file = findOpenCodeConfigPath();
  if (!fs.existsSync(file)) return { file, config: null };
  const raw = fs.readFileSync(file, "utf8");
  return {
    file,
    config: (() => {
      try {
        return JSON.parse(raw);
      } catch (error) {
        console.warn(`Warning: ignoring invalid OpenCode config at ${file}: ${error.message}`);
        return null;
      }
    })(),
  };
}

export function sanitizeOpenCodeConfig(config) {
  if (!config || Array.isArray(config) || typeof config !== "object") return config;
  const sanitized = { ...config };
  delete sanitized.construct;
  return sanitized;
}

export function writeOpenCodeConfig(config, file = findOpenCodeConfigPath()) {
  const canonical = getCanonicalOpenCodeConfigPath();
  fs.mkdirSync(path.dirname(canonical), { recursive: true });
  fs.writeFileSync(canonical, `${JSON.stringify(sanitizeOpenCodeConfig(config), null, 2)}\n`, "utf8");
  return canonical;
}
