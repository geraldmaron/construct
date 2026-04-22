/**
 * lib/opencode-config.mjs — <one-line purpose>
 *
 * <2–6 line summary: what it does, who calls it, key side effects.>
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

export function writeOpenCodeConfig(config, file = findOpenCodeConfigPath()) {
  const canonical = getCanonicalOpenCodeConfigPath();
  fs.mkdirSync(path.dirname(canonical), { recursive: true });
  fs.writeFileSync(canonical, `${JSON.stringify(config, null, 2)}\n`, "utf8");
  return canonical;
}
