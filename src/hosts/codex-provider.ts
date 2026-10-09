/** Shared non-secret Codex provider selection for explicit native validation. */
import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
export interface CodexProvider { readonly id: string; readonly [key: string]: string | boolean; }

/** The five non-secret keys of a codex model provider that the runner carries over; nothing else in the person's config is read. */
export const CODEX_PROVIDER_KEYS = ['name', 'base_url', 'wire_api', 'requires_openai_auth', 'supports_websockets'];

/**
 * The person's selected codex provider from their config.toml text: the
 * top-level model_provider and those five keys of its table. --ignore-user-config
 * drops the provider, and some models need it back.
 */
export function codexProvider(text: string): CodexProvider | null {
  let table: string | null = null;
  let id: string | null = null;
  const tables = new Map<string, Record<string, string | boolean>>();
  const scalar = (raw: string): string | boolean | undefined => {
    const v = raw.trim();
    if (v === 'true' || v === 'false') return v === 'true';
    const m = v.match(/^"((?:[^"\\]|\\.)*)"\s*(?:#.*)?$/) ?? v.match(/^'([^']*)'\s*(?:#.*)?$/);
    if (!m) return undefined;
    return v.startsWith('"') ? JSON.parse(`"${m[1]}"`) : m[1];
  };
  for (const line of String(text).split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const header = trimmed.match(/^\[([^\]]+)\]\s*(?:#.*)?$/);
    if (header) {
      table = header[1]!.trim();
      continue;
    }
    const kv = trimmed.match(/^([A-Za-z0-9_.-]+)\s*=\s*(.+)$/);
    if (!kv) continue;
    const value = scalar(kv[2]!);
    if (value === undefined) continue;
    if (table === null && kv[1] === 'model_provider' && typeof value === 'string') id = value;
    const prefix = table?.match(/^model_providers\.(?:"([^"]+)"|([A-Za-z0-9_-]+))$/);
    if (prefix && CODEX_PROVIDER_KEYS.includes(kv[1]!)) {
      const name = prefix[1] ?? prefix[2]!;
      tables.set(name, { ...(tables.get(name) ?? {}), [kv[1]!]: value });
    }
  }
  if (!id) return null;
  return { id, ...(tables.get(id) ?? {}) };
}

/** The person's selected codex provider, read from $CODEX_HOME/config.toml or ~/.codex/config.toml; null when there is none. */
export function codexProviderFromConfig(env: NodeJS.ProcessEnv = process.env): CodexProvider | null {
  const home = env.CODEX_HOME || join(env.HOME || homedir(), '.codex');
  try {
    return codexProvider(readFileSync(join(home, 'config.toml'), 'utf8'));
  } catch {
    return null;
  }
}

/** The `-c` overrides that put a provider back under --ignore-user-config: model_provider and its non-secret keys. */
export function codexProviderArgs(provider: CodexProvider | null): string[] {
  if (!provider) return [];
  return ['-c', `model_provider=${JSON.stringify(provider.id)}`, ...CODEX_PROVIDER_KEYS.filter((k) => provider[k] !== undefined).flatMap((k) => ['-c', `model_providers.${provider.id}.${k}=${JSON.stringify(provider[k])}`])];
}
