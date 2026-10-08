#!/usr/bin/env node
/**
 * evals-live-stub.mjs — a competing MCP server for live intake runs:
 * `evals-live-stub.mjs <spec>`, where <spec> is a JSON file or inline JSON
 * {name, instructions, tools: [{name, description, kind: read|write}],
 * items?, page?}.
 *
 * It exposes only names, instructions, and one-line descriptions. A read
 * answers with the spec's page, then its items, then "stub: no data"; a
 * write answers "stub: saved". Every call is appended to $EVAL_STUB_LOG as
 * {t, server, tool, kind, arguments}. No network, no state between calls.
 */
import { appendFileSync, readFileSync } from 'node:fs';
import { StringDecoder } from 'node:string_decoder';

const arg = process.argv[2];
if (!arg) {
  process.stderr.write('usage: evals-live-stub.mjs <spec.json | inline JSON>\n');
  process.exit(2);
}
const spec = JSON.parse(arg.trim().startsWith('{') ? arg : readFileSync(arg, 'utf8'));
const tools = spec.tools.map((t) => ({
  name: t.name,
  description: t.description,
  inputSchema: { type: 'object', properties: { query: { type: 'string', description: 'What to look up or write.' }, text: { type: 'string', description: 'The content.' } } },
}));
const kinds = new Map(spec.tools.map((t) => [t.name, t.kind === 'write' ? 'write' : 'read']));

function answer(message) {
  if (message.method === 'initialize') {
    return { protocolVersion: message.params?.protocolVersion ?? '2025-06-18', capabilities: { tools: {} }, serverInfo: { name: spec.name, version: '0.0.0' }, instructions: spec.instructions };
  }
  if (message.method === 'tools/list') return { tools };
  if (message.method === 'tools/call') {
    const tool = String(message.params?.name ?? '');
    const kind = kinds.get(tool) ?? 'read';
    if (process.env.EVAL_STUB_LOG) {
      appendFileSync(process.env.EVAL_STUB_LOG, `${JSON.stringify({ t: Date.now(), server: spec.name, tool, kind, arguments: message.params?.arguments ?? {} })}\n`);
    }
    const text = kind === 'write' ? 'stub: saved' : typeof spec.page === 'string' ? spec.page : Array.isArray(spec.items) ? JSON.stringify(spec.items, null, 2) : 'stub: no data';
    return { content: [{ type: 'text', text }] };
  }
  return {};
}

// One decoder for the stream, so a character split across chunks is read whole.
const decoder = new StringDecoder('utf8');
let buffer = '';
process.stdin.on('data', (chunk) => {
  buffer += decoder.write(chunk);
  let nl;
  while ((nl = buffer.indexOf('\n')) >= 0) {
    const line = buffer.slice(0, nl);
    buffer = buffer.slice(nl + 1);
    if (!line.trim()) continue;
    let message;
    try {
      message = JSON.parse(line);
    } catch {
      continue;
    }
    if (message.id === undefined || message.id === null) continue;
    process.stdout.write(`${JSON.stringify({ jsonrpc: '2.0', id: message.id, result: answer(message) })}\n`);
  }
});
process.stdin.on('end', () => process.exit(0));
