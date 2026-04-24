/**
 * lib/schema-artifact.mjs — persist and read inferred schema results.
 *
 * Writes SchemaInferenceResult and UnifiedSchemaResult objects as JSON artifacts
 * under .cx/product-intel/schemas/. File names are derived from the source document
 * basename so results are easy to find and diff.
 *
 * Schema artifacts are intentionally separate from ingested markdown so they
 * can be consumed programmatically without parsing markdown.
 */

import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { basename, dirname, extname, isAbsolute, join, parse, relative, resolve } from 'node:path';

const DEFAULT_SCHEMA_DIR = '.cx/product-intel/schemas';

function slugify(value) {
  return String(value)
    .normalize('NFKD')
    .replace(/[^\w.-]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .toLowerCase();
}

function ensureDir(dirPath) {
  mkdirSync(dirPath, { recursive: true });
}

function nextAvailablePath(targetPath) {
  if (!existsSync(targetPath)) return targetPath;
  const parsed = parse(targetPath);
  let index = 2;
  while (true) {
    const candidate = join(parsed.dir, `${parsed.name}-${index}${parsed.ext}`);
    if (!existsSync(candidate)) return candidate;
    index += 1;
  }
}

/**
 * Write a schema inference result to disk.
 *
 * @param {object} schema   SchemaInferenceResult or UnifiedSchemaResult
 * @param {object} opts
 * @param {string} [opts.cwd]        Project root for resolving default output dir.
 * @param {string} [opts.outputPath] Explicit output path (overrides outputDir).
 * @param {string} [opts.outputDir]  Directory to write into (default: .cx/product-intel/schemas).
 * @param {string} [opts.label]      Optional label used to derive the filename.
 * @returns {{ outputPath: string, relativePath: string }}
 */
export function writeSchemaArtifact(schema, { cwd = process.cwd(), outputPath = null, outputDir = null, label = null } = {}) {
  const resolvedCwd = resolve(cwd);
  const resolvedDir = outputDir
    ? (isAbsolute(outputDir) ? outputDir : resolve(resolvedCwd, outputDir))
    : resolve(resolvedCwd, DEFAULT_SCHEMA_DIR);

  let targetPath;
  if (outputPath) {
    targetPath = isAbsolute(outputPath) ? outputPath : resolve(resolvedCwd, outputPath);
  } else {
    // Derive filename from source_path (single) or label (unified).
    const nameBase = label
      ? slugify(label)
      : schema.source_path
        ? slugify(basename(schema.source_path))
        : 'schema';
    targetPath = join(resolvedDir, `${nameBase}.schema.json`);
  }

  ensureDir(dirname(targetPath));
  const finalPath = nextAvailablePath(targetPath);

  writeFileSync(finalPath, JSON.stringify(schema, null, 2) + '\n', 'utf8');

  return {
    outputPath: finalPath,
    relativePath: relative(resolvedCwd, finalPath),
  };
}

/**
 * Read a schema artifact from disk.
 *
 * @param {string} schemaPath  Absolute or relative path to a .schema.json file.
 * @param {string} [cwd]
 * @returns {object}
 */
export function readSchemaArtifact(schemaPath, cwd = process.cwd()) {
  const resolved = isAbsolute(schemaPath) ? schemaPath : resolve(cwd, schemaPath);
  if (!existsSync(resolved)) throw new Error(`Schema artifact not found: ${resolved}`);
  return JSON.parse(readFileSync(resolved, 'utf8'));
}

/**
 * List all schema artifacts in a directory.
 *
 * @param {object} opts
 * @param {string} [opts.cwd]
 * @param {string} [opts.schemaDir]
 * @returns {Array<{ path: string, relativePath: string, stat: object }>}
 */
export function listSchemaArtifacts({ cwd = process.cwd(), schemaDir = null } = {}) {
  const resolvedCwd = resolve(cwd);
  const dir = schemaDir
    ? (isAbsolute(schemaDir) ? schemaDir : resolve(resolvedCwd, schemaDir))
    : resolve(resolvedCwd, DEFAULT_SCHEMA_DIR);

  if (!existsSync(dir)) return [];

  const entries = [];
  const stack = [dir];
  while (stack.length > 0) {
    const current = stack.pop();
    for (const entry of readdirSync(current, { withFileTypes: true })) {
      const full = join(current, entry.name);
      if (entry.isDirectory()) {
        stack.push(full);
      } else if (entry.isFile() && entry.name.endsWith('.schema.json')) {
        entries.push({
          path: full,
          relativePath: relative(resolvedCwd, full),
          stat: statSync(full),
        });
      }
    }
  }
  return entries.sort((a, b) => b.stat.mtimeMs - a.stat.mtimeMs);
}

/**
 * Default schema output dir relative to project root.
 */
export const SCHEMA_DIR = DEFAULT_SCHEMA_DIR;
