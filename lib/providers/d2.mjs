/**
 * lib/providers/d2.mjs — D2 diagram renderer Provider (construct-tsyfe.4.3).
 *
 * Centralizes binary discovery, version reporting, canonical CLI vs distribution
 * flag sets, and Provider Card identity for every D2 subprocess invocation.
 */

import fs from 'node:fs';
import { spawnSync } from 'node:child_process';
import { findProviderCard } from './provider-card.mjs';

export const D2_PROVIDER_ID = 'd2';

export const D2_DISTRIBUTION_THEME_ID = '0';
export const D2_DISTRIBUTION_PAD = '16';
export const D2_DISTRIBUTION_SCALE = '0.72';
export const D2_DISTRIBUTION_SKETCH = true;
export const D2_DISTRIBUTION_FONT_SIZE = '14';

export const D2_THEMES = {
  neutral: 0,
  'neutral-grey': 1,
  'flagship-terrastruct': 3,
  'cool-classics': 4,
  'mixed-berry-blue': 5,
  'grape-soda': 6,
  aubergine: 7,
  'colorblind-clear': 8,
  'vanilla-nitro-cola': 100,
  'orange-creamsicle': 101,
};

function whichBin(name, env = process.env) {
  const cmd = process.platform === 'win32' ? 'where' : 'which';
  const result = spawnSync(cmd, [name], { encoding: 'utf8', env });
  if (result.status !== 0) return null;
  return (result.stdout || '').trim().split('\n')[0] || null;
}

export function resolveD2Bin(env = process.env) {
  const fromEnv = (env.CONSTRUCT_D2_BIN || '').trim();
  if (fromEnv && fs.existsSync(fromEnv)) return fromEnv;
  return whichBin('d2', env);
}

export function readD2Version(binary, env = process.env, card = null) {
  if (!binary) return null;
  const hc = card?.healthCheck;
  const args = hc?.args ?? ['--version'];
  const result = spawnSync(binary, args, {
    encoding: 'utf8',
    timeout: hc?.timeoutMs ?? 10_000,
    env,
  });
  if (result.status !== 0) return null;
  const text = `${result.stdout || ''}${result.stderr || ''}`.trim();
  return text.split('\n')[0]?.trim() || null;
}

export function queryD2ProviderCard() {
  const card = findProviderCard(D2_PROVIDER_ID);
  return {
    id: D2_PROVIDER_ID,
    card,
    installHint: card?.fallback?.description
      || (process.platform === 'darwin'
        ? 'brew install d2   (or: brew install graphviz for dot fallback)'
        : 'See https://d2lang.com/tour/install'),
  };
}

export function resolveD2Provider(env = process.env) {
  const identity = queryD2ProviderCard();
  const path = resolveD2Bin(env);
  const version = path ? readD2Version(path, env, identity.card) : null;
  return {
    ...identity,
    engine: 'd2',
    path,
    version,
    usable: Boolean(path),
    degraded: !path,
  };
}

export function buildD2CliArgs({ sourcePath, outPath, theme = 'neutral' } = {}) {
  const args = [];
  const themeName = theme?.toLowerCase();
  if (themeName === 'sketch') {
    args.push('--sketch');
  } else if (themeName) {
    const themeId = D2_THEMES[themeName];
    if (themeId != null) args.push('--theme', String(themeId));
  }
  args.push(sourcePath, outPath);
  return args;
}

export function buildD2DistributionArgs({ sourcePath, outPath } = {}) {
  return [
    '--sketch',
    '--pad', D2_DISTRIBUTION_PAD,
    '--theme', D2_DISTRIBUTION_THEME_ID,
    sourcePath,
    outPath,
  ];
}

export function buildD2ProviderCardPayload({ binary, version, flags, profile } = {}) {
  const identity = queryD2ProviderCard();
  return {
    providerId: identity.id,
    engine: 'd2',
    version: version ?? null,
    binary: binary ?? null,
    profile: profile ?? null,
    flags: flags ?? [],
    degraded: !binary,
    card: identity.card ?? null,
  };
}

export function spawnD2Render({
  binary,
  sourcePath,
  outPath,
  profile = 'cli',
  theme = 'neutral',
  env = process.env,
  timeoutMs = 60_000,
  spawnSyncFn = spawnSync,
} = {}) {
  if (!binary) {
    return {
      ...buildD2ProviderCardPayload({ binary: null, version: null, flags: [], profile }),
      result: { status: 1, stderr: 'd2 binary not found' },
    };
  }
  const flags = profile === 'distribution'
    ? buildD2DistributionArgs({ sourcePath, outPath })
    : buildD2CliArgs({ sourcePath, outPath, theme });
  const result = spawnSyncFn(binary, flags, { encoding: 'utf8', timeout: timeoutMs, env });
  const version = readD2Version(binary, env, queryD2ProviderCard().card);
  return {
    ...buildD2ProviderCardPayload({ binary, version, flags, profile }),
    result,
  };
}

export function distributionD2Defaults() {
  return {
    d2Theme: 'neutral',
    d2ThemeId: D2_DISTRIBUTION_THEME_ID,
    d2Sketch: D2_DISTRIBUTION_SKETCH,
    d2Scale: Number(D2_DISTRIBUTION_SCALE),
    d2FontSize: Number(D2_DISTRIBUTION_FONT_SIZE),
  };
}

export function installHint(env = process.env) {
  return queryD2ProviderCard().installHint;
}
