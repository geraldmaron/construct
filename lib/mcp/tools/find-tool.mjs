/**
 * lib/mcp/tools/find-tool.mjs — find_tool: intent-driven tool discovery.
 *
 * Ranks the tool catalog against a natural-language query so an agent that knows
 * what it wants to do, but not the exact tool name, gets the right tools with
 * their schemas. Hybrid scoring: normalized BM25 (always, offline) merged with
 * local-embedding cosine when a real semantic model is available. Degraded
 * hashing embeddings are ignored so they cannot pollute the lexical ranking.
 */
import { rankByBm25, cosineSimilarity } from '../../storage/embeddings.mjs';

let toolVectorCache = null;

function buildCorpus(toolDefs) {
  return toolDefs.map((t) => ({
    name: t.name,
    description: t.description || '',
    inputSchema: t.inputSchema,
    text: `${t.name} ${t.description || ''}`,
  }));
}

async function mergeCosine(scoreMap, corpus, query, env) {
  const { embedText, embedBatch } = await import('../../storage/embeddings-engine.mjs');
  const q = await embedText(query, { env });

  // A degraded result means the real model was unavailable and hashing stood in;
  // those vectors carry no semantic signal, so leave the BM25 ranking unmerged.

  if (q?.degraded || !q?.embedding) return;

  // Embed the catalog once per process: the tool set is static for the server's
  // lifetime, so size-equality is a sufficient cache key. If tools ever become
  // dynamic (MCP list_changed), this needs a real version key. embedBatch
  // degrades all-or-nothing, so one degraded vector means the whole batch fell
  // back to hashing — skip the merge rather than mix real and hashed vectors.

  if (!toolVectorCache || toolVectorCache.size !== corpus.length) {
    const vecs = await embedBatch(corpus.map((c) => c.text), { env });
    if (vecs.some((v) => v?.degraded)) return;
    toolVectorCache = new Map(corpus.map((c, i) => [c.name, vecs[i].embedding]));
  }
  for (const c of corpus) {
    const cos = cosineSimilarity(q.embedding, toolVectorCache.get(c.name) || []);
    if (cos > 0.05) scoreMap.set(c.name, Math.max(scoreMap.get(c.name) || 0, cos));
  }
}

export async function findTool(args = {}, { toolDefs = [], env = process.env } = {}) {
  const query = String(args.query || args.intent || '').trim();
  if (!query) return { error: 'find_tool requires a `query` describing what you want to do.' };
  const limit = Math.min(Math.max(Number(args.limit) || 5, 1), 20);

  const corpus = buildCorpus(toolDefs);

  // BM25 is unbounded; normalize against its own max so it merges fairly with
  // cosine on [0,1].

  const bm25 = rankByBm25(corpus, query, { limit: 20 });
  const bm25Max = bm25[0]?.score || 1;
  const scoreMap = new Map();
  for (const d of bm25) scoreMap.set(d.name, Math.min(d.score / bm25Max, 1));

  try {
    await mergeCosine(scoreMap, corpus, query, env);
  } catch {
    /* embeddings unavailable — BM25-only is the offline-safe path */
  }

  const byName = new Map(corpus.map((c) => [c.name, c]));
  const tools = [...scoreMap.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, limit)
    .map(([name, score]) => ({
      name,
      description: byName.get(name).description,
      inputSchema: byName.get(name).inputSchema,
      score: Number(score.toFixed(3)),
    }));

  return {
    query,
    tools,
    note: 'Invoke a result with { name: "call", arguments: { tool: "<name>", args: {…} } }, or call it directly if it is already a flat tool.',
  };
}
