/**
 * lib/prompt-metadata.mjs — prompt identity helpers for telemetry.
 *
 * Resolves a worker-profile id to its canonical registry record and returns a
 * stable hash/version fingerprint. Telemetry sends the profile identity rather
 * than embedding private runtime instructions in every trace.
 */
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { loadRegistry } from './registry/loader.mjs';

function findEntry(registry, workerProfileId) {
  return registry.workerProfiles?.[workerProfileId] ?? null;
}

function stableValue(value) {
  if (Array.isArray(value)) return value.map(stableValue);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(
    Object.keys(value).sort().map((key) => [key, stableValue(value[key])]),
  );
}

export function resolvePromptEntry(workerProfileId, { rootDir = process.cwd(), registry } = {}) {
  if (typeof workerProfileId !== 'string' || !workerProfileId) return null;
  const loadedRegistry = registry ?? loadRegistry({ rootDir });
  if (!loadedRegistry) return null;
  return findEntry(loadedRegistry, workerProfileId);
}

export function resolveWorkerProfilePromptPath(workerProfileId, options = {}) {
  const entry = resolvePromptEntry(workerProfileId, options);
  if (!entry) return null;
  return path.join('registry', 'worker-profiles', 'prompts', `${entry.id}.md`);
}

export function resolvePromptMetadata(workerProfileId, { rootDir = process.cwd(), registry } = {}) {
  if (!workerProfileId) return {};
  const entry = resolvePromptEntry(workerProfileId, { rootDir, registry });
  if (!entry) return {};
  const promptPath = resolveWorkerProfilePromptPath(workerProfileId, { rootDir, registry });
  const absolutePromptPath = path.join(rootDir, promptPath);
  if (!fs.existsSync(absolutePromptPath)) return {};
  const content = `${JSON.stringify(stableValue(entry))}\n${fs.readFileSync(absolutePromptPath, 'utf8')}`;
  const profileHash = crypto.createHash('sha256').update(content).digest('hex');
  return {
    workerProfileId: entry.id,
    workerProfilePromptPath: promptPath,
    workerProfileHash: profileHash,
    workerProfileVersion: profileHash.slice(0, 12),
    workerProfileSource: 'registry',
  };
}

export function enrichMetadataWithPrompt(workerProfileId, metadata = {}, options = {}) {
  return {
    ...resolvePromptMetadata(workerProfileId, options),
    ...metadata,
  };
}
