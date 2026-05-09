/**
 * lib/toolkit-env.mjs — Load `.env` from CX_TOOLKIT_DIR into process.env.
 *
 * Shared by OpenCode plugin and MCP server so Langfuse/OpenRouter creds
 * reach every host that drives Construct.
 */
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

export function loadToolkitEnv(toolkitDir, env = process.env) {
  if (!toolkitDir) return;
  const envPath = join(toolkitDir, ".env");
  if (!existsSync(envPath)) return;
  try {
    const text = readFileSync(envPath, "utf8");
    for (const raw of text.split(/\r?\n/)) {
      const line = raw.trim();
      if (!line || line.startsWith("#")) continue;
      const eq = line.indexOf("=");
      if (eq <= 0) continue;
      const key = line.slice(0, eq).trim();
      if (!key || env[key] !== undefined) continue;
      let val = line.slice(eq + 1).trim();
      if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
        val = val.slice(1, -1);
      }
      env[key] = val;
    }
  } catch { /* best effort */ }
}
