/**
 * tests/audit/f04-host-readiness/jsonc-safe-merge.red.mjs — F04 [R7] JSONC silent-skip proof.
 *
 * RED fixture (must FAIL against current code). pinVscodeChatSettings reads an
 * existing .vscode/settings.json with `JSON.parse` inside a `try { } catch { return; }`
 * (scripts/sync-worker-profiles.mjs L1526-1529). VS Code's settings.json is JSONC — line
 * comments and trailing commas are legal and common — so a real user's commented
 * settings.json throws in JSON.parse and the helper silently returns without ever
 * writing `chat.mcp.autostart` / `chat.agentFilesLocations`. construct-mcp then never
 * auto-starts for exactly the users most likely to have hand-edited settings.
 *
 * The existing suite (tests/vscode-mcp-toolkit-path.test.mjs) asserts the OPPOSITE —
 * "commented file left untouched" — baking the silent skip in as intended. This
 * fixture encodes the corrected contract (CX-AUDIT-HOST-002): a JSONC settings.json
 * must be parsed JSONC-aware and the managed keys merged in, preserving the user's
 * existing keys and comments-as-content. It passes once a JSONC-safe writer lands.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { pinVscodeChatSettings } from '../../../scripts/sync-worker-profiles.mjs';

// A settings.json that is valid JSONC but not strict JSON: a line comment plus a
// trailing comma after the last property. VS Code accepts this; JSON.parse rejects it.

const JSONC_SETTINGS = `{
  // developer preferences — keep tab size at 4
  "editor.tabSize": 4,
  "files.eol": "\\n",
}
`;

test('[R7] pinVscodeChatSettings must merge managed keys into a JSONC settings.json instead of silently skipping it', (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cx-f04-jsonc-'));
  t.after(() => { try { fs.rmSync(dir, { recursive: true, force: true }); } catch {} });
  const settingsPath = path.join(dir, '.vscode', 'settings.json');
  fs.mkdirSync(path.dirname(settingsPath), { recursive: true });
  fs.writeFileSync(settingsPath, JSONC_SETTINGS);

  pinVscodeChatSettings(dir);

  const after = fs.readFileSync(settingsPath, 'utf8');

  // The silent-skip leaves the file byte-for-byte unchanged, so the autostart key
  // never appears. A JSONC-safe writer adds the managed keys while keeping the
  // user's editor.tabSize=4.

  assert.notEqual(
    after,
    JSONC_SETTINGS,
    'JSONC settings.json was left byte-for-byte unchanged — the JSON.parse catch silently skipped the merge',
  );
  assert.match(
    after,
    /chat\.mcp\.autoStart/,
    'managed chat.mcp.autoStart key was not written into the JSONC settings.json',
  );
  assert.match(
    after,
    /"editor\.tabSize"\s*:\s*4/,
    'user key editor.tabSize=4 was lost — a JSONC-safe merge must preserve existing settings',
  );
});
