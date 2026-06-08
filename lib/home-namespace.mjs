/**
 * lib/home-namespace.mjs — per-home derivation of local-service identifiers so
 * isolated HOMEs (test sandboxes, multiple users on one machine, parallel CI)
 * never collide on the same Postgres container/port or memory port (construct-lb7b).
 *
 * The canonical `construct-postgres`:54329 container and the memory :8765 port are
 * singular per machine; two HOMEs sharing them clobber each other's data and
 * fight over the port. Each identifier here is derived from a stable hash of the
 * resolved home directory, so every HOME gets its own deterministic namespace.
 *
 * Explicit env overrides win (CONSTRUCT_PG_PORT, MEMORY_PORT, CONSTRUCT_PG_CONTAINER),
 * so a pinned setup keeps its values. The LaunchAgent label stays singular — it is
 * a machine-level guard, not a per-home resource.
 */

import { createHash } from 'node:crypto';
import { homeDir } from './paths.mjs';

const PG_PORT_BASE = 54329;
const MEMORY_PORT_BASE = 8765;
const PORT_SPAN = 2000;

function digest(home) {
  return createHash('sha256').update(home).digest('hex');
}

export function homeNamespaceSuffix(home = homeDir()) {
  return digest(home).slice(0, 8);
}

// Distinct hash slices for the two ports so they do not move in lockstep across
// homes (which would re-create collisions one base apart).

function offsetFromSlice(home, start) {
  return parseInt(digest(home).slice(start, start + 8), 16) % PORT_SPAN;
}

export function postgresPort(env = process.env, home = homeDir()) {
  const override = env.CONSTRUCT_PG_PORT;
  if (override && /^\d+$/.test(override)) return Number(override);
  return PG_PORT_BASE + offsetFromSlice(home, 0);
}

export function memoryPort(env = process.env, home = homeDir()) {
  const override = env.MEMORY_PORT;
  if (override && /^\d+$/.test(override)) return Number(override);
  return MEMORY_PORT_BASE + offsetFromSlice(home, 8);
}

export function postgresContainerName(env = process.env, home = homeDir()) {
  return env.CONSTRUCT_PG_CONTAINER || `construct-postgres-${homeNamespaceSuffix(home)}`;
}

// The legacy singular identifiers prior versions wrote. The postgres-namespace
// reconciliation (lib/reconcile/) uses these to detect state that predates the
// per-home derivation.

export const LEGACY_PG_CONTAINER = 'construct-postgres';
export const LEGACY_PG_PORT = 54329;
export const LEGACY_MEMORY_PORT = 8765;
