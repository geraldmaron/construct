#!/usr/bin/env node
/**
 * sync-config.mjs — Fetch free models from OpenRouter and sync into OpenCode config.
 * Run periodically or during install to keep the free model list current.
 */
import fs from "node:fs";
import { readOpenCodeConfig, writeOpenCodeConfig, findOpenCodeConfigPath } from "../lib/opencode-config.mjs";

const configPath = findOpenCodeConfigPath();

async function fetchFreeModels() {
  try {
    const res = await fetch("https://openrouter.ai/api/v1/models");
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const { data } = await res.json();
    return data
      .filter((m) => m.id.endsWith(":free") && m.context_length >= 4096)
      .map((m) => ({ id: m.id, name: m.name || m.id.replace(/:free$/, "") }))
      .sort((a, b) => a.name.localeCompare(b.name));
  } catch (err) {
    console.warn(`Warning: Could not fetch OpenRouter models: ${err.message}`);
    return [];
  }
}

async function main() {
  if (!fs.existsSync(configPath)) {
    console.log("OpenCode config not found. Run 'construct sync' first.");
    return;
  }

  const { config } = readOpenCodeConfig();
  const freeModels = await fetchFreeModels();

  if (freeModels.length === 0) {
    console.log("No free models fetched. Config unchanged.");
    return;
  }

  if (!config.provider) config.provider = {};
  if (!config.provider.openrouter) {
    config.provider.openrouter = {
      npm: "@ai-sdk/openai-compatible",
      name: "OpenRouter",
      options: {
        baseURL: "https://openrouter.ai/api/v1",
        headers: {}
      },
      models: {}
    };
  }

  const existingModels = config.provider.openrouter.models ?? {};
  const merged = { ...existingModels };
  for (const model of freeModels) {
    if (!merged[model.id]) {
      merged[model.id] = { name: `${model.name} (free)` };
    }
  }

  config.provider.openrouter.models = Object.fromEntries(
    Object.entries(merged).sort((a, b) => (a[1].name ?? a[0]).localeCompare(b[1].name ?? b[0]))
  );

  writeOpenCodeConfig(config, configPath);
  console.log(`Synced ${freeModels.length} free models from OpenRouter.`);
}

main();
