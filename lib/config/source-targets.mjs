/**
 * lib/config/source-targets.mjs — typed integration source targets in construct.config.json.
 *
 * Validates provider selector records, merges legacy env target lists
 * additively, deduplicates by provider+selector signature, and converts
 * resolved targets into embed provider source records for auto-discovery.
 *
 * Every function here dispatches on the manifest-derived descriptors from
 * lib/config/source-target-registry.mjs rather than naming providers
 * directly — adding a fifth source-target-eligible provider means adding a
 * `sourceTarget` block to that provider's manifest, not editing this file.
 * See source-target-registry.mjs's header for what each descriptor field
 * drives.
 */

import { statSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

import {
  SOURCE_TARGET_PROVIDERS,
  getSourceTargetDescriptor,
  listSourceTargetDescriptors,
  renderTemplate,
} from './source-target-registry.mjs';

export const SOURCE_PROVIDERS = SOURCE_TARGET_PROVIDERS;

const slackDescriptor = getSourceTargetDescriptor('slack');
export const SLACK_INTENTS = Object.freeze(slackDescriptor?.secondaryField?.enum ?? []);

const ID_RE = /^[a-z][a-z0-9_-]{0,63}$/i;

// Path selectors (directory) are stored portably with a leading `~`; the concrete
// home is resolved at validate/read time so a config survives moves between machines.

export function expandTilde(value, home = homedir()) {
  const str = String(value ?? '');
  if (str === '~') return home;
  if (str.startsWith('~/')) return join(home, str.slice(2));
  return str;
}

function applyPatternTransform(value, mode) {
  if (mode === 'trimUpper') return value.trim().toUpperCase();
  return value.trim();
}

export function validateSourceTarget(target, index = 0) {
  const errors = [];
  const at = `sources.targets[${index}]`;

  if (!target || typeof target !== 'object' || Array.isArray(target)) {
    return [`${at}: must be an object`];
  }

  if (typeof target.id !== 'string' || !ID_RE.test(target.id)) {
    errors.push(`${at}.id: required stable id (letters, numbers, hyphens, underscores; max 64 chars)`);
  }

  if (!SOURCE_PROVIDERS.includes(target.provider)) {
    errors.push(`${at}.provider: must be one of ${SOURCE_PROVIDERS.join(', ')}`);
  }

  if (!target.selector || typeof target.selector !== 'object' || Array.isArray(target.selector)) {
    errors.push(`${at}.selector: required object`);
    return errors;
  }

  const descriptor = getSourceTargetDescriptor(target.provider);
  if (!descriptor) return errors;

  const sel = target.selector;
  const { field, pattern, patternTransform, hint } = descriptor.selector;
  const raw = sel[field];
  const valid = typeof raw === 'string' && (
    pattern
      ? new RegExp(pattern).test(applyPatternTransform(raw, patternTransform))
      : !!raw.trim()
  );
  if (!valid) {
    errors.push(`${at}.selector.${field}: ${hint}`);
  }

  // A descriptor whose selector declares `existsAs` (directory targets) must
  // resolve to a real filesystem entry of that kind at validate time — a
  // format-valid but nonexistent path is an actionable error, not silent.

  if (valid && descriptor.selector.existsAs) {
    const resolved = descriptor.selector.expand === 'tilde' ? expandTilde(raw.trim()) : raw.trim();
    let onDisk = false;
    try {
      const st = statSync(resolved);
      onDisk = descriptor.selector.existsAs === 'directory' ? st.isDirectory() : st.isFile();
    } catch { onDisk = false; }
    if (!onDisk) {
      errors.push(`${at}.selector.${field}: ${descriptor.selector.existsHint ?? hint}`);
    }
  }

  if (descriptor.secondaryField) {
    const { field: secField, enum: secEnum, hint: secHint } = descriptor.secondaryField;
    if (sel[secField] !== undefined && !secEnum.includes(sel[secField])) {
      errors.push(`${at}.selector.${secField}: ${secHint} ${secEnum.join(', ')}`);
    }
  }

  return errors;
}

export function validateSourceTargets(targets) {
  const errors = [];
  if (targets === undefined) return errors;
  if (!Array.isArray(targets)) {
    return ['sources.targets: must be an array'];
  }

  const seenIds = new Set();
  for (let i = 0; i < targets.length; i++) {
    errors.push(...validateSourceTarget(targets[i], i));
    const id = targets[i]?.id;
    if (typeof id === 'string') {
      const key = id.toLowerCase();
      if (seenIds.has(key)) {
        errors.push(`sources.targets[${i}].id: duplicate id "${id}"`);
      }
      seenIds.add(key);
    }
  }
  return errors;
}

function parseCsv(value) {
  return String(value ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
}

function slugId(value) {
  return String(value).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}

function parseSlackChannelEntry(raw, descriptor) {
  const trimmed = String(raw).trim().replace(/^#/, '');
  const colon = trimmed.indexOf(':');
  const fallback = descriptor.secondaryField.default;
  if (colon === -1) {
    return { channel: trimmed, intent: fallback };
  }
  const intent = trimmed.slice(colon + 1) || fallback;
  return { channel: trimmed.slice(0, colon), intent };
}

function legacyEnvRawValue(vars, env) {
  return vars.reduce((acc, name) => (acc !== undefined ? acc : env[name]), undefined);
}

export function legacyEnvSourceTargets(env = process.env) {
  const targets = [];

  for (const descriptor of listSourceTargetDescriptors()) {
    const { provider, legacyEnv, selector } = descriptor;
    if (!legacyEnv) continue;
    const raw = legacyEnvRawValue(legacyEnv.vars, env);
    const provenance = `env:${legacyEnv.vars[0]}`;

    if (legacyEnv.parse === 'slackChannelColon') {
      for (const entry of parseCsv(raw)) {
        const { channel, intent } = parseSlackChannelEntry(entry, descriptor);
        targets.push({
          id: `env-${provider}-${slugId(channel)}`,
          provider,
          selector: { [selector.field]: channel, [descriptor.secondaryField.field]: intent },
          provenance,
        });
      }
      continue;
    }

    for (const entry of parseCsv(raw)) {
      const value = legacyEnv.valueTransform === 'upper' ? entry.toUpperCase() : entry;
      targets.push({
        id: `env-${provider}-${slugId(value)}`,
        provider,
        selector: { [selector.field]: value },
        provenance,
      });
    }
  }

  return targets;
}

function signatureValue(raw, mode) {
  if (mode === 'optionalLower') return raw?.trim().toLowerCase();
  if (mode === 'upperOrEmpty') return String(raw ?? '').trim().toUpperCase();
  return String(raw ?? '').trim().toLowerCase();
}

export function targetSignature(target) {
  const sel = target.selector ?? {};
  const descriptor = getSourceTargetDescriptor(target.provider);
  if (!descriptor) return `${target.provider}:${JSON.stringify(sel)}`;

  const value = signatureValue(sel[descriptor.selector.field], descriptor.signature.valueMode);
  const intent = descriptor.secondaryField ? (sel[descriptor.secondaryField.field] ?? descriptor.secondaryField.default) : undefined;
  return renderTemplate(descriptor.signature.template, { value, intent });
}

export function mergeSourceTargets(configTargets = [], envTargets = []) {
  const merged = [];
  const seen = new Set();

  for (const target of [...configTargets, ...envTargets]) {
    const sig = targetSignature(target);
    if (seen.has(sig)) continue;
    seen.add(sig);
    merged.push(target);
  }
  return merged;
}

export function normalizeConfigTarget(raw) {
  const out = {
    id: String(raw.id).trim(),
    provider: raw.provider,
    selector: { ...raw.selector },
    provenance: raw.provenance ?? 'config',
  };

  const descriptor = getSourceTargetDescriptor(out.provider);
  if (!descriptor) return out;

  const { field, normalize } = descriptor.selector;
  if (out.selector[field]) {
    const value = String(out.selector[field]);
    out.selector[field] = normalize === 'trimHash'
      ? value.trim().replace(/^#/, '')
      : applyPatternTransform(value, normalize === 'trimUpper' ? 'trimUpper' : 'trim');
  }

  if (descriptor.secondaryField && !out.selector[descriptor.secondaryField.field]) {
    out.selector[descriptor.secondaryField.field] = descriptor.secondaryField.default;
  }

  return out;
}

export function resolveEffectiveSourceTargetsFromConfig(config, env = process.env) {
  const configTargets = (config?.sources?.targets ?? []).map(normalizeConfigTarget);
  const envTargets = legacyEnvSourceTargets(env);
  return mergeSourceTargets(configTargets, envTargets);
}

export function targetsToEmbedSources(targets) {
  const sources = [];

  for (const descriptor of listSourceTargetDescriptors()) {
    const { provider, embed } = descriptor;
    if (!embed) continue;
    const selField = descriptor.selector.field;
    const providerTargets = targets.filter((t) => t.provider === provider);
    if (!providerTargets.length) continue;

    if (embed.mode === 'aggregate') {
      const values = providerTargets.map((t) => t.selector[selField]);
      for (const group of embed.groups) {
        sources.push({ provider, [embed.valueField]: values, refs: group.refs, limit: group.limit });
      }
    } else if (embed.mode === 'perTarget') {
      for (const target of providerTargets) {
        sources.push({ provider, [embed.valueField]: target.selector[selField], refs: embed.refs, limit: embed.limit });
      }
    } else if (embed.mode === 'groupBy') {
      const byGroup = new Map();
      for (const target of providerTargets) {
        const key = target.selector[embed.groupField] ?? embed.groupDefault;
        if (!byGroup.has(key)) byGroup.set(key, []);
        byGroup.get(key).push(target.selector[selField]);
      }
      for (const [key, values] of byGroup) {
        sources.push({
          provider,
          [embed.valueField]: values,
          [embed.groupField]: key,
          refs: embed.refs,
          oldest: embed.oldest,
          limit: embed.limit,
        });
      }
    }
  }

  return sources;
}

export function resolveKnownSourcesFromTargets(targets) {
  const sources = [];

  for (const target of targets) {
    const descriptor = getSourceTargetDescriptor(target.provider);
    if (!descriptor) continue;
    const sel = target.selector ?? {};
    const value = sel[descriptor.selector.field];
    if (!value) continue;

    const display = descriptor.aliases.displayPrefix ? `${descriptor.aliases.displayPrefix}/${value}` : value;

    if (descriptor.aliases.strategy === 'repoWords') {
      const short = value.split('/').pop();
      sources.push({ id: value.toLowerCase(), provider: target.provider, ref: value, display, targetId: target.id });
      sources.push({ id: short.toLowerCase(), provider: target.provider, ref: value, display, targetId: target.id });
      sources.push({ id: short.replace(/-/g, '').toLowerCase(), provider: target.provider, ref: value, display, targetId: target.id });
      const words = short.split('-');
      if (words.length > 1) {
        sources.push({ id: words[words.length - 1].toLowerCase(), provider: target.provider, ref: value, display, targetId: target.id });
      }
    } else {
      sources.push({ id: value.toLowerCase(), provider: target.provider, ref: value, display, targetId: target.id });
    }
  }

  const providers = new Set(targets.map((t) => t.provider));
  for (const descriptor of listSourceTargetDescriptors()) {
    if (descriptor.aliases.catchAll && providers.has(descriptor.provider)) {
      sources.push({ id: descriptor.provider, provider: descriptor.provider, ref: null, display: descriptor.aliases.displayPrefix });
    }
  }

  return sources;
}

// Team bindings take precedence over project config, which takes precedence over
// legacy env. Resolution is by typed selector signature — no substring guessing —
// so a team's effective sources are stable and conflict-free.

export function resolveTeamSources(teamId, { registry, config, env = process.env } = {}) {
  const team = registry?.teams?.[teamId];
  const teamTargets = Array.isArray(team?.sources)
    ? team.sources.map((s) => ({
        ...normalizeConfigTarget(s),
        provenance: `team:${teamId}`,
        ...(s.filters && typeof s.filters === 'object' ? { filters: s.filters } : {}),
      }))
    : [];
  const configTargets = (config?.sources?.targets ?? []).map(normalizeConfigTarget);
  const envTargets = legacyEnvSourceTargets(env);
  return mergeSourceTargets(teamTargets, mergeSourceTargets(configTargets, envTargets));
}

// Per-target embed records that honor each target's own filters (jira jql,
// github refs/limit, slack oldest) and tag the record with the owning teamId and
// targetId so observations stay retrievable by team scope rather than a global
// pool. Falls back to the same defaults as targetsToEmbedSources when a target
// declares no filters.

export function targetsToEmbedSourcesWithFilters(targets, { teamId = null } = {}) {
  const sources = [];
  const tag = (rec, target) => ({
    ...rec,
    ...(teamId ? { teamId } : {}),
    targetId: target.id,
  });

  for (const target of targets) {
    const descriptor = getSourceTargetDescriptor(target.provider);
    if (!descriptor?.embedFilters) continue;
    const ef = descriptor.embedFilters;
    const f = target.filters ?? {};
    const sel = target.selector ?? {};
    const selField = descriptor.selector.field;

    const rec = {
      provider: target.provider,
      [ef.valueField]: ef.valueKind === 'array' ? [sel[selField]] : sel[selField],
      refs: ef.refsFilterKey && Array.isArray(f[ef.refsFilterKey]) ? f[ef.refsFilterKey] : ef.defaultRefs,
      limit: Number.isInteger(f.limit) ? f.limit : ef.defaultLimit,
    };

    if (ef.includeSecondaryField && descriptor.secondaryField) {
      rec[descriptor.secondaryField.field] = sel[descriptor.secondaryField.field] ?? descriptor.secondaryField.default;
    }

    for (const key of ef.extraFilterKeys ?? []) {
      if (key === 'jql' && typeof f.jql === 'string') rec.jql = f.jql;
      if (key === 'states' && Array.isArray(f.states)) rec.states = f.states;
      if (key === 'oldest') rec.oldest = Number.isInteger(f.oldest) ? f.oldest : descriptor.embed?.oldest;
    }

    sources.push(tag(rec, target));
  }

  return sources;
}
