/**
 * cli/maintenance.ts — the install rather than the work: whether this one is
 * healthy, and whether its store has ever been copied.
 *
 * Nothing here reads a run or dispatches anything. Predecessor archaeology
 * (`cleanup`) is gone: alpha clean break, not a migration path.
 */

import { existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { resolvePaths } from '../kernel/paths.ts';
import { openStore, storePath, storeWriteProblem, StoreUnavailableError } from '../kernel/store/open.ts';
import { resolveStoreLocation } from './local-state.ts';
import type { StoreLocation } from './local-state.ts';
import {
  backupDisclosure,
  backupLedgerPath,
  BackupRefusedError,
  checksumSidecar,
  takeBackup,
  verifyBackup,
} from '../kernel/store/backup.ts';
import {
  DEFAULT_STALE_DRAFT_THRESHOLD_MS,
  staleUnreviewedDrafts,
} from '../kernel/run/promotion.ts';
import { skillPackSkew } from '../kernel/skills/projection.ts';
import { escapeForTerminal } from '../kernel/render/terminal.ts';
import { tuningStamp } from '../hosts/tuning.ts';
import { censusLines, surveyResources } from '../hosts/census.ts';
import { detectAmbientHost } from '../hosts/ambient.ts';
import { allIntegrationAdapters } from '../hosts/integrations/registry.ts';
import { now, packageVersion } from './runtime.ts';
import { parseFlags } from './flags.ts';
import { readSkillFolders } from './skills.ts';

const MIN_NODE = { major: 22, minor: 18 };

function nodeFloorOk(version: string): boolean {
  const [major = 0, minor = 0] = version.split('.').map(Number);
  if (major !== MIN_NODE.major) return major > MIN_NODE.major;
  return minor >= MIN_NODE.minor;
}

/** A millisecond age as one coarse unit — days once there is at least one, else hours, else minutes. */
function humanizeAge(ms: number): string {
  const days = Math.floor(ms / (24 * 60 * 60 * 1000));
  if (days >= 1) return `${String(days)}d`;
  const hours = Math.floor(ms / (60 * 60 * 1000));
  if (hours >= 1) return `${String(hours)}h`;
  return `${String(Math.max(1, Math.floor(ms / (60 * 1000))))}m`;
}

export async function doctor(cwd: string = process.cwd(), env: NodeJS.ProcessEnv = process.env): Promise<number> {
  const checks: Array<{ name: string; ok: boolean; detail: string }> = [];

  checks.push({
    name: 'node',
    ok: nodeFloorOk(process.versions.node),
    detail: `v${process.versions.node} (floor: ${MIN_NODE.major}.${MIN_NODE.minor})`,
  });

  const paths = resolvePaths();
  checks.push({ name: 'paths', ok: true, detail: `state: ${paths.stateDir}` });

  // Stale-loudly: the stamp carries the dates the tuning evidence was
  // recorded, so an aging matrix reads as aged instead of current.
  checks.push({ name: 'matrix', ok: true, detail: tuningStamp() });

  // Resolving a path proves nothing about being able to use it. Before this
  // check, doctor reported "healthy" against a data dir it could not write,
  // and the user found out from a stack trace on their next command.
  //
  // Where the store actually lives depends on `state`: a ratified project
  // settings file may root it inside the repository instead of under home.
  // Resolving that never creates the home store as a side effect of being
  // asked (see local-state.ts) — the same non-mutating discipline this check
  // already keeps for the store file itself. A refused activation (the store
  // path not both ignored and untracked) is reported here as the store
  // check's own failure rather than a crash, so doctor still finishes and
  // says exactly why, the same as every other check that can fail.
  let location: StoreLocation;
  let localStateRefusal: string | null = null;
  try {
    location = resolveStoreLocation(cwd, env);
  } catch (error) {
    if (!(error instanceof StoreUnavailableError)) throw error;
    location = { path: error.path, local: false, repoRoot: null };
    localStateRefusal = error.reason;
  }
  const store = location.path;
  const problem = localStateRefusal ?? storeWriteProblem(store);
  checks.push({
    name: 'store',
    ok: problem === null,
    detail: problem === null ? store : `${store} — ${problem}`,
  });
  if (location.local) {
    checks.push({
      name: 'local-state',
      ok: true,
      detail: `state: local is in effect — the store is rooted at ${store} inside ${location.repoRoot ?? '(unknown)'}`,
    });
  } else if (localStateRefusal !== null) {
    checks.push({
      name: 'local-state',
      ok: false,
      detail: `state: local was requested but refused — ${localStateRefusal}`,
    });
  }

  // Whether a copy of the store exists anywhere. Reported, never gated: an
  // install with no copy is not broken, it is uninsured, and the append-only
  // triggers that protect its rows protect nothing against the file being
  // removed. Silence about that gap is what turns one deletion into a
  // discovery, so doctor says which of the two states this store is in.
  checks.push({
    name: 'backup',
    ok: true,
    detail: backupDisclosure(backupLedgerPath(paths), now()),
  });

  // Hosts are reported, never gated: a missing host is information, because
  // serve-only use is legitimate. Before this, a user without a host met the
  // absence as mid-run errors instead of one line here.
  //
  // The same census a hostless `construct work` selects from, so what doctor
  // shows and what dispatch chooses cannot be two different readings of one
  // machine. The cost column is the part worth reading twice: it says what a
  // run there would spend, and says so plainly when nobody measured it.
  for (const line of censusLines(surveyResources())) {
    checks.push({ name: 'host', ok: true, detail: line });
  }

  // Whether this process is itself running inside a host — the one fact the
  // census above cannot show, since it reports what is installed on the
  // machine, not what invoked Construct right now. Reported, never gated,
  // like every other host line: the agent-session resident this check exists
  // for needs to see it stated plainly, not infer it from a dispatch that
  // went to the wrong place.
  const ambient = detectAmbientHost(env);
  checks.push({
    name: 'ambient',
    ok: true,
    detail:
      ambient === null
        ? 'not running inside a detected host session; dispatch spawns a host CLI when one is spawnable'
        : `running inside ${ambient.host} (detected via ${ambient.marker}); in-session dispatch: this session via construct serve (will not spawn ${ambient.host})`,
  });

  // HostIntegrationAdapter matrix: maturity and project MCP status. Reported,
  // never gated — unsupported is honest, not a failed install. Broken measured
  // entries are named so a false "Ready" cannot hide a bad wire.
  for (const adapter of allIntegrationAdapters()) {
    const caps = adapter.capabilities();
    const view = await adapter.inspect(cwd);
    const installable = caps.maturity !== 'unsupported' && caps.maturity !== 'unknown';
    const ok = !installable || view.status !== 'broken';
    const pathBit = view.path ? ` @ ${view.path}` : '';
    const detailBit = view.detail ? ` — ${view.detail}` : '';
    checks.push({
      name: 'integration',
      ok,
      detail: `${adapter.id}: maturity=${caps.maturity} status=${view.status}${pathBit}${detailBit}`,
    });
  }

  // A generated skill pack left behind by an older or newer Construct: not
  // unhealthy either, only worth naming — the fix is `construct skills`, not
  // a doctor exit code.
  const skillsOut = join(cwd, '.claude', 'skills');
  if (existsSync(skillsOut)) {
    const installed = packageVersion();
    for (const version of skillPackSkew(readSkillFolders(skillsOut), installed)) {
      checks.push({
        name: 'skills',
        ok: true,
        detail: `skill pack was generated by construct ${version}, installed construct is ${installed} — regenerate with construct skills pack`,
      });
    }
  }

  // A settled deliverable stuck at draft is not itself wrong — see
  // completion/promotion.ts on why "nobody challenged it" is a normal resting
  // state — but nothing else here ever notices when one has simply sat that
  // way a long time, and there is no other surface that says so either.
  // Reported like skills: informational, never gating, silent
  // when there is nothing to say. Gated on the store already existing and
  // passing the write-access probe above — this check has nothing to add
  // over the store check when the store is missing or unwritable, and it
  // must never be the reason doctor creates a database merely because it was
  // asked a question (see storeWriteProblem).
  if (problem === null && existsSync(store)) {
    try {
      const opened = openStore(store);
      try {
        const stale = staleUnreviewedDrafts(opened, {
          now: now(),
          thresholdMs: DEFAULT_STALE_DRAFT_THRESHOLD_MS,
        });
        if (stale.length > 0) {
          const oldest = stale[0];
          const thresholdDays = DEFAULT_STALE_DRAFT_THRESHOLD_MS / (24 * 60 * 60 * 1000);
          checks.push({
            name: 'stale-draft',
            ok: true,
            detail:
              `${String(stale.length)} settled deliverable(s) still draft with no recorded verdict, ` +
              `past the ${String(thresholdDays)}-day threshold — oldest: run ${oldest.run} task ${oldest.task}, ` +
              `settled ${humanizeAge(oldest.ageMs)} ago (${oldest.settledAt})`,
          });
        }
      } finally {
        opened.close();
      }
    } catch {
      // The store exists but could not be opened or queried — a schema this
      // build does not understand, a file mid-write. Not this check's
      // problem to diagnose, so it reports nothing rather than guessing.
    }
  }

  let failed = 0;
  for (const check of checks) {
    if (!check.ok) failed += 1;
    process.stdout.write(`${check.ok ? 'ok  ' : 'FAIL'} ${check.name}  ${escapeForTerminal(check.detail)}\n`);
  }
  process.stdout.write(failed === 0 ? 'doctor: healthy\n' : `doctor: ${failed} check(s) failed\n`);
  // "healthy" answers whether the install is sound, not what to do with it —
  // an install with nothing recorded yet still ends here with no path from
  // "it works" to a first outcome. Only printed on the healthy path: a failed
  // check is the next action, and naming both would bury the one that matters.
  if (failed === 0) {
    if (ambient !== null) {
      process.stdout.write(
        `Ready. You are in ${ambient.host}. Talk here. Ordinary language is enough. ` +
          'This session drives Construct over MCP (project_status / start_run / next_work). ' +
          'Construct will not spawn a second CLI.\n',
      );
    } else {
      process.stdout.write(
        'Ready. From a supported host run construct init, then work in-session over MCP.\n',
      );
    }
  }
  return failed === 0 ? 0 : 1;
}

const BACKUP_USAGE =
  'usage: construct backup <dir>            copy the store into <dir>, outside the store\'s own directory\n' +
  '       construct backup --verify <file>  recompute a copy\'s checksum against the one recorded with it\n';

/**
 * Take a copy of the store, or check one already taken.
 *
 * Manual on purpose. Nothing here schedules anything, sends anything anywhere,
 * or encrypts anything: those are decisions with their own trade-offs and none
 * of them has been made. What exists is the primitive an operator can run, and
 * `doctor` saying plainly when nobody has run it.
 *
 * The verify half is not a formality. A copy nobody can check is a copy nobody
 * should trust, so the checksum is written when the copy is taken and this is
 * how it gets held against the bytes on disk — reported as it comes out,
 * including "cannot be verified", which is its own answer and not a pass.
 */
export function backup(argv: string[]): number {
  const { flags, rest } = parseFlags(argv);
  const paths = resolvePaths();

  if (flags.verify !== undefined) {
    // `--verify <file>` and `--verify=<file>` both reach here; the first
    // leaves the path in `rest`.
    const target = flags.verify === 'true' ? rest[0] : flags.verify;
    if (target === undefined || target === '') {
      process.stderr.write(BACKUP_USAGE);
      return 2;
    }
    const file = resolve(target);
    const verdict = verifyBackup(file);
    if (verdict.matched) {
      process.stdout.write(`backup: ${file} ${verdict.detail}\n  sha256 ${String(verdict.actual)}\n`);
      return 0;
    }
    process.stderr.write(
      `backup: ${file} ${verdict.detail}\n` +
        (verdict.recorded === null ? '' : `  recorded  ${verdict.recorded}\n`) +
        (verdict.actual === null ? '' : `  on disk   ${verdict.actual}\n`) +
        '  This copy is not the bytes that were taken. Opening a copy with anything that writes to it\n' +
        '  — including construct itself — counts as a change; short of that, do not restore from it.\n',
    );
    return 1;
  }

  const destination = rest[0];
  if (destination === undefined || destination === '') {
    process.stderr.write(BACKUP_USAGE);
    return 2;
  }

  const store = storePath(paths);
  try {
    const record = takeBackup({
      storeFile: store,
      destDir: resolve(destination),
      ledgerFile: backupLedgerPath(paths),
      at: now(),
    });
    process.stdout.write(
      `backup: copied ${store} to ${record.file} (${String(record.bytes)} bytes)\n` +
        `  sha256 ${record.sha256}, recorded in ${checksumSidecar(record.file)}\n` +
        `  Check it any time with: construct backup --verify ${record.file}\n`,
    );
    return 0;
  } catch (error) {
    if (!(error instanceof BackupRefusedError)) throw error;
    process.stderr.write(`backup: ${error.message}\n`);
    return 2;
  }
}
