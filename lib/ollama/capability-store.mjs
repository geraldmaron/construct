/**
 * lib/ollama/capability-store.mjs — durable record of local-model agentic coherence.
 *
 * `construct doctor --probe-local` measures whether each Ollama model can drive
 * the agentic loop or collapses into word salad, and writes the verdict here.
 * sync and doctor READ this store (they never probe — probing loads each model and
 * costs minutes) to skip Modelfile provisioning for collapsed models, inform the
 * MCP-trim decision, and warn when a configured default model cannot do agentic
 * work. Verdicts are keyed by the model's `ollama list` digest so a re-pulled tag
 * goes stale and is re-probed rather than trusted blindly.
 *
 * Lives at ~/.construct/local-models.json because local-model capability is a property of
 * the machine's Ollama install, not of any one project.
 */
import fs from "node:fs";
import path from "node:path";
import { constructDir } from "../paths.mjs";

const STORE_VERSION = 1;

export function localModelsPath() {
  return path.join(constructDir(), "local-models.json");
}

export function readCapabilityStore() {
  try {
    const raw = JSON.parse(fs.readFileSync(localModelsPath(), "utf8"));
    if (raw && raw.version === STORE_VERSION && raw.models && typeof raw.models === "object") return raw;
  } catch { /* missing or malformed — treat as empty */ }
  return { version: STORE_VERSION, models: {} };
}

// Persist one probe result. probeResult is the object probeAgenticCoherence
// returns ({ ok, coherent, repeatRatio, uniqueRatio, ... }); a probe that errored
// (ok=false) is not recorded, so a transient failure never overwrites a real verdict.

export function recordProbeResult(model, probeResult, digest = null) {
  if (!probeResult || probeResult.ok !== true) return readCapabilityStore();
  const store = readCapabilityStore();
  store.models[model] = {
    verdict: probeResult.coherent ? "COHERENT" : "COLLAPSED",
    coherent: probeResult.coherent === true,
    calledTool: probeResult.calledTool === true,
    repeatRatio: probeResult.repeatRatio ?? null,
    uniqueRatio: probeResult.uniqueRatio ?? null,
    digest: digest ?? null,
    probedAt: new Date().toISOString(),
  };
  const dir = path.dirname(localModelsPath());
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(localModelsPath(), `${JSON.stringify(store, null, 2)}\n`);
  return store;
}

export function getModelVerdict(model) {
  return readCapabilityStore().models[model] ?? null;
}

// A verdict is stale when no digest is recorded for it or the current digest
// differs from the one it was measured against — callers re-probe rather than
// trust a verdict about different model bytes.

export function isVerdictStale(model, currentDigest) {
  const entry = getModelVerdict(model);
  if (!entry) return true;
  if (!currentDigest || !entry.digest) return true;
  return entry.digest !== currentDigest;
}

// COLLAPSED only counts when the digest still matches: a stale or unknown verdict
// must not strand a model. Callers warn-and-allow-override rather than hide.

export function isKnownCollapsed(model, currentDigest = null) {
  const entry = getModelVerdict(model);
  if (!entry) return false;
  if (currentDigest && isVerdictStale(model, currentDigest)) return false;
  return entry.verdict === "COLLAPSED";
}
