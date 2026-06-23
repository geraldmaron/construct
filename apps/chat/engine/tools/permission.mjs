/**
 * apps/chat/engine/tools/permission.mjs — the permission and sandbox gate for the
 * owned loop's tools.
 *
 * Owning the loop means Construct, not a host, decides whether a tool runs. This
 * gate reuses the host-agnostic decision vocabulary ADR-0040 defined
 * (allow | allow_always | reject) and the sandbox levels from lib/chat/config.mjs
 * (read-only, workspace-write, danger-full-access). Read-only tools (read, grep,
 * glob) always pass; mutating tools (write, edit, shell) are gated by the sandbox
 * level and the current permission mode, deferring to an interactive
 * `requestPermission` handler only in `ask` mode. `allow_always` is sticky for the
 * rest of the session so a user is not re-prompted per call.
 *
 * `allowOutside` (escape the workspace root) is granted only under
 * danger-full-access; every other level keeps tools inside the workspace, which
 * the primitives enforce independently.
 */

export const READ_ONLY_TOOLS = new Set(['read', 'grep', 'glob']);
export const MUTATING_TOOLS = new Set(['write', 'edit', 'shell']);

export function createPermissionGate({
  getSandbox = () => null,
  getPermissionMode = () => 'allow_once',
  requestPermission = null,
} = {}) {
  let alwaysAllowed = false;

  async function check(toolName, input = {}) {
    const sandbox = getSandbox() || 'workspace-write';
    const allowOutside = sandbox === 'danger-full-access';

    if (READ_ONLY_TOOLS.has(toolName)) return { allowed: true, allowOutside };

    if (sandbox === 'read-only') {
      return { allowed: false, allowOutside, reason: 'sandbox is read-only; mutating tools are disabled (change with /set sandbox workspace-write)' };
    }

    if (alwaysAllowed) return { allowed: true, allowOutside };

    const mode = getPermissionMode() || 'allow_once';
    if (mode === 'reject') return { allowed: false, allowOutside, reason: 'permission mode is reject' };
    if (mode === 'allow_always') { alwaysAllowed = true; return { allowed: true, allowOutside }; }
    if (mode === 'allow_once') return { allowed: true, allowOutside };

    // ask mode: defer to the interactive handler, mapping its decision back.
    const decision = requestPermission ? await requestPermission({ tool: toolName, input }) : 'allow';
    if (decision === 'reject') return { allowed: false, allowOutside, reason: 'denied by user' };
    if (decision === 'allow_always') { alwaysAllowed = true; return { allowed: true, allowOutside }; }
    return { allowed: true, allowOutside };
  }

  return { check, get alwaysAllowed() { return alwaysAllowed; } };
}
