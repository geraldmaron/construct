/**
 * lib/mcp/tools/document.mjs — Document-handling MCP tools: extract text, ingest, infer schema, list schema artifacts.
 *
 * All functions are async-safe; extractDocumentText and listSchemaArtifactsTool are synchronous.
 * Depends on lib/document-extract.mjs, lib/document-ingest.mjs, lib/schema-infer.mjs, lib/schema-artifact.mjs.
 */
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { extractDocumentText as extractLocalDocumentText } from '../../document-extract.mjs';
import { ingestDocuments } from '../../document-ingest.mjs';
import { inferDocumentSchema, inferUnifiedSchema } from '../../schema-infer.mjs';
import { writeSchemaArtifact, listSchemaArtifacts, SCHEMA_DIR } from '../../schema-artifact.mjs';

export function extractDocumentText(args) {
  const filePath = resolve(String(args.file_path || ''));
  const maxChars = Number.isFinite(Number(args.max_chars)) && Number(args.max_chars) > 0
    ? Math.min(Number(args.max_chars), 200_000)
    : 20_000;

  if (!existsSync(filePath)) {
    return { error: `File not found: ${filePath}` };
  }

  try {
    const extracted = extractLocalDocumentText(filePath, { maxChars });
    return {
      file_path: extracted.filePath,
      extension: extracted.extension,
      extraction_method: extracted.extractionMethod,
      text: extracted.text,
      truncated: extracted.truncated,
      characters: extracted.characters,
    };
  } catch (error) {
    return {
      error: `Failed to extract text from ${filePath}: ${error.message ?? String(error)}`,
    };
  }
}

export async function ingestDocument(args) {
  const filePath = resolve(String(args.file_path || ''));
  const outputPath = args.out_path ? resolve(String(args.out_path)) : null;
  const outputDir = args.out_dir ? resolve(String(args.out_dir)) : null;
  const target = typeof args.target === 'string' && args.target ? args.target : 'product-intel';
  const cwd = args.cwd ? resolve(String(args.cwd)) : process.cwd();
  const sync = Boolean(args.sync);

  if (!existsSync(filePath)) {
    return { error: `File not found: ${filePath}` };
  }

  try {
    return await ingestDocuments([filePath], {
      cwd,
      outputPath,
      outputDir,
      target,
      sync,
      env: process.env,
    });
  } catch (error) {
    return {
      error: `Failed to ingest ${filePath}: ${error.message ?? String(error)}`,
    };
  }
}

export async function inferDocumentSchemaTool(args) {
  const cwd = args.cwd ? resolve(String(args.cwd)) : process.cwd();
  const maxChars = Number.isFinite(Number(args.max_chars)) && Number(args.max_chars) > 0
    ? Math.min(Number(args.max_chars), 200_000)
    : 40_000;
  const save = Boolean(args.save);

  const rawPaths = Array.isArray(args.file_paths) && args.file_paths.length > 0
    ? args.file_paths
    : args.file_path
      ? [args.file_path]
      : [];

  if (rawPaths.length === 0) {
    return { error: 'file_path or file_paths is required' };
  }

  const filePaths = rawPaths.map((p) => resolve(String(p)));
  const missingFiles = filePaths.filter((p) => !existsSync(p));
  if (missingFiles.length > 0) {
    return { error: `File(s) not found: ${missingFiles.join(', ')}` };
  }

  try {
    let schema;
    if (filePaths.length === 1) {
      const sampleSize = Number.isFinite(Number(args.sample_size)) ? Number(args.sample_size) : 10;
      const threshold = Number.isFinite(Number(args.threshold)) ? Number(args.threshold) : 0.5;
      schema = await inferDocumentSchema(filePaths[0], { maxChars });
      void sampleSize; void threshold;
    } else {
      const sampleSize = Number.isFinite(Number(args.sample_size)) ? Number(args.sample_size) : 10;
      const threshold = Number.isFinite(Number(args.threshold)) ? Number(args.threshold) : 0.5;
      schema = await inferUnifiedSchema(filePaths, { maxChars, sampleSize, threshold });
    }

    let artifact = null;
    if (save) {
      artifact = writeSchemaArtifact(schema, { cwd });
    }

    return { ...schema, ...(artifact ? { artifact_path: artifact.relativePath } : {}) };
  } catch (error) {
    return { error: `Schema inference failed: ${error.message ?? String(error)}` };
  }
}

export function listSchemaArtifactsTool(args) {
  const cwd = args.cwd ? resolve(String(args.cwd)) : process.cwd();
  try {
    const artifacts = listSchemaArtifacts({ cwd });
    return {
      count: artifacts.length,
      schema_dir: SCHEMA_DIR,
      artifacts: artifacts.map((a) => ({
        path: a.relativePath,
        modified: a.stat.mtime.toISOString(),
        size_bytes: a.stat.size,
      })),
    };
  } catch (error) {
    return { error: `Failed to list schema artifacts: ${error.message ?? String(error)}` };
  }
}
