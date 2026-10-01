/**
 * hosts/mcp/jsonrpc.ts — JSON-RPC 2.0 helpers for the MCP handler. The stdio
 * framing itself is the official SDK transport.
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
