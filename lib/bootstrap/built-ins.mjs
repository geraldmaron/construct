/**
 * lib/bootstrap/built-ins.mjs — first-party resource definitions.
 *
 * Registers the resources Construct ships with: Node ≥ 18, git, Docker, the
 * local ONNX embedding model, and Postgres+pgvector. The probes are
 * deliberately lightweight — they answer "is this thing present and
 * approximately healthy?" — and never block. The install paths handle the
 * messier details (Docker container creation, model download).
 *
 * Calling `registerBuiltInResources()` is idempotent; re-registration is a
 * no-op so this file can be imported multiple times.
 */

import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import os from 'node:os';
import { registerResource, getResource } from './resources.mjs';

function probeCommandVersion(cmd, args = ['--version']) {
  const r = spawnSync(cmd, args, { encoding: 'utf8', timeout: 3000 });
  if (r.status !== 0) return { present: false };
  const text = (r.stdout || r.stderr || '').trim().split('\n')[0];
  return { present: true, version: text || cmd };
}

function probeNodeMin18() {
  const r = spawnSync(process.execPath, ['--version'], { encoding: 'utf8', timeout: 1000 });
  if (r.status !== 0) return { present: false };
  const v = (r.stdout || '').trim().replace(/^v/, '');
  const major = Number(v.split('.')[0]);
  return {
    present: major >= 18,
    version: v,
    healthy: major >= 18,
    detail: major < 18 ? `Node ${v} is too old; need ≥ 18` : null,
  };
}

async function probePostgresContainer() {
  const docker = spawnSync('docker', ['ps', '--format', '{{.Names}}\t{{.Image}}'], {
    encoding: 'utf8', timeout: 5000,
  });
  if (docker.status !== 0) return { present: false, detail: 'docker not running' };
  const lines = docker.stdout.trim().split('\n').filter(Boolean);
  const constructPg = lines.find((l) => /construct.*postgres|construct-pg|pgvector/.test(l));
  if (!constructPg) return { present: false, detail: 'construct-postgres container not running' };
  const [name] = constructPg.split('\t');
  return {
    present: true,
    location: `docker:${name}`,
    healthy: true,
    detail: 'managed Postgres+pgvector container',
  };
}

async function probeEmbeddingModel() {
  const cachePath = join(
    os.homedir(),
    '.construct', 'cache', 'embeddings',
    'Xenova', 'all-MiniLM-L6-v2', 'onnx', 'model_quantized.onnx'
  );
  if (existsSync(cachePath)) {
    return {
      present: true,
      location: cachePath,
      healthy: true,
      version: 'Xenova/all-MiniLM-L6-v2',
    };
  }
  return { present: false, detail: 'will download on first embedding' };
}

let registered = false;

export function registerBuiltInResources() {
  if (registered) return;
  registered = true;

  if (!getResource('node-runtime')) {
    registerResource({
      id: 'node-runtime',
      displayName: 'Node.js 18+',
      required: true,
      consentKey: 'BOOTSTRAP_NODE',
      detect: probeNodeMin18,
      fallback: () => '(none — Node is required to run Construct)',
    });
  }

  if (!getResource('git')) {
    registerResource({
      id: 'git',
      displayName: 'git',
      required: false,
      consentKey: 'BOOTSTRAP_GIT',
      detect: () => probeCommandVersion('git'),
      fallback: () => 'Construct features that read git history degrade to "no history"',
    });
  }

  if (!getResource('docker')) {
    registerResource({
      id: 'docker',
      displayName: 'Docker',
      required: false,
      consentKey: 'BOOTSTRAP_DOCKER',
      detect: () => probeCommandVersion('docker'),
      fallback: () => 'Construct cannot manage local Postgres or run the binary container',
    });
  }

  if (!getResource('embedding-model-local')) {
    registerResource({
      id: 'embedding-model-local',
      displayName: 'Local ONNX embedding model (Xenova/all-MiniLM-L6-v2)',
      required: false,
      consentKey: 'BOOTSTRAP_EMBEDDING_MODEL',
      downloadSize: 50 * 1024 * 1024,
      detect: probeEmbeddingModel,
      fallback: () => 'Construct embeddings degrade to hashing-bow-v1 (lower retrieval quality)',
    });
  }

  if (!getResource('postgres-pgvector')) {
    registerResource({
      id: 'postgres-pgvector',
      displayName: 'Postgres with pgvector',
      required: false,
      consentKey: 'BOOTSTRAP_POSTGRES',
      downloadSize: 250 * 1024 * 1024,
      detect: probePostgresContainer,
      fallback: () => 'Construct retrieval falls back to local JSON vector index (slower, no SQL search)',
    });
  }
}
