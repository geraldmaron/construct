/**
 * lib/doctor/watchers/source-watch.mjs — source-refresh daemon job (bead
 * construct-wjap9.5).
 *
 * Ticks hourly. For every configured source target it runs refreshWatch
 * (lib/sources/watch.mjs), which probes upstream for changes (git ls-remote for
 * corpus targets, directory hash for directory targets) and, on a detected
 * change, appends to the staleness ledger (lib/sources/staleness-ledger.mjs) and
 * records a doctor audit action so `construct doctor` / `construct status`
 * surface source drift between Oracle ticks. A project with no registered
 * targets returns a silent pass (no noise).
 */

import { record } from '../audit.mjs';
import { refreshWatch } from '../../sources/watch.mjs';
import { loadProjectConfig } from '../../config/project-config.mjs';
import { resolveEffectiveSourceTargetsFromConfig } from '../../config/source-targets.mjs';

export const name = 'source-watch';
export const intervalMs = 60 * 60 * 1000;

function projectRoot() {
  return process.env.CONSTRUCT_PROJECT_ROOT || process.cwd();
}

export async function tick() {
  const actions = [];
  const escalations = [];
  const root = projectRoot();

  const loaded = loadProjectConfig(root, process.env);
  const sourceConfig = loaded.raw ?? loaded.config;
  const targets = resolveEffectiveSourceTargetsFromConfig(sourceConfig, process.env);
  if (!targets.length) {
    return { actions, escalations, notes: [{ configured: 0 }] };
  }

  let changed = 0;
  for (const target of targets) {
    let result;
    try {
      result = refreshWatch(target, { projectRoot: root });
    } catch (err) {
      record({
        kind: 'action',
        watcher: name,
        action: 'source-watch-error',
        target: target.id,
        summary: `refreshWatch failed for ${target.id}: ${err.message}`,
      });
      actions.push({ type: 'source-watch-error', target: target.id });
      continue;
    }
    if (result.changed) {
      changed++;
      record({
        kind: 'action',
        watcher: name,
        action: 'source-changed',
        target: target.id,
        summary: `source ${target.id} changed (${result.kind}) — previous ${result.previous ?? '<none>'} → ${result.current ?? '<none>'}`,
        context: { kind: result.kind, previous: result.previous, current: result.current },
      });
      actions.push({ type: 'source-changed', target: target.id });
    }
  }

  return { actions, escalations, notes: [{ configured: targets.length, changed }] };
}
