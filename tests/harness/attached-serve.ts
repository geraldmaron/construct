/**
 * tests/harness/attached-serve.ts — a PATH stub that answers the host's
 * live MCP list the way the Cursor host trial measured: construct-mcp: ready.
 */

import { chmodSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

/** Put a host CLI on PATH that reports construct-mcp ready. */
export function plantReadyMcpList(dir: string, command: 'cursor-agent' | 'claude'): NodeJS.ProcessEnv {
  const bin = join(dir, 'bin');
  mkdirSync(bin, { recursive: true });
  const path = join(bin, command);
  writeFileSync(
    path,
    `#!/bin/sh\n` +
      `if [ "$1" = "mcp" ] && [ "$2" = "list" ]; then\n` +
      `  printf '%s\\n' "construct-mcp: ready"\n` +
      `  exit 0\n` +
      `fi\n` +
      `exit 1\n`,
    { mode: 0o755 },
  );
  chmodSync(path, 0o755);
  return { PATH: `${bin}:${process.env.PATH ?? ''}` };
}
