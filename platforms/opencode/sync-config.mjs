#!/usr/bin/env node
/**
 * sync-config.mjs — Fetch free models from OpenRouter and local models from Ollama,
 * and sync into OpenCode config.
 */
import fs from "node:fs";
import { spawnSync } from "node:child_process";
import { readOpenCodeConfig, writeOpenCodeConfig, findOpenCodeConfigPath } from "../../lib/opencode-config.mjs";
import { ensureLocalContextVariants, modelDigest } from "../../lib/ollama/provision-context.mjs";
import { isKnownCollapsed } from "../../lib/ollama/capability-store.mjs";

const LOCAL_NUM_CTX = Number(process.env.CONSTRUCT_LOCAL_NUM_CTX) || 32768;

const configPath = findOpenCodeConfigPath();

async function fetchLocalOllamaModels() {
  try {
    const r = spawnSync("ollama", ["list"], { encoding: "utf8" });
    if (r.status !== 0) return [];
    
    const lines = r.stdout.trim().split("\n").slice(1);
    const models = lines.map(line => {
      const parts = line.split(/\s+/).filter(Boolean);
      const id = parts[0];
      const size = parts[2];
      return { id, name: id, size };
    });

    // Identify redundant tags (same family, many tags)
    const familyMap = new Map();
    for (const m of models) {
      const family = m.id.split(":")[0];
      if (!familyMap.has(family)) familyMap.set(family, []);
      familyMap.get(family).push(m);
    }

    for (const [family, tags] of familyMap) {
      if (tags.length > 2) {
        console.log(`[cleanup] Potential redundant tags for ${family}: ${tags.map(t => t.id).join(", ")}`);
      }
    }

    return models;
  } catch {
    return [];
  }
}

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
  const localModels = await fetchLocalOllamaModels();

  if (freeModels.length === 0 && localModels.length === 0) {
    console.log("No models fetched. Config unchanged.");
    return;
  }

  if (!config.provider) config.provider = {};
  
  // Sync OpenRouter Free Models
  if (freeModels.length > 0) {
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
    const existingOR = config.provider.openrouter.models ?? {};
    for (const model of freeModels) {
      const cleanName = model.name.replace(/\s*\(free\)/gi, "").trim();
      existingOR[model.id] = { name: `[free] ${cleanName}` };
    }
    config.provider.openrouter.models = Object.fromEntries(
      Object.entries(existingOR).sort((a, b) => (a[1].name ?? a[0]).localeCompare(b[1].name ?? b[0]))
    );
  }

  // Sync Local Ollama Models
  if (localModels.length > 0) {
    if (!config.provider.ollama) {
      config.provider.ollama = {
        npm: "@ai-sdk/openai-compatible",
        name: "Ollama",
        options: {
          baseURL: "http://localhost:11434/v1"
        },
        models: {}
      };
    }
    // A raw model runs at Ollama's 4096 default over the /v1 path, which a Construct
    // session's tool schemas overrun. Provision a context-extended Modelfile variant
    // for each tool-capable model lacking a baked num_ctx (any size — capability does
    // not track size) and register the variant in place of the raw tag so the model
    // OpenCode actually talks to has a real context window.

    const { mapping: variantMap, actions } = ensureLocalContextVariants({ numCtx: LOCAL_NUM_CTX });
    for (const a of actions) {
      if (a.action === "created" || a.action === "would-create") console.log(`[ollama] context variant ${a.action}: ${a.variant} (num_ctx ${LOCAL_NUM_CTX})`);
    }

    const existingLocal = config.provider.ollama.models ?? {};
    for (const model of localModels) {
      const registerId = variantMap[model.id] || model.id;
      // Register the context-extended variant in place of the raw tag so the model
      // picker surfaces the windowed option, not the one Ollama serves at 4096.

      if (registerId !== model.id) delete existingLocal[model.id];
      existingLocal[registerId] = {
        name: registerId.replace(/\s*\(local\)/gi, "").trim(),
        family: registerId.includes("qwen") ? "qwen2" : "llama",
        tool_call: true
      };

      // Capability honesty: a model the probe recorded as COLLAPSED (digest still
      // matching) word-salads on the agentic loop. Warn rather than hide — the
      // user keeps the choice and can re-probe — so a stale or false verdict never
      // silently strands a working model.
      if (isKnownCollapsed(model.id, modelDigest(model.id))) {
        console.log(`[ollama] WARNING: ${model.id} probed COLLAPSED — not agentic-capable. Re-probe: construct doctor --probe-local`);
      }
    }
    config.provider.ollama.models = Object.fromEntries(
      Object.entries(existingLocal).sort((a, b) => (a[1].name ?? a[0]).localeCompare(b[1].name ?? b[0]))
    );

    // Agentic coherence is model-specific and not predictable from size: some small
    // coder models collapse into repetition on an agentic system prompt while others
    // run the same Construct payload cleanly. Surface the empirical probe rather than
    // silently registering a model that will produce word salad.

    console.log("[ollama] Verify a model handles agentic prompts before relying on it:");
    console.log("[ollama]   node lib/ollama/provision-context.mjs --probe --model=<id>");
  }

  writeOpenCodeConfig(config, configPath);
  console.log(`Synced ${freeModels.length} free models and ${localModels.length} local models.`);
}

main();
