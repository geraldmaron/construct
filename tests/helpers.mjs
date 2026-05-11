/**
 * tests/helpers.mjs — Shared test utilities.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

export function tempDir(prefix) {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}
