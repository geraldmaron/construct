/**
 * tests/integrations/status-no-materialization.test.mjs —
 * `construct integrations status` must never materialize a credential.
 *
 * detectIntegrationConfig backs the read-only `status` subcommand (bin/construct)
 * and must report presence by shape only (never to merely list or
 * check"). This plants a booby-trapped shell rc file that writes a sentinel only
 * if actually sourced by a shell, and a failing `op` shim on PATH that writes a
 * sentinel only if actually invoked, then asserts detection never trips either —
 * proving detection reads rc/config text without executing it and never resolves
 * an op:// reference.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

function makeFailingOpShim(binDir) {
  const opInvokedSentinel = path.join(binDir, 'op-invoked.sentinel');
  const opPath = path.join(binDir, process.platform === 'win32' ? 'op.exe' : 'op');
  fs.writeFileSync(
    opPath,
    `#!/bin/sh\necho invoked >> "${opInvokedSentinel}"\nexit 1\n`,
  );
  fs.chmodSync(opPath, 0o755);
  return opInvokedSentinel;
}

function writeBoobyTrappedRc(rcPath, rcSourcedSentinel) {
  fs.writeFileSync(
    rcPath,
    [
      `echo sourced >> "${rcSourcedSentinel}"`,
      `export GITHUB_TOKEN="\$(op read 'op://Vault/Item/credential')"`,
      `export JIRA_HOST=https://example.atlassian.net`,
      `export JIRA_USER=user@example.com`,
      `export JIRA_API_TOKEN="\$(op read 'op://Vault/Jira/credential')"`,
      `export JIRA_PROJECT=PROJ`,
      '',
    ].join('\n'),
  );
}

test('detectIntegrationConfig never sources a shell rc file or invokes op', async (t) => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'cx-status-nomaterialize-home-'));
  const binDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cx-status-nomaterialize-bin-'));
  const rcSourcedSentinel = path.join(home, 'rc-sourced.sentinel');

  writeBoobyTrappedRc(path.join(home, '.zshrc'), rcSourcedSentinel);
  writeBoobyTrappedRc(path.join(home, '.bashrc'), rcSourcedSentinel);
  const opInvokedSentinel = makeFailingOpShim(binDir);

  const originalPath = process.env.PATH;
  process.env.PATH = `${binDir}${path.delimiter}${originalPath}`;
  t.after(() => {
    process.env.PATH = originalPath;
    fs.rmSync(home, { recursive: true, force: true });
    fs.rmSync(binDir, { recursive: true, force: true });
  });

  const { detectIntegrationConfig } = await import('../../lib/integrations/intake-integrations.mjs');
  const config = detectIntegrationConfig({ homeDir: home });

  assert.equal(fs.existsSync(rcSourcedSentinel), false, 'the rc file must never be sourced by a shell');
  assert.equal(fs.existsSync(opInvokedSentinel), false, 'op must never be invoked during status detection');

  // A shape-only rc scan still recognizes an `export VAR=...` line as present,
  // even though the value carries an unresolved op:// command substitution.
  assert.equal(config.jira, true);
  assert.equal(typeof config.github, 'boolean');
  assert.equal(typeof config.confluence, 'boolean');
});
