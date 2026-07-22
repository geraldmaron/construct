/**
 * lib/vscode-paths.mjs — VS Code user-profile directory resolution.
 *
 * The stable and Insiders builds each keep their own per-OS user-profile
 * directory (where "MCP: Open User Configuration" edits mcp.json). Shared by
 * sync-worker-profiles.mjs (which writes there) and lib/parity.mjs (which reads
 * there) so both sides resolve the identical candidate set — they had drifted
 * into two hand-maintained copies before this consolidation.
 */
import path from 'node:path';
import os from 'node:os';

export function getVSCodeUserDirs(homeDir = os.homedir()) {
  const platform = os.platform();
  if (platform === 'darwin') {
    return [
      path.join(homeDir, 'Library', 'Application Support', 'Code', 'User'),
      path.join(homeDir, 'Library', 'Application Support', 'Code - Insiders', 'User'),
    ];
  }
  if (platform === 'linux') {
    return [
      path.join(homeDir, '.config', 'Code', 'User'),
      path.join(homeDir, '.config', 'Code - Insiders', 'User'),
    ];
  }
  if (platform === 'win32') {
    const appData = process.env.APPDATA ?? path.join(homeDir, 'AppData', 'Roaming');
    return [
      path.join(appData, 'Code', 'User'),
      path.join(appData, 'Code - Insiders', 'User'),
    ];
  }
  return [];
}
