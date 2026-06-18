/**
 * apps/chat/engine/tools/registry.mjs — builds the owned loop's tool set as Vercel
 * AI SDK tools, gated by the permission/sandbox policy.
 *
 * Each tool wraps a zero-dep primitive (primitives.mjs) behind the permission gate
 * (permission.mjs): the gate runs first, and a denial returns a structured result
 * the model can read rather than throwing, so the loop degrades gracefully instead
 * of crashing on a blocked action. A single `construct_tool` bridges the loop to
 * Construct's existing MCP tool surface via dispatchToolByName (mirroring the MCP
 * `construct_call` meta-tool), so the loop reaches knowledge search, skills, and
 * orchestration policy without re-declaring 60+ schemas here.
 *
 * `ai` and `zod` are imported lazily and only here, so the rest of the engine and
 * all of its tests stay free of the optional dependencies.
 */

import {
  readFileTool, writeFileTool, editFileTool, globTool, grepTool, shellTool,
} from './primitives.mjs';
import { createPermissionGate } from './permission.mjs';

function denied(reason) {
  return { ok: false, denied: true, error: reason };
}

export async function buildAgentTools({ env = process.env, cwd = process.cwd(), handlers = {}, only = null } = {}) {
  const { tool } = await import('ai');
  const { z } = await import('zod');

  const gate = createPermissionGate({
    getSandbox: handlers.getSandbox || (() => null),
    getPermissionMode: handlers.getPermissionMode || (() => 'allow_once'),
    requestPermission: handlers.requestPermission || null,
  });

  const defs = {
    read: tool({
      description: 'Read a UTF-8 text file from the workspace.',
      inputSchema: z.object({ path: z.string().describe('workspace-relative file path') }),
      execute: async ({ path: p }) => {
        const verdict = await gate.check('read', { path: p });
        if (!verdict.allowed) return denied(verdict.reason);
        return readFileTool({ cwd, path: p, allowOutside: verdict.allowOutside });
      },
    }),
    glob: tool({
      description: 'Find files by glob pattern (supports * ** ?).',
      inputSchema: z.object({ pattern: z.string(), limit: z.number().int().positive().max(1000).optional() }),
      execute: async ({ pattern, limit }) => {
        const verdict = await gate.check('glob', { pattern });
        if (!verdict.allowed) return denied(verdict.reason);
        return globTool({ cwd, pattern, limit, allowOutside: verdict.allowOutside });
      },
    }),
    grep: tool({
      description: 'Search file contents by regular expression, optionally filtered by a glob.',
      inputSchema: z.object({
        pattern: z.string(),
        glob: z.string().optional(),
        caseInsensitive: z.boolean().optional(),
        limit: z.number().int().positive().max(1000).optional(),
      }),
      execute: async ({ pattern, glob, caseInsensitive, limit }) => {
        const verdict = await gate.check('grep', { pattern });
        if (!verdict.allowed) return denied(verdict.reason);
        return grepTool({ cwd, pattern, glob, caseInsensitive, limit, allowOutside: verdict.allowOutside });
      },
    }),
    write: tool({
      description: 'Create or overwrite a workspace file with the given content.',
      inputSchema: z.object({ path: z.string(), content: z.string() }),
      execute: async ({ path: p, content }) => {
        const verdict = await gate.check('write', { path: p });
        if (!verdict.allowed) return denied(verdict.reason);
        return writeFileTool({ cwd, path: p, content, allowOutside: verdict.allowOutside });
      },
    }),
    edit: tool({
      description: 'Replace an exact string in a workspace file. oldString must be unique unless replaceAll is set.',
      inputSchema: z.object({
        path: z.string(),
        oldString: z.string(),
        newString: z.string(),
        replaceAll: z.boolean().optional(),
      }),
      execute: async ({ path: p, oldString, newString, replaceAll }) => {
        const verdict = await gate.check('edit', { path: p });
        if (!verdict.allowed) return denied(verdict.reason);
        return editFileTool({ cwd, path: p, oldString, newString, replaceAll, allowOutside: verdict.allowOutside });
      },
    }),
    shell: tool({
      description: 'Run a bounded shell command in the workspace with a timeout.',
      inputSchema: z.object({ command: z.string(), timeoutSeconds: z.number().int().positive().max(600).optional() }),
      execute: async ({ command, timeoutSeconds }) => {
        const verdict = await gate.check('shell', { command });
        if (!verdict.allowed) return denied(verdict.reason);
        return shellTool({ cwd, command, timeoutSeconds, allowOutside: verdict.allowOutside });
      },
    }),
    construct_tool: tool({
      description: 'Call a Construct MCP tool by name (e.g. knowledge_search, search_skills, orchestration_policy). Returns the tool result.',
      inputSchema: z.object({ name: z.string(), args: z.record(z.string(), z.any()).optional() }),
      execute: async ({ name, args }) => {
        try {
          const { dispatchToolByName } = await import('../../../../lib/mcp/server.mjs');
          const result = await dispatchToolByName(name, args || {});
          return { ok: true, name, result };
        } catch (err) {
          return { ok: false, name, error: err?.message || String(err) };
        }
      },
    }),
  };

  if (!Array.isArray(only) || only.length === 0) return defs;
  const filtered = {};
  for (const name of only) if (defs[name]) filtered[name] = defs[name];
  return filtered;
}

export const AGENT_TOOL_NAMES = ['read', 'glob', 'grep', 'write', 'edit', 'shell', 'construct_tool'];
