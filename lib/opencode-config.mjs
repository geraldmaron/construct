/**
 * lib/opencode-config.mjs — Read and write the OpenCode settings.json config file.
 *
 * Locates the active OpenCode config across standard install paths, parses it,
 * and provides typed helpers to read provider settings, MCP registrations, and
 * model assignments. Changes are written atomically. Backs model-router,
 * mcp-manager, and the runtime plugin.
 */
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { detectActiveSessions } from "./host-capabilities.mjs";
import { getUserEnvPath, parseEnvFile } from "./env-config.mjs";

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

// op run resolves only the launch env-file, never values baked into config
// JSON. A literal `op://` reference (or a build-time __PLACEHOLDER__) left in a
// credential field is therefore sent to OpenRouter verbatim, which 401s. Only
// `{env:VAR}` (resolved by OpenCode) and concrete keys count as real auth.

function isUnresolvedSecretRef(value) {
  return typeof value === 'string' && (value.includes('op://') || value.includes('__OPENROUTER_API_KEY__'));
}

function openRouterHasAuth(provider = {}) {
  const apiKey = provider.apiKey;
  if (typeof apiKey === 'string' && apiKey.length > 0 && !isUnresolvedSecretRef(apiKey)) {
    return true;
  }
  const auth = provider.options?.headers?.Authorization;
  return typeof auth === 'string' && auth.length > 0 && !isUnresolvedSecretRef(auth);
}

export function ensureOpenRouterProviderAuth(config) {
  if (!config?.provider?.openrouter) return config;
  const provider = config.provider.openrouter;

  // A broken Authorization header overrides the working apiKey at request time,
  // so strip it before deciding whether the provider still needs an env-ref key.

  const authHeader = provider.options?.headers?.Authorization;
  if (isUnresolvedSecretRef(authHeader)) {
    delete provider.options.headers.Authorization;
  }
  if (openRouterHasAuth(provider)) return config;
  config.provider.openrouter = {
    ...provider,
    apiKey: '{env:OPENROUTER_API_KEY}',
  };
  return config;
}

/**
 * Maps Construct internal tiers (fast, standard, reasoning) to OpenCode model configurations.
 */
export function mapConstructModelsToOpenCode(models = {}) {
  const opencodeModels = [];
  
  const isLocal = (m) => m && (m.includes("localhost") || m.includes("127.0.0.1") || m.startsWith("github-copilot/") || m.includes("ollama"));
  
  const getProvider = (m) => {
    if (m && m.startsWith("github-copilot/")) return "github-copilot";
    if (m && m.includes("ollama")) return "ollama";
    return isLocal(m) ? "ollama" : "openrouter";
  };

  const getLimit = (m, tier) => {
    if (!isLocal(m)) return { context: 32768, output: 8192 };
    
    // Scale local context based on tier/size to prevent VRAM saturation
    const isLarge = m.includes("30b") || m.includes("32b") || m.includes("70b") || tier === "reasoning";
    if (tier === "fast") return { context: 8192, output: 4096 };
    if (isLarge) return { context: 16384, output: 4096 }; // "Sweet spot" for large local models
    return { context: 12288, output: 4096 };
  };

  if (models.fast) {
    opencodeModels.push({
      id: "fast",
      name: models.fast,
      provider: getProvider(models.fast),
      default: false,
      limit: getLimit(models.fast, "fast")
    });
  }
  
  if (models.standard) {
    opencodeModels.push({
      id: "standard",
      name: models.standard,
      provider: getProvider(models.standard),
      default: true,
      limit: getLimit(models.standard, "standard")
    });
  }
  
  if (models.reasoning) {
    opencodeModels.push({
      id: "reasoning",
      name: models.reasoning,
      provider: getProvider(models.reasoning),
      default: false,
      limit: getLimit(models.reasoning, "reasoning")
    });
  }
  
  return opencodeModels;
}

export function writeOpenCodeConfig(config, file = findOpenCodeConfigPath()) {
  // Treat the canonical home config as the default target; any explicit path
  // outside the canonical home dir (e.g. project-scoped .opencode/opencode.json)
  // is honored as-is so per-project sync writes to the right tree.

  const canonical = getCanonicalOpenCodeConfigPath();
  const target = file && path.resolve(file) !== path.resolve(findOpenCodeConfigPath())
    ? file
    : canonical;
    
  // If the config contains a construct model mapping, apply it to the OpenCode format.
  if (config.construct?.models) {
    config.models = mapConstructModelsToOpenCode(config.construct.models);
    
    // Ensure OpenRouter and Ollama providers are registered if needed.
    config.provider = config.provider || {};
    if (config.models.some(m => m.provider === 'openrouter')) {
      config.provider.openrouter = config.provider.openrouter || {
        baseUrl: "https://openrouter.ai/api/v1",
        apiKey: "{env:OPENROUTER_API_KEY}"
      };
    }
    if (config.models.some(m => m.provider === 'ollama')) {
      config.provider.ollama = config.provider.ollama || {
        baseUrl: "http://localhost:11434/v1"
      };
    }

    // Handle bridge providers based on active sessions
    const sessions = detectActiveSessions();
    if (sessions.includes('github-copilot')) {
      const envValues = parseEnvFile(getUserEnvPath());
      const port = envValues.COPILOT_BRIDGE_PORT || '5174';
      const provider = config.provider['github-copilot'] || {
        baseUrl: `http://localhost:${port}/v1`,
        apiKey: "noop" // Copilot itself is authed via gh CLI inside the bridge; this field is unused
      };

      // The bridge now requires a per-launch bearer token. Wire it as an {env:} reference
      // so OpenCode resolves it from its own env at request time and the token is never
      // written into opencode.json in the clear.
      if (envValues.CONSTRUCT_COPILOT_BRIDGE_TOKEN) {
        provider.options = provider.options || {};
        provider.options.headers = provider.options.headers || {};
        provider.options.headers.Authorization = '{env:CONSTRUCT_COPILOT_BRIDGE_TOKEN}';
      }
      config.provider['github-copilot'] = provider;
    }
  }

  fs.mkdirSync(path.dirname(target), { recursive: true });

  // Local-model tuning for the OpenCode → Ollama path (ADR-0002). The
  // OpenAI-compatible `/v1` boundary OpenCode speaks drops Ollama-specific options
  // (num_ctx, repeat_penalty) — setting them here is a silent no-op, so the real
  // context window and repeat penalty are baked into Modelfile variants upstream
  // (lib/ollama/provision-context.mjs) and registered by sync-config. Only
  // OpenAI-standard params survive the boundary, so emit just those: temperature
  // and ChatML stop sequences. limit.context is OpenCode's own compaction budget,
  // set to the variant's real window. Never emit frequency/presence penalty — the
  // wrong knob for Qwen and a source of repetition collapse.

  const CHATML_STOPS = ["<|im_start|>", "<|im_end|>", "<|endoftext|>"];
  const applyLocalOptimizations = (m, provider) => {
    if (!m || typeof m !== "object") return;
    const isLocal = provider === 'ollama' || provider === 'github-copilot' ||
                    m.provider === 'ollama' || m.provider === 'github-copilot';

    if (isLocal) {
      m.limit = m.limit || {};
      m.limit.context = 32768;
      m.limit.output = 4096;

      m.options = m.options || {};
      m.options.temperature = 0.1;
      m.options.stop = CHATML_STOPS;
      delete m.options.num_ctx;
      delete m.options.repeat_penalty;
      delete m.options.frequency_penalty;
      delete m.options.presence_penalty;
      delete m.options.frequencyPenalty;
      delete m.options.presencePenalty;
    }

    // The temporary id/provider keys exist only to pass OpenCode schema validation
    // during mapping; strip them before write.

    delete m.id;
    delete m.provider;
  };

  if (config.models && Array.isArray(config.models)) {
    config.models.forEach(m => applyLocalOptimizations(m, m.provider));
  }

  if (config.provider) {
    for (const [pId, p] of Object.entries(config.provider)) {
      if (p.models) {
        for (const m of Object.values(p.models)) {
          applyLocalOptimizations(m, pId);
        }
      }
    }
  }

  // Remove the root models array as it violates OpenCode's strict JSON schema.
  // The relevant models should only be defined under provider.<name>.models
  delete config.models;

  ensureOpenRouterProviderAuth(config);

  // The plugin array is hand- and CLI-editable, so it accumulates junk: stale
  // toolkit paths from moved checkouts and stray CLI tokens (e.g. a literal
  // "list"). A non-existent path entry can break plugin loading outright. Keep
  // existing file-path plugins and plausible package specifiers, deduped.

  if (Array.isArray(config.plugin)) {
    const seen = new Set();
    config.plugin = config.plugin.filter((entry) => {
      if (typeof entry !== "string" || !entry.trim() || seen.has(entry)) return false;
      seen.add(entry);
      const isPath = /^([./~]|[A-Za-z]:[\\/])/.test(entry) || /\.[cm]?js$/.test(entry);
      if (isPath) return fs.existsSync(entry);
      return entry.length > 2 && (/^@/.test(entry) || /[-/]/.test(entry));
    });
  }

  fs.writeFileSync(target, `${JSON.stringify(sanitizeOpenCodeConfig(config), null, 2)}\n`, { encoding: "utf8", mode: 0o600 });

  // opencode.json can carry a resolved provider apiKey or Authorization header.
  // writeFileSync keeps an existing inode's mode, so the mode option above does not
  // tighten a file an earlier write left 0644; re-apply 0600 on every write, matching
  // lib/env-config.mjs's writeEnvValues contract for config.env.

  if (process.platform !== "win32") {
    try { fs.chmodSync(target, 0o600); } catch { /* exotic filesystem */ }
  }
  return target;
}
