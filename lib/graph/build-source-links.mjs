/**
 * lib/graph/build-source-links.mjs — artifact-to-source-target provenance
 * edges (construct-wjap9.2).
 *
 * A registered source target (construct.config.json sources.targets[],
 * lib/config/source-targets.mjs) is durable config, but which local
 * artifacts were actually authored FROM one is otherwise unrecorded — the
 * link exists only in a human's memory of "I wrote this PRD after reading
 * that repo." The durable record is a `sources:` frontmatter block on the
 * artifact itself:
 *
 *   ---
 *   sources:
 *     - target: platform-docs
 *       pinned: bbb1234
 *   ---
 *
 * `target` must name a configured source target id; `pinned` is whatever
 * that target's own freshness model uses to mean "the state I was authored
 * against" (a git head sha for a corpus target, a content hash for a
 * directory target) — this module does not interpret it, only carries it
 * onto the edge for a staleness comparison to make later.
 *
 * Read-only: edges re-derive from frontmatter on every `construct graph
 * build`, same as every other lib/graph/build-*.mjs module — the
 * frontmatter block is the durable source of truth; the graph edge is a
 * disposable projection of it. `construct sources link/unlink`
 * (bin/construct) writes the frontmatter; turning it into
 * `doc:<path> --derived_from--> source:<targetId>` edges happens here, the
 * next time the graph regenerates.
 *
 * Scope: docs/specs/prd/**, docs/decisions/adr/**, and
 * .construct/knowledge/** (PRDs, ADRs, and knowledge notes — the concrete,
 * fixed-path artifact categories construct-wjap9's design brief named).
 * Research/evidence briefs land inside .construct/knowledge/ too (`construct
 * knowledge add`), so that one glob covers them without a fourth path.
 */

import { readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { load } from 'js-yaml';

import { nodeId } from './store.mjs';

const ARTIFACT_DIRS = ['docs/specs/prd', 'docs/decisions/adr', '.construct/knowledge'];
const FRONTMATTER_RE = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/;

function walkMarkdownFiles(absDir) {
  const out = [];
  const stack = [absDir];
  while (stack.length) {
    const dir = stack.pop();
    let entries;
    try { entries = readdirSync(dir, { withFileTypes: true }); } catch { continue; }
    for (const entry of entries) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) stack.push(full);
      else if (entry.isFile() && entry.name.endsWith('.md')) out.push(full);
    }
  }
  return out;
}

function readFrontmatter(absPath) {
  let text;
  try { text = readFileSync(absPath, 'utf8'); } catch { return null; }
  const m = text.match(FRONTMATTER_RE);
  if (!m) return null;
  try {
    const fm = load(m[1]);
    return (fm && typeof fm === 'object') ? fm : null;
  } catch {
    return null;
  }
}

/**
 * @param {object} opts
 * @param {string} opts.rootDir — project root to scan (artifact dirs are project-relative)
 * @returns {{ nodes: object[], edges: object[] }}
 */
export function buildSourceLinks({ rootDir = process.cwd() } = {}) {
  const nodes = [];
  const edges = [];
  const seenSourceIds = new Set();

  for (const relDir of ARTIFACT_DIRS) {
    const absDir = path.join(rootDir, relDir);
    let isDir = false;
    try { isDir = statSync(absDir).isDirectory(); } catch { isDir = false; }
    if (!isDir) continue;

    for (const absFile of walkMarkdownFiles(absDir)) {
      const fm = readFrontmatter(absFile);
      const links = Array.isArray(fm?.sources) ? fm.sources : [];
      if (!links.length) continue;

      const relFile = path.relative(rootDir, absFile);
      const docId = nodeId('doc', relFile);
      nodes.push({ id: docId, type: 'doc', name: relFile });

      for (const link of links) {
        const targetId = typeof link === 'string' ? link : link?.target;
        if (!targetId || typeof targetId !== 'string') continue;
        const pinned = (link && typeof link === 'object') ? (link.pinned ?? null) : null;

        const sourceId = nodeId('source', targetId);
        if (!seenSourceIds.has(sourceId)) {
          seenSourceIds.add(sourceId);
          nodes.push({ id: sourceId, type: 'source', name: targetId });
        }

        edges.push({
          from: docId,
          to: sourceId,
          rel: 'derived_from',
          source: 'source-link',
          weight: 1,
          attrs: pinned != null ? { pinned } : undefined,
        });
      }
    }
  }

  return { nodes, edges };
}

export default buildSourceLinks;
