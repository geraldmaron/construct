/**
 * lib/mcp/tool-registry.mjs — dynamic MCP tool module scanner (LMCP-B5).
 *
 * server.mjs's ALL_TOOL_DEFS/dispatchToolByName stay hand-maintained for the
 * existing 75+ tools (a full migration is a rewrite, not this bridge). New
 * tools instead self-register: a file named `<name>.tool.mjs` under
 * lib/mcp/tools/ (or a caller-supplied directory, e.g. a test fixture) may
 * export:
 *
 *   TOOL_DEFS     — array of { name, description, inputSchema, outputSchema?, safety }
 *   TOOL_HANDLERS — object mapping name -> async (args, opts) => result
 *
 * scanToolModules() imports every `*.tool.mjs` file in the directory and
 * collects these exports. Only files with that suffix are imported, so the
 * existing hand-written tool modules (project.mjs, document.mjs, ...) are
 * never touched by the scan and load exactly as before.
 *
 * Registration contract: lib/registration-contract.mjs TOOL_MODULE_REGISTRATION
 * (required exports TOOL_DEFS + TOOL_HANDLERS; def fields name, description,
 * inputSchema, safety).
 *
 * `safety` is required on every def — mirrors the fail-loud contract
 * withSafetyEnvelope already applies to the hardcoded catalog (see
 * lib/mcp/tool-safety.mjs): a tool missing one throws immediately, so a
 * newly self-registered tool cannot ship unclassified. A def naming a tool
 * with no matching TOOL_HANDLERS entry throws the same way.
 */

import { readdirSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { DEFAULT_OUTPUT_SCHEMA } from './tool-safety.mjs';
import { assertToolDefShape, TOOL_MODULE_REGISTRATION } from '../registration-contract.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));

export const DEFAULT_TOOLS_DIR = resolve(HERE, 'tools');
export const TOOL_MODULE_SUFFIX = TOOL_MODULE_REGISTRATION.moduleSuffix;

function isPlainObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

/**
 * scanToolModules({ dir } = {})
 *
 * Returns { defs, handlers, errors }:
 *   defs     — array of tool definitions (outputSchema defaulted, safety intact)
 *   handlers — Map<name, handlerFn>
 *   errors   — non-fatal import failures (file failed to load as a module)
 *
 * Throws synchronously (not collected in errors) when a loaded module
 * declares a tool without a safety classification, or names a tool with no
 * matching handler — both are registration-shape bugs, not runtime faults,
 * and must fail the same way withSafetyEnvelope already does for the
 * hardcoded catalog.
 */
export async function scanToolModules({ dir = DEFAULT_TOOLS_DIR } = {}) {
  const defs = [];
  const handlers = new Map();
  const errors = [];

  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return { defs, handlers, errors };
  }

  const files = entries
    .filter((e) => e.isFile() && e.name.endsWith(TOOL_MODULE_SUFFIX))
    .map((e) => join(dir, e.name))
    .sort();

  for (const filePath of files) {
    let mod;
    try {
      mod = await import(pathToFileURL(filePath).href);
    } catch (err) {
      errors.push(`${filePath}: failed to import (${err.message})`);
      continue;
    }

    const toolDefs = Array.isArray(mod.TOOL_DEFS) ? mod.TOOL_DEFS : null;
    if (!toolDefs) continue;
    const toolHandlers = isPlainObject(mod.TOOL_HANDLERS) ? mod.TOOL_HANDLERS : {};

    for (const def of toolDefs) {
      assertToolDefShape(def, { filePath });
      const handler = toolHandlers[def.name];
      if (typeof handler !== 'function') {
        throw new Error(`${filePath}: TOOL_DEFS declares '${def.name}' but TOOL_HANDLERS has no matching function`);
      }
      if (handlers.has(def.name)) {
        throw new Error(`${filePath}: duplicate self-registered tool name '${def.name}'`);
      }
      defs.push({ ...def, outputSchema: def.outputSchema ?? DEFAULT_OUTPUT_SCHEMA });
      handlers.set(def.name, handler);
    }
  }

  return { defs, handlers, errors };
}
