/**
 * lib/prompt-metadata.mjs — prompt identity helpers for telemetry.
 *
 * Resolves an agent or persona name to its git-owned prompt file and returns a
 * stable hash/version fingerprint. Telemetry should send these identifiers to
 * Langfuse instead of embedding full production prompt text in every trace.
 */
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

function readJson(file) {
  if (!fs.existsSync(file)) return null;
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

function normalizeName(name) {
  return String(name ?? '')
    .trim()
    .replace(/^cx-/, '')
    .replace(/^opencode\./, '')
    .toLowerCase();
}

function findEntry(registry, agentName) {
  const normalized = normalizeName(agentName);
  const entries = [
    ...(registry.personas ?? []),
    ...(registry.agents ?? []),
  ];
  return entries.find((entry) => {
    const entryName = normalizeName(entry.name);
    return entryName === normalized || `cx-${entryName}` === String(agentName ?? '').trim().toLowerCase();
  }) ?? null;
}

export function resolvePromptEntry(agentName, { rootDir = process.cwd(), registry } = {}) {
  if (!agentName) return null;
  const loadedRegistry = registry ?? readJson(path.join(rootDir, 'agents', 'registry.json'));
  if (!loadedRegistry) return null;
  return findEntry(loadedRegistry, agentName);
}

export function resolvePromptMetadata(agentName, { rootDir = process.cwd(), registry } = {}) {
  if (!agentName) return {};
  const entry = resolvePromptEntry(agentName, { rootDir, registry });
  if (!entry?.promptFile) return {};

  const promptPath = path.join(rootDir, entry.promptFile);
  if (!fs.existsSync(promptPath)) return {};

  const content = fs.readFileSync(promptPath, 'utf8');
  const promptHash = crypto.createHash('sha256').update(content).digest('hex');
  return {
    promptName: entry.name,
    promptFile: entry.promptFile,
    promptHash,
    promptVersion: promptHash.slice(0, 12),
    promptSource: 'git',
  };
}

export function enrichMetadataWithPrompt(agentName, metadata = {}, options = {}) {
  return {
    ...resolvePromptMetadata(agentName, options),
    ...metadata,
  };
}
