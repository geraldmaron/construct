/**
 * tests/audit/f02-secrets/generated-file-leak-scan.red.mjs — F02 [R12] synthetic-secret
 * leak scan over all generated MCP host-config outputs.
 *
 * Claude and OpenCode local/stdio env emit the host env-reference form instead of the
 * materialized value, / plan Epic 4
 * (docs/notes/research/2026-06-construct-audit/90-credential-handling-remediation-plan.md
 * §Epic 4): no SENTINEL value appears in either generated host entry. VS Code is
 * exempted (construct-trxz.12): its own mcp.json reference documents no `${env:VAR}`
 * substitution for a stdio `env` block, only `${workspaceFolder}`-style predefined
 * variables and `${input:id}` prompts, so writing a reference there would hand the
 * child process an unexpanded string instead of the credential. VS Code's local/stdio
 * env keeps the Codex-style materialize-or-strip treatment (mcp-secret-ref.test.mjs)
 * until VS Code ships an env-block substitution mechanism this builder can target.
 */
import assert from 'node:assert/strict';
import test from 'node:test';

import { buildClaudeMcpEntry, buildOpenCodeMcpEntry } from '../../../lib/mcp-platform-config.mjs';

// A value that cannot occur by accident, so a substring hit over serialized config is
// unambiguous proof the literal secret was written rather than a reference to it.

const SENTINEL_SECRET = 'SENTINEL_SECRET_a1b2c3';

// Shape mirrors a real stdio MCP catalog entry (linear/slack/notion): a command plus a
// templated secret env var that the builder fills from resolvedValues.

const STDIO_DEF = {
  command: 'npx',
  args: ['-y', '@example/stdio-mcp'],
  env: { EXAMPLE_API_KEY: '__EXAMPLE_API_KEY__' },
};

test('[R12] no resolved stdio MCP secret value lands in Claude or OpenCode generated host config', () => {
  const resolved = { EXAMPLE_API_KEY: SENTINEL_SECRET };

  const claude = buildClaudeMcpEntry('example', STDIO_DEF, resolved);
  const { entry: opencode } = buildOpenCodeMcpEntry('example', STDIO_DEF, resolved);

  const generated = {
    'claude/claude_desktop_config.json': { mcpServers: { example: claude } },
    'opencode/opencode.json': { mcp: { example: opencode } },
  };

  for (const [file, payload] of Object.entries(generated)) {
    assert.ok(
      !JSON.stringify(payload).includes(SENTINEL_SECRET),
      `resolved secret value leaked into generated ${file}`,
    );
  }
});

test('[R12] VS Code generated host config keeps the resolved value (no env-block substitution to reference)', () => {
  const resolved = { EXAMPLE_API_KEY: SENTINEL_SECRET };
  const vscode = buildClaudeMcpEntry('example', STDIO_DEF, resolved, { host: 'vscode' });
  const payload = { servers: { example: vscode } };

  assert.ok(
    JSON.stringify(payload).includes(SENTINEL_SECRET),
    'VS Code entry should materialize the resolved value since mcp.json does not expand ${env:VAR}',
  );
  assert.ok(
    !JSON.stringify(payload).includes('${env:'),
    'a ${env:VAR} form must not be written — VS Code would pass it through unexpanded',
  );
});
