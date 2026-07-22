/**
 * tests/audit/f04-host-readiness/setting-key-case.red.mjs — F04 [R6] setting-key casing proof.
 *
 * RED fixture (must FAIL against current code). pinVscodeChatSettings writes the
 * MCP eager-start key as `chat.mcp.autostart` (all lowercase) —
 * scripts/sync-worker-profiles.mjs L1519, VSCODE_MANAGED_SETTINGS. VS Code setting ids
 * are case-sensitive; an unrecognized id is silently ignored, so a wrong-case key
 * leaves construct-mcp NOT eager-started even though the file "looks" configured.
 *
 * External-docs dependency — REQUIRES VS CODE DOCS VERIFICATION:
 *   The VS Code docs page cited by the audit ([S1]
 *   https://code.visualstudio.com/docs/copilot/customization/mcp-servers) names the
 *   setting `chat.mcp.autoStart` (capital S). A web search of the same feature also
 *   surfaces the lowercase `chat.mcp.autostart` with identical enum values
 *   (always | newAndOutdated | never), so the two public sources DISAGREE on casing.
 *   Encoded here: the documented-primary-source spelling (capital S). If VS Code's
 *   settings schema is later confirmed to use lowercase, flip EXPECTED_KEY and
 *   delete the banner — the bug then collapses to "verify against the schema, not a
 *   doc string" and the fixture still guards the parity.
 *
 * Contract (CX-AUDIT-HOST-001): the key Construct writes must equal the key VS Code's
 * settings schema reads. Passes once the writer emits the verified key.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { pinVscodeChatSettings } from '../../../scripts/sync-worker-profiles.mjs';

// The setting id as written in the primary VS Code docs page [S1] (case-sensitive).

const EXPECTED_KEY = 'chat.mcp.autoStart';
const WRONG_CASE_KEY = 'chat.mcp.autostart';

test('[R6] the written MCP autostart key must match the documented VS Code setting id (case-sensitive)', (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cx-f04-key-'));
  t.after(() => { try { fs.rmSync(dir, { recursive: true, force: true }); } catch {} });

  pinVscodeChatSettings(dir);

  const settings = JSON.parse(fs.readFileSync(path.join(dir, '.vscode', 'settings.json'), 'utf8'));
  const keys = Object.keys(settings);

  assert.ok(
    keys.includes(EXPECTED_KEY),
    `expected the documented key "${EXPECTED_KEY}" but settings.json carried: ${keys.join(', ')}`,
  );
  assert.ok(
    !keys.includes(WRONG_CASE_KEY),
    `wrong-case key "${WRONG_CASE_KEY}" is written; VS Code ignores unrecognized case-variant ids, so construct-mcp is not eager-started`,
  );
});
