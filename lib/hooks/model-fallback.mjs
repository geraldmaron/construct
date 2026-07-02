#!/usr/bin/env node
/**
 * lib/hooks/model-fallback.mjs — Provider-aware model fallback hook.
 *
 * Runs as PostToolUse. On a retryable provider failure it:
 *   1. Classifies the error via classifyProviderFailure.
 *   2. Selects a fallback candidate via selectFallbackModel, skipping any
 *      provider currently in its 5-minute cooldown window.
 *   3. Writes the new model directly to the project .env via applyToEnv.
 *   4. Records a cooldown entry for the failing provider.
 *
 * Falls back to `construct models --apply` only when no candidate is resolved
 * (e.g. no registry fallback list, all candidates on cooldown, or no OpenRouter
 * key for the free-tier path).
 *
 * @p95ms 150
 * @maxBlockingScope none (PostToolUse, non-blocking)
 *
 * @lifecycle PostToolUseFailure
 * @matcher  *
 * @exits 0 = pass
 */
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { homedir } from 'node:os';
import { join } from 'node:path';
import {
  applyToEnv,
  classifyProviderFailure,
  readOpenRouterApiKeyFromOpenCodeConfig,
  selectFallbackModel,
  writeProviderCooldown,
} from '../model-router.mjs';
import { extractOpRef, resolveOpRef, resolveSecret } from '../providers/secret-resolver.mjs';
import { readHookInput } from './_lib/input.mjs';
import { doctorRoot } from '../config/xdg.mjs';

const cooldownPath = join(doctorRoot(), 'provider-cooldowns.json');
const envPath = join(process.cwd(), '.env');

const input = readHookInput();

const classified = classifyProviderFailure(input);
if (!classified || !classified.retryable) process.exit(0);

process.stderr.write(`[model-fallback] ${classified.kind} detected (provider: ${classified.provider ?? 'unknown'}).\n`);

const now = Date.now();
const result = selectFallbackModel({ hookInput: input, envPath, cooldownPath, now });

if (result) {
  process.stderr.write(`[model-fallback] Switching ${result.tier} → ${result.targetModel} (reason: ${result.reason}).\n`);
  applyToEnv(envPath, { [result.tier]: result.targetModel });
  if (classified.provider) writeProviderCooldown(cooldownPath, classified.provider, now);
  process.exit(0);
}

// No candidate resolved — fall back to full `construct models --apply` if possible.
const toolkitDir = process.env.CX_TOOLKIT_DIR || join(homedir(), '.construct');
const constructBin = join(toolkitDir, 'bin', 'construct');

if (!existsSync(constructBin)) {
  process.stderr.write(`[model-fallback] No fallback candidate and construct binary not found at ${constructBin}.\n`);
  if (classified.provider) writeProviderCooldown(cooldownPath, classified.provider, now);
  process.exit(0);
}

function materializeConfiguredKey(rawValue) {
  if (typeof rawValue !== 'string' || rawValue.length === 0) return null;
  const ref = extractOpRef(rawValue);
  try {
    return ref ? resolveOpRef(ref) : rawValue;
  } catch {
    return null;
  }
}

function resolveOpenRouterApiKey() {
  try {
    const envKey = resolveSecret('OPENROUTER_API_KEY', { env: process.env });
    if (envKey) return envKey;
  } catch {
    // Fall through to the OpenCode provider config.
  }
  try {
    return materializeConfiguredKey(readOpenRouterApiKeyFromOpenCodeConfig());
  } catch {
    return null;
  }
}

const openRouterApiKey = resolveOpenRouterApiKey();

if (!openRouterApiKey) {
  process.stderr.write('[model-fallback] No fallback candidate and no OpenRouter API key — cannot poll models.\n');
  if (classified.provider) writeProviderCooldown(cooldownPath, classified.provider, now);
  process.exit(0);
}

try {
  process.stderr.write('[model-fallback] No direct candidate — running construct models --apply.\n');
  execFileSync(constructBin, ['models', '--apply'], {
    cwd: toolkitDir,
    stdio: 'inherit',
    env: { ...process.env, CX_TOOLKIT_DIR: toolkitDir, OPENROUTER_API_KEY: openRouterApiKey },
    timeout: 120_000,
  });
  if (classified.provider) writeProviderCooldown(cooldownPath, classified.provider, now);
} catch (error) {
  process.stderr.write(`[model-fallback] construct models --apply failed: ${error.message}\n`);
}

process.exit(0);
