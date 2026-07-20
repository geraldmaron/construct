/**
 * lib/providers/vhs.mjs — VHS terminal recording Provider (construct-tsyfe.5.3).
 *
 * Centralizes binary discovery, version reporting, process-group cleanup on
 * spawn, and Provider Card identity for Construct demo tape rendering.
 */

import fs from 'node:fs';
import { spawnSync } from 'node:child_process';
import { findProviderCard } from './provider-card.mjs';

export const VHS_PROVIDER_ID = 'vhs';

const ASCIINEMA_PROVIDER_ID = 'asciinema';

function whichBin(name, env = process.env) {
  const cmd = process.platform === 'win32' ? 'where' : 'which';
  const result = spawnSync(cmd, [name], { encoding: 'utf8', env });
  if (result.status !== 0) return null;
  return (result.stdout || '').trim().split('\n')[0] || null;
}

export function resolveVhsBin(env = process.env) {
  const fromEnv = (env.CONSTRUCT_VHS_BIN || '').trim();
  if (fromEnv && fs.existsSync(fromEnv)) return fromEnv;
  return whichBin('vhs', env);
}

export function resolveAsciinemaBin(env = process.env) {
  const fromEnv = (env.CONSTRUCT_ASCIINEMA_BIN || '').trim();
  if (fromEnv && fs.existsSync(fromEnv)) return fromEnv;
  return whichBin('asciinema', env);
}

export function readVhsVersion(binary, env = process.env, card = null) {
  if (!binary) return null;
  const hc = card?.healthCheck;
  const args = hc?.args ?? ['--version'];
  const result = spawnSync(binary, args, {
    encoding: 'utf8',
    timeout: hc?.timeoutMs ?? 5000,
    env,
  });
  if (result.status !== 0) return null;
  return (result.stdout || result.stderr || '').trim().split('\n')[0] || null;
}

export function queryVhsProviderCard() {
  const card = findProviderCard(VHS_PROVIDER_ID);
  return {
    id: VHS_PROVIDER_ID,
    card,
    installHint: card?.fallback?.description
      || 'Install VHS for terminal demo recording (https://github.com/charmbracelet/vhs#installation). Override with CONSTRUCT_VHS_BIN.',
  };
}

export function resolveVhsProvider(env = process.env) {
  const identity = queryVhsProviderCard();
  const path = resolveVhsBin(env);
  const version = path ? readVhsVersion(path, env, identity.card) : null;
  return {
    ...identity,
    engine: 'vhs',
    path,
    version,
    usable: Boolean(path),
    degraded: !path,
  };
}

export function locateTerminalRecorder(env = process.env) {
  const vhs = resolveVhsProvider(env);
  if (vhs.path) {
    return { engine: 'vhs', binary: vhs.path, provider: vhs };
  }
  const asciinemaPath = resolveAsciinemaBin(env);
  if (asciinemaPath) {
    return {
      engine: 'asciinema',
      binary: asciinemaPath,
      provider: {
        id: ASCIINEMA_PROVIDER_ID,
        engine: 'asciinema',
        path: asciinemaPath,
        version: null,
        usable: true,
        degraded: false,
      },
    };
  }
  return null;
}

export function buildVhsProviderCardPayload({ binary, version, tapePath } = {}) {
  const identity = queryVhsProviderCard();
  return {
    providerId: identity.id,
    engine: 'vhs',
    version: version ?? null,
    binary: binary ?? null,
    tapeSource: tapePath ?? null,
    card: identity.card ?? null,
  };
}

export function spawnVhsTape(binary, tapePath, {
  spawnSyncFn = spawnSync,
  killFn = process.kill.bind(process),
  platform = process.platform,
  env = process.env,
} = {}) {
  const ownsProcessGroup = platform !== 'win32';
  const result = spawnSyncFn(binary, [tapePath], {
    encoding: 'utf8',
    timeout: 180_000,
    detached: ownsProcessGroup,
    env,
  });
  if (ownsProcessGroup && Number.isInteger(result?.pid) && result.pid > 0) {
    try { killFn(-result.pid, 'SIGTERM'); } catch { /* recorder group is already gone */ }
  }
  const version = readVhsVersion(binary, env, queryVhsProviderCard().card);
  return {
    ...buildVhsProviderCardPayload({ binary, version, tapePath }),
    result,
  };
}

export function installHint(env = process.env) {
  const card = findProviderCard(VHS_PROVIDER_ID);
  if (card?.fallback?.description) return card.fallback.description;
  if (process.platform === 'darwin') return 'brew install vhs   (or: brew install asciinema)';
  if (process.platform === 'linux') return 'See https://github.com/charmbracelet/vhs#installation   (or: pip install asciinema)';
  return 'See https://github.com/charmbracelet/vhs#installation';
}
