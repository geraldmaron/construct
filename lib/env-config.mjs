/**
 * lib/env-config.mjs — <one-line purpose>
 *
 * <2–6 line summary: what it does, who calls it, key side effects.>
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

export function parseEnvFile(filePath) {
  if (!filePath || !fs.existsSync(filePath)) return {};
  const env = {};
  for (const rawLine of fs.readFileSync(filePath, 'utf8').split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    const match = line.match(/^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/);
    if (!match) continue;
    const [, key, rawValue] = match;
    env[key] = rawValue.replace(/^["']|["']$/g, '');
  }
  return env;
}

export function getUserConfigDir(homeDir = os.homedir()) {
  return path.join(homeDir, '.construct');
}

export function getUserEnvPath(homeDir = os.homedir()) {
  return path.join(getUserConfigDir(homeDir), 'config.env');
}

export function ensureUserConfigDir(homeDir = os.homedir()) {
  const dir = getUserConfigDir(homeDir);
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

export function writeEnvValues(filePath, values = {}) {
  const existing = parseEnvFile(filePath);
  const merged = { ...existing, ...values };
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const content = Object.entries(merged)
    .filter(([, value]) => value !== undefined && value !== null && value !== '')
    .map(([key, value]) => `${key}=${value}`)
    .join('\n');
  fs.writeFileSync(filePath, `${content}\n`, 'utf8');
}

export function loadConstructEnv({ rootDir, homeDir = os.homedir(), env = process.env } = {}) {
  const rootEnv = rootDir ? parseEnvFile(path.join(rootDir, '.env')) : {};
  const userEnv = parseEnvFile(getUserEnvPath(homeDir));
  return { ...rootEnv, ...userEnv, ...env };
}
