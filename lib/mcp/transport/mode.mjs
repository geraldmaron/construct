/**
 * lib/mcp/transport/mode.mjs — MCP transport-mode resolution.
 *
 * Two explicit, non-overlapping modes with separate entrypoints:
 *   stdio-local — the default. A local subprocess spoken to over stdin/stdout;
 *                 identity comes from the local OS session, so no network authn.
 *                 Behavior is unchanged from the pre-separation server.
 *   http-remote — opt-in only, via CONSTRUCT_MCP_TRANSPORT=http (or =http-remote).
 *                 A network surface, so it REQUIRES authn config and refuses to
 *                 start without it (see resolveHttpAuthConfig).
 *
 * There is no auto-detection and no implicit http: a server started with no
 * transport env is always stdio-local. Selecting http is a deliberate operator
 * act, and that act carries the fail-closed auth requirement with it.
 */

export const TRANSPORT_STDIO = 'stdio-local';
export const TRANSPORT_HTTP = 'http-remote';

export const TRANSPORT_MODE_ENV_KEY = 'CONSTRUCT_MCP_TRANSPORT';

/**
 * Resolve the transport mode from env. Anything but an explicit http selection
 * resolves to stdio-local, so a typo or empty value degrades to the safe local
 * mode rather than silently exposing a network surface.
 */
export function resolveTransportMode(env = process.env) {
  const raw = String(env?.[TRANSPORT_MODE_ENV_KEY] || '').trim().toLowerCase();
  if (raw === 'http' || raw === 'http-remote' || raw === 'streamable-http') return TRANSPORT_HTTP;
  return TRANSPORT_STDIO;
}
