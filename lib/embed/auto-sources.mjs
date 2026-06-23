/**
 * lib/embed/auto-sources.mjs — resolve embed auto-discovery sources from project config.
 *
 * When embed.yaml is absent, builds provider source records from typed
 * construct.config.json targets merged with legacy env lists. Falls back
 * to broad provider defaults only when no targets are configured.
 */

import { loadProjectConfig } from '../config/project-config.mjs';
import {
  resolveEffectiveSourceTargetsFromConfig,
  targetsToEmbedSources,
  legacyEnvSourceTargets,
} from '../config/source-targets.mjs';

export function resolveAutoEmbedSources({ cwd = process.cwd(), env = process.env, registry }) {
  const { config } = loadProjectConfig(cwd, env);
  const targets = resolveEffectiveSourceTargetsFromConfig(config, env);

  if (targets.length === 0) {
    return registry.autoSources(env);
  }

  const configuredProviders = new Set(targets.map((t) => t.provider));
  const hasLegacyForUnconfigured = (provider) =>
    legacyEnvSourceTargets(env).some((t) => t.provider === provider);

  const sources = targetsToEmbedSources(targets);

  for (const name of registry.names()) {
    if (configuredProviders.has(name)) continue;
    if (hasLegacyForUnconfigured(name)) continue;
    const instance = registry.get(name);
    if (typeof instance?.defaultSources !== 'function') continue;
  }

  const seen = new Set();
  return sources.filter((s) => {
    const key = `${s.provider}:${(s.refs ?? []).join(',')}:${JSON.stringify(s.repos ?? s.project ?? s.team ?? s.channels ?? '')}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}
