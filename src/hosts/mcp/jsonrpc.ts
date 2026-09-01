/**
 * hosts/mcp/jsonrpc.ts — the newline-delimited JSON-RPC framing every MCP
 * stdio server in this project speaks.
 *
 * Extracted from the role write server rather than written twice: the role
 * surface (cli/roleserve.ts) and the interactive MCP plane (hosts/mcp/interactive.ts)
 * are different trust boundaries with different tools, but the wire framing is
 * the same protocol law, and two copies of protocol law drift.
 *
 * Framing only. Nothing here knows what a tool is, touches the store, or reads
 * the environment — a handler is injected and this module moves bytes.
 */

export const PROTOCOL_VERSION = '2025-06-18';

export interface JsonRpcRequest {
  readonly jsonrpc?: unknown;
  readonly id?: unknown;
  readonly method?: unknown;
  readonly params?: unknown;
}

export interface JsonRpcResponse {
  readonly jsonrpc: '2.0';
  readonly id: unknown;
  readonly result?: unknown;
  readonly error?: { code: number; message: string };
}

export function response(id: unknown, result: unknown): JsonRpcResponse {
  return { jsonrpc: '2.0', id, result };
}

export function failure(id: unknown, code: number, message: string): JsonRpcResponse {
  return { jsonrpc: '2.0', id, error: { code, message } };
}

export type MessageHandler = (message: JsonRpcRequest) => JsonRpcResponse | null;

/**
 * Serve JSON-RPC over the given streams until the input ends. Newline-delimited
 * per the MCP stdio transport. Resolves when the client hangs up. A line that
 * does not parse is answered with a parse error rather than dropped; a handler
 * returning null means the message was a notification and expects no reply.
 */
export function serveLines(
  handle: MessageHandler,
  stdin: NodeJS.ReadableStream,
  stdout: NodeJS.WritableStream,
): Promise<void> {
  return new Promise((resolve) => {
    let buffer = '';
    stdin.setEncoding('utf8');
    stdin.on('data', (chunk: string) => {
      buffer += chunk;
      for (;;) {
        const newline = buffer.indexOf('\n');
        if (newline < 0) break;
        const line = buffer.slice(0, newline).trim();
        buffer = buffer.slice(newline + 1);
        if (!line) continue;

        let message: JsonRpcRequest;
        try {
          message = JSON.parse(line) as JsonRpcRequest;
        } catch {
          stdout.write(`${JSON.stringify(failure(null, -32700, 'parse error'))}\n`);
          continue;
        }
        const reply = handle(message);
        if (reply) stdout.write(`${JSON.stringify(reply)}\n`);
      }
    });
    stdin.on('end', () => resolve());
    stdin.on('close', () => resolve());
  });
}
