/**
 * hosts/mcp/jsonrpc.ts — newline-delimited JSON-RPC 2.0 over stdio, which is
 * how an agent host speaks MCP to a local server.
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
  readonly error?: { readonly code: number; readonly message: string };
}

export function response(id: unknown, result: unknown): JsonRpcResponse {
  return { jsonrpc: '2.0', id, result };
}

export function failure(id: unknown, code: number, message: string): JsonRpcResponse {
  return { jsonrpc: '2.0', id, error: { code, message } };
}

export type AsyncMessageHandler = (message: JsonRpcRequest) => Promise<JsonRpcResponse | null>;

/** Read lines from stdin, answer on stdout, resolve when stdin ends. Replies keep arrival order. */
export function serveLines(handle: AsyncMessageHandler, stdin: NodeJS.ReadableStream, stdout: NodeJS.WritableStream): Promise<void> {
  return new Promise((resolve) => {
    let buffer = '';
    let chain: Promise<void> = Promise.resolve();
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
        chain = chain.then(async () => {
          const reply = await handle(message);
          if (reply) stdout.write(`${JSON.stringify(reply)}\n`);
        });
      }
    });
    const done = () => {
      void chain.then(() => resolve());
    };
    stdin.on('end', done);
    stdin.on('close', done);
  });
}
