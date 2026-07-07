/**
 * lib/mcp/transport/stdio.mjs — stdio-local MCP entrypoint.
 *
 * The default transport, factored out of server.mjs so the http entrypoint can
 * live beside it under one mode selector. Behavior is byte-for-byte the same as
 * the original inline `new StdioServerTransport(); await server.connect(...)`:
 * a local subprocess over stdin/stdout, no network surface, no authn — identity
 * is the local OS session. The server object (tool catalog + dispatch) is
 * passed in already built, so this module never re-registers a handler.
 */

import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';

/**
 * Connect the pre-built MCP server to a stdio transport. Resolves once the
 * transport is connected; the process then stays alive serving requests.
 */
export async function startStdioTransport(server) {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  return transport;
}
