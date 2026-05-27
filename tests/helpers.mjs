/**
 * tests/helpers.mjs — Shared test utilities.
 *
 * tempDir(prefix, t?) creates a unique temp directory under os.tmpdir(). When the
 * optional test context `t` is supplied, the directory is removed via t.after()
 * so the suite does not leak /tmp/construct-* fixtures across runs.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

export function tempDir(prefix, t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  if (t && typeof t.after === "function") {
    t.after(() => {
      try { fs.rmSync(dir, { recursive: true, force: true }); } catch {}
    });
  }
  return dir;
}
