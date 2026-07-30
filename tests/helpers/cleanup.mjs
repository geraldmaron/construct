/**
 * tests/helpers/cleanup.mjs — Best-effort tmpdir teardown that never fails a test.
 *
 * Functional tests spawn the real `construct` CLI against a tmpdir sandbox
 * (HOME + state root redirected under os.tmpdir()), then remove the sandbox in
 * teardown. Under full-suite CI load, `fs.rmSync(dir, { recursive: true })`
 * intermittently throws ENOTEMPTY: the spawned child (or slow OS-level handle
 * release after it exits) can still be materializing a file mid-walk, and
 * rmSync's `maxRetries` only retries the one rmdir that failed — it never
 * re-walks the tree, so a file that appears after the walk passed its directory
 * makes the retry budget useless.
 *
 * By teardown time every assertion has already run, so a leftover directory in
 * the OS tmpdir on an ephemeral CI runner is harmless — the OS or the runner
 * recycler reclaims it — while failing an otherwise-green test on cleanup is
 * pure noise. This helper therefore retries removal with a generous budget and,
 * if the directory still resists, emits one warning and moves on. It is ONLY
 * for os.tmpdir()-rooted sandboxes: real host state is protected by the
 * sterile-host-env fingerprint guard, which remains the leak detector that
 * matters and is unaffected by this policy.
 */
import { rmSync, realpathSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

// Refuse silently-swallowed removal outside the OS tmpdir or the repo's own
// .tmp scratch root: a caller passing a repo or HOME path by mistake should
// fail loudly, not lose data quietly. Roots are compared both as-given and
// realpath'd because macOS's tmpdir is a symlink (/var/folders →
// /private/var/folders) and tests pass either form. <repo>/.tmp is a root
// because distribution/sync-contract sandboxes live there and hit the same
// spawned-child ENOTEMPTY teardown race.

const REPO_TMP = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..", ".tmp");

function tmpRoots() {
  const roots = new Set([resolve(tmpdir()), REPO_TMP]);
  try {
    roots.add(realpathSync(tmpdir()));
  } catch {}
  try {
    roots.add(realpathSync(REPO_TMP));
  } catch {}
  return [...roots];
}

function assertUnderTmpdir(dir) {
  const target = resolve(dir);
  const roots = tmpRoots();
  if (roots.includes(target)) {
    throw new Error(`rmTmpDir refuses to remove the tmpdir root itself: ${target}`);
  }
  if (!roots.some((root) => target.startsWith(root + sep))) {
    throw new Error(`rmTmpDir only removes paths under os.tmpdir() or <repo>/.tmp (${roots.join(", ")}); got: ${target}`);
  }
}

export function rmTmpDir(dir) {
  if (!dir) return;
  assertUnderTmpdir(dir);
  try {
    rmSync(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 250 });
  } catch (firstErr) {
    try {
      rmSync(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 250 });
    } catch {
      process.emitWarning(
        `rmTmpDir: leaving unremovable tmpdir behind (${firstErr?.code || firstErr}): ${dir}`,
        { code: "CONSTRUCT_TEST_TMPDIR_LEFTOVER" },
      );
    }
  }
}
