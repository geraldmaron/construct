/**
 * lib/maintenance/docker-reclaim.mjs — reclaim abandoned per-home Postgres
 * containers and data volumes that outlived the HOME that created them.
 *
 * Construct derives a Postgres container/volume namespace from a sha256 slice
 * of the resolved home directory (lib/home-namespace.mjs) so isolated HOMEs —
 * test sandboxes, ephemeral /tmp footprint runs, deleted accounts — never
 * collide on one machine. Each container carries a `restart: unless-stopped`
 * policy. When the owning HOME or its compose project directory is deleted,
 * Docker keeps the container alive with nothing left to reap it: an orphan that
 * pins memory and leaks disk through its named volume.
 *
 * The reclaim runs from the upgrade flows (lib/update.mjs, lib/upgrade.mjs)
 * once per upgrade and from `construct cleanup`, never from `construct sync`,
 * which fires constantly and must not mutate machine-global Docker state.
 *
 * An orphan is removed only when every signal agrees it is abandoned:
 *   - the name carries a Construct per-home suffix (construct-postgres-<8 hex>),
 *     so hand-named and third-party containers stay untouched;
 *   - the suffix differs from the current HOME's suffix, sparing the live install;
 *   - the name differs from an operator-pinned CONSTRUCT_PG_CONTAINER;
 *   - a container's compose working_dir label points at a path that is gone;
 *   - a volume has no surviving container for its suffix.
 * The legacy singular `construct-postgres` (no suffix) is out of scope.
 */

import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';

import { homeNamespaceSuffix } from '../home-namespace.mjs';

const CONTAINER_RE = /^construct-postgres-([0-9a-f]{8})$/;
const VOLUME_RE = /construct-postgres-([0-9a-f]{8})/;
const CONTAINER_FORMAT = '{{.Names}}\t{{.Label "com.docker.compose.project.working_dir"}}';
const DEFAULT_MAX = 25;

export function defaultRunDocker(args) {
  const r = spawnSync('docker', args, { encoding: 'utf8' });
  return {
    status: r.status ?? 1,
    stdout: r.stdout || '',
    stderr: r.stderr || '',
    error: r.error || null,
  };
}

// `docker ps -a` lists every container with its compose working_dir label on a
// tab. Anything that does not match the per-home naming scheme is dropped, so
// the parser only surfaces Construct-managed candidates.

export function parseContainers(stdout) {
  const out = [];
  for (const raw of String(stdout || '').split('\n')) {
    const line = raw.replace(/\s+$/, '');
    if (!line) continue;
    const tab = line.indexOf('\t');
    const name = (tab === -1 ? line : line.slice(0, tab)).trim();
    const workingDir = tab === -1 ? '' : line.slice(tab + 1).trim();
    const match = CONTAINER_RE.exec(name);
    if (!match) continue;
    out.push({ name, suffix: match[1], workingDir });
  }
  return out;
}

export function parseVolumes(stdout) {
  const out = [];
  for (const raw of String(stdout || '').split('\n')) {
    const name = raw.trim();
    if (!name) continue;
    const match = VOLUME_RE.exec(name);
    if (!match) continue;
    out.push({ name, suffix: match[1] });
  }
  return out;
}

// A container is an orphan when it belongs to a foreign home namespace, is not
// the operator-pinned container, and its compose project directory is gone. A
// volume is an orphan when its suffix is foreign and no surviving container —
// including containers spared this pass — still claims it.

export function selectOrphans({
  containers,
  volumes,
  currentSuffix,
  pinnedName = null,
  pathExists = (p) => fs.existsSync(p),
}) {
  const orphanContainers = containers.filter((c) =>
    c.suffix !== currentSuffix &&
    c.name !== pinnedName &&
    c.workingDir &&
    !pathExists(c.workingDir));

  const orphanSuffixes = new Set(orphanContainers.map((c) => c.suffix));
  const liveSuffixes = new Set(
    containers.filter((c) => !orphanSuffixes.has(c.suffix)).map((c) => c.suffix),
  );

  const orphanVolumes = volumes.filter((v) =>
    v.suffix &&
    v.suffix !== currentSuffix &&
    !liveSuffixes.has(v.suffix));

  return { orphanContainers, orphanVolumes };
}

export function reclaimOrphanedDockerResources({
  runDocker = defaultRunDocker,
  homeDir = os.homedir(),
  env = process.env,
  dryRun = false,
  max = DEFAULT_MAX,
  pathExists = (p) => fs.existsSync(p),
} = {}) {
  const summary = {
    available: false,
    reason: null,
    scanned: { containers: 0, volumes: 0 },
    removedContainers: [],
    removedVolumes: [],
    skipped: [],
    errors: [],
    dryRun,
  };

  // A non-zero `docker ps` means the daemon is down or Docker is absent; the
  // machine then holds no reclaimable state and the pass is a clean no-op.

  const psResult = runDocker(['ps', '-a', '--format', CONTAINER_FORMAT]);
  if (!psResult || psResult.status !== 0) {
    summary.reason = 'docker-unavailable';
    return summary;
  }
  summary.available = true;

  const containers = parseContainers(psResult.stdout);
  summary.scanned.containers = containers.length;

  const volResult = runDocker(['volume', 'ls', '--format', '{{.Name}}']);
  const volumes = volResult && volResult.status === 0 ? parseVolumes(volResult.stdout) : [];
  summary.scanned.volumes = volumes.length;

  const currentSuffix = homeNamespaceSuffix(homeDir);
  const pinnedName = (env.CONSTRUCT_PG_CONTAINER || '').trim() || null;

  const { orphanContainers, orphanVolumes } = selectOrphans({
    containers,
    volumes,
    currentSuffix,
    pinnedName,
    pathExists,
  });

  let budget = Number.isFinite(max) && max > 0 ? max : DEFAULT_MAX;

  for (const c of orphanContainers) {
    if (budget <= 0) {
      summary.skipped.push({ name: c.name, reason: 'reclaim-budget-exhausted' });
      continue;
    }
    budget -= 1;
    if (dryRun) {
      summary.removedContainers.push(c.name);
      continue;
    }
    const r = runDocker(['rm', '-f', '-v', c.name]);
    if (r && r.status === 0) summary.removedContainers.push(c.name);
    else summary.errors.push({ name: c.name, error: (r?.stderr || '').trim() || `docker rm exited ${r?.status}` });
  }

  // A named data volume only drops once nothing references it. `docker volume
  // rm` exits non-zero for an in-use or already-gone volume, so a failure here
  // is recorded as skipped rather than a hard error.

  for (const v of orphanVolumes) {
    if (budget <= 0) {
      summary.skipped.push({ name: v.name, reason: 'reclaim-budget-exhausted' });
      continue;
    }
    budget -= 1;
    if (dryRun) {
      summary.removedVolumes.push(v.name);
      continue;
    }
    const r = runDocker(['volume', 'rm', v.name]);
    if (r && r.status === 0) summary.removedVolumes.push(v.name);
    else summary.skipped.push({ name: v.name, reason: 'in-use-or-missing' });
  }

  return summary;
}

export function formatReclaim(summary) {
  if (!summary || !summary.available) return null;
  const containers = summary.removedContainers.length;
  const volumes = summary.removedVolumes.length;
  if (!containers && !volumes) return null;
  const parts = [];
  if (containers) parts.push(`${containers} orphaned Postgres container${containers === 1 ? '' : 's'}`);
  if (volumes) parts.push(`${volumes} abandoned data volume${volumes === 1 ? '' : 's'}`);
  const verb = summary.dryRun ? 'Would reclaim' : 'Reclaimed';
  return `${verb} ${parts.join(' and ')} from deleted home namespaces.`;
}
