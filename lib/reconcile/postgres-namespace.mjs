/**
 * lib/reconcile/postgres-namespace.mjs — migrate a local Postgres compose that
 * predates per-home identifier derivation (ADR-0027 / construct-lb7b).
 *
 * Earlier versions wrote a singular `construct-postgres` container on the fixed
 * 54329 port. Two isolated HOMEs sharing that container clobber each other's
 * data and fight over the port. The derivation namespaces both per home; the
 * repair rewrites a legacy compose file to the namespaced form.
 *
 * apply() is strictly data-safe: it only rewrites the compose via
 * writeLocalPostgresCompose(home). It runs no docker command, removes no
 * container, and deletes no volume — the existing volume and any data inside it
 * are left intact. The returned summary instructs the operator to run
 * `construct down && construct up` to recreate the container against the
 * namespaced compose.
 *
 * Safety: `ask`. The rewrite changes the container/port a running stack binds
 * to, so it runs only on explicit consent. detect() reads only; apply() is
 * idempotent because the namespaced compose fails to match the legacy markers.
 */

import fs from 'node:fs';

import { homeDir } from '../paths.mjs';
import {
  LEGACY_PG_CONTAINER,
  LEGACY_PG_PORT,
  postgresContainerName,
  postgresPort,
} from '../home-namespace.mjs';
import { localPostgresComposePath, writeLocalPostgresCompose } from '../setup.mjs';

// The container marker anchors to end-of-line so the namespaced form
// `construct-postgres-<suffix>` does not match the singular legacy name as a
// prefix (which would defeat idempotency).

const LEGACY_CONTAINER_RE = new RegExp(`container_name:\\s*${LEGACY_PG_CONTAINER}\\s*$`, 'm');
const LEGACY_PORT_RE = new RegExp(`:${LEGACY_PG_PORT}:`);

function legacyMarkers(content, home) {
  const derivedContainer = postgresContainerName(process.env, home);
  const derivedPort = postgresPort(process.env, home);

  // The legacy singular container only counts when the derivation would name it
  // differently; an explicit CONSTRUCT_PG_CONTAINER override pinned to the
  // singular name is the intended state, not drift.

  const hasLegacyContainer = LEGACY_CONTAINER_RE.test(content) && derivedContainer !== LEGACY_PG_CONTAINER;
  const hasLegacyPort = LEGACY_PORT_RE.test(content) && derivedPort !== LEGACY_PG_PORT;
  return { hasLegacyContainer, hasLegacyPort, derivedContainer, derivedPort };
}

async function detect() {
  const home = homeDir();
  const composePath = localPostgresComposePath(home);
  if (!fs.existsSync(composePath)) {
    return { needsRepair: false, summary: 'No local Postgres compose file present.' };
  }
  let content = '';
  try {
    content = fs.readFileSync(composePath, 'utf8');
  } catch (err) {
    return { needsRepair: false, summary: `Could not read compose file: ${err.message}` };
  }
  const markers = legacyMarkers(content, home);
  if (!markers.hasLegacyContainer && !markers.hasLegacyPort) {
    return { needsRepair: false, summary: 'Local Postgres compose already uses per-home identifiers.' };
  }
  const reasons = [];
  if (markers.hasLegacyContainer) reasons.push(`container ${LEGACY_PG_CONTAINER} → ${markers.derivedContainer}`);
  if (markers.hasLegacyPort) reasons.push(`port ${LEGACY_PG_PORT} → ${markers.derivedPort}`);
  return {
    needsRepair: true,
    summary: `Local Postgres compose predates per-home derivation (${reasons.join(', ')}).`,
    details: { composePath, ...markers },
  };
}

async function apply() {
  const home = homeDir();
  const composePath = localPostgresComposePath(home);
  if (!fs.existsSync(composePath)) return { summary: 'No compose file to migrate.' };

  // Rewrite the compose to the per-home form only. No docker invocation, no
  // container removal, no volume deletion — the operator recreates the
  // container themselves so data handling stays under their control.

  writeLocalPostgresCompose(home);
  const container = postgresContainerName(process.env, home);
  const port = postgresPort(process.env, home);
  return {
    summary: `Rewrote local Postgres compose to per-home identifiers (container ${container}, port ${port}). Run \`construct down && construct up\` to recreate the container; existing data and volume are untouched.`,
  };
}

export default {
  id: 'postgres-namespace',
  description: 'Rewrite a legacy local Postgres compose to per-home container/port identifiers (data-safe).',
  safety: 'ask',
  detect,
  apply,
};
