#!/usr/bin/env node
/**
 * lib/storage/state-source.mjs — normalize file-state artifacts for hybrid retrieval.
 */
import { existsSync, readdirSync, statSync, readFileSync } from 'node:fs';
import { basename, extname, join, relative } from 'node:path';
import { EXTRACTABLE_DOCUMENT_EXTS, extractDocumentText } from '../document-extract.mjs';

function readJsonIfExists(filePath) {
  if (!existsSync(filePath)) return null;
  try {
    return JSON.parse(readFileSync(filePath, 'utf8'));
  } catch {
    return null;
  }
}

function readTextIfExists(filePath) {
  if (!existsSync(filePath)) return null;
  try {
    return readFileSync(filePath, 'utf8');
  } catch {
    return null;
  }
}

function titleFromPath(filePath) {
  return basename(filePath, extname(filePath)).replace(/[-_]+/g, ' ');
}

function collectTextFiles(rootDir, dirs, { extensions = EXTRACTABLE_DOCUMENT_EXTS } = {}) {
  const files = [];
  for (const dir of dirs) {
    const abs = join(rootDir, dir);
    if (!existsSync(abs)) continue;
    const stack = [abs];
    while (stack.length > 0) {
      const current = stack.pop();
      for (const entry of readdirSync(current, { withFileTypes: true })) {
        const full = join(current, entry.name);
        if (entry.isDirectory()) {
          stack.push(full);
          continue;
        }
        const extension = extname(entry.name).toLowerCase();
        if (!entry.isFile() || !extensions.has(extension)) continue;
        try {
          const stat = statSync(full);
          if (stat.size > 5_000_000) continue;
          const body = extractDocumentText(full, { maxChars: 200_000 }).text;
          files.push({
            path: relative(rootDir, full),
            title: titleFromPath(full),
            body,
          });
        } catch {
          // Ignore unreadable files in optional product intelligence folders.
        }
      }
    }
  }
  return files.sort((a, b) => a.path.localeCompare(b.path));
}

export function loadStateSnapshot(rootDir) {
  const contextJsonPath = join(rootDir, '.cx', 'context.json');
  const planPath = join(rootDir, 'plan.md');
  const architecturePath = join(rootDir, 'docs', 'architecture.md');
  const docsReadmePath = join(rootDir, 'docs', 'README.md');
  const productIntelDocs = collectTextFiles(rootDir, [
    '.cx/product-intel',
    'docs/prd',
    'docs/meta-prd',
  ]);

  return {
    context: readJsonIfExists(contextJsonPath),
    plan: readTextIfExists(planPath),
    architecture: readTextIfExists(architecturePath),
    docsReadme: readTextIfExists(docsReadmePath),
    productIntelDocs,
    paths: {
      contextJsonPath,
      planPath,
      architecturePath,
      docsReadmePath,
    },
  };
}

export function summarizeStateSnapshot(snapshot) {
  return {
    contextSummary: snapshot.context?.contextSummary ?? snapshot.context?.summary ?? null,
    hasPlan: Boolean(snapshot.plan),
    lastContextSavedAt: snapshot.context?.savedAt ?? null,
    hasArchitectureDoc: Boolean(snapshot.architecture),
    hasDocsReadme: Boolean(snapshot.docsReadme),
    productIntelDocCount: snapshot.productIntelDocs?.length ?? 0,
  };
}
