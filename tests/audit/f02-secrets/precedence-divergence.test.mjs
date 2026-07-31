/**
 * tests/audit/f02-secrets/precedence-divergence.red.mjs — F02 [R14] credential-precedence
 * parity between the startup env merge and the on-demand resolver.
 *
 * RED fixture (must FAIL against current code). loadConstructEnv (lib/env-config.mjs:161,
 * `{ ...env, ...fileEnv }`) ranks dotenv-file values ABOVE process.env so config files
 * defeat stale shell exports. resolveSecret (lib/providers/secret-resolver.mjs:220-221)
 * returns the directly-passed env value FIRST, above every file tier. When the same key
 * is present in BOTH process.env and the user config.env with different values, the two
 * paths resolve to different credentials — the divergent-precedence defect the audit
 * flags. The module docstring (secret-resolver.mjs:15-19) acknowledges this process.env
 * tier difference as "intentional and deferred"; this fixture pins the user-visible
 * consequence so the deferral is closed, not just annotated.
 *
 * The existing tests/credential-precedence-parity.test.mjs deliberately passes env:{},
 * which sidesteps the process.env conflict; this fixture supplies the conflicting
 * process.env value the parity gap actually depends on.
 *
 * Turns GREEN once both readers honor one precedence ladder for the process.env tier,
 * / plan Epic 5
 * (docs/notes/research/2026-06-construct-audit/90-credential-handling-remediation-plan.md
 * §Epic 5): same key resolves identically regardless of code path.
 *
 * resolveSecret reads os.homedir()/configDir() directly, so HOME and XDG_CONFIG_HOME are
 * pinned to the sandbox for the run and restored via t.after. No real host state is touched.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { loadConstructEnv, getUserEnvPath } from '../../../lib/env-config.mjs';
import { resolveSecret } from '../../../lib/providers/secret-resolver.mjs';

test('[R14] loadConstructEnv and resolveSecret agree when a key is in both process.env and config.env', (t) => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'cx-f02-prec-home-'));
  const project = fs.mkdtempSync(path.join(os.tmpdir(), 'cx-f02-prec-proj-'));
  const saved = { HOME: process.env.HOME, XDG_CONFIG_HOME: process.env.XDG_CONFIG_HOME };

  t.after(() => {
    if (saved.HOME === undefined) delete process.env.HOME;
    else process.env.HOME = saved.HOME;
    if (saved.XDG_CONFIG_HOME === undefined) delete process.env.XDG_CONFIG_HOME;
    else process.env.XDG_CONFIG_HOME = saved.XDG_CONFIG_HOME;
    fs.rmSync(home, { recursive: true, force: true });
    fs.rmSync(project, { recursive: true, force: true });
  });

  process.env.HOME = home;
  delete process.env.XDG_CONFIG_HOME;

  const configPath = getUserEnvPath(home);
  fs.mkdirSync(path.dirname(configPath), { recursive: true });
  fs.writeFileSync(configPath, 'DIVERGE_PROBE=from-config-env\n', 'utf8');

  // Same key, conflicting value, supplied on the env both readers receive. No project
  // .env is written, so the only contenders are the process.env tier and config.env.
  const injectedEnv = { DIVERGE_PROBE: 'from-process-env' };

  const merged = loadConstructEnv({ rootDir: project, homeDir: home, env: injectedEnv, warn: false });
  const resolved = resolveSecret('DIVERGE_PROBE', { env: injectedEnv, cwd: project, allowAmbient: true });

  assert.equal(
    merged.DIVERGE_PROBE,
    resolved,
    `precedence divergence: loadConstructEnv -> ${merged.DIVERGE_PROBE}, resolveSecret -> ${resolved}`,
  );
});
