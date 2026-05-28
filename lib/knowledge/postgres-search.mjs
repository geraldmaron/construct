/**
 * lib/knowledge/postgres-search.mjs — Tag-aware vector search via pgvector + GIN.
 *
 * Runs when DATABASE_URL is configured. Chooses between two execution paths
 * based on tag selectivity:
 *
 * - High selectivity (tag matches <5% of corpus): GIN prefilter first, then
 *   HNSW ANN on the filtered set.
 * - Low selectivity (tag matches ≥5% of corpus): HNSW ANN first with
 *   hnsw.iterative_scan=relaxed_order, postfilter by tag.
 *
 * Falls back gracefully when DATABASE_URL is absent or the pgvector extension
 * is not installed; callers should use knowledgeSearch() from search.mjs in
 * that case.
 */

// Selectivity threshold: if the tagged fraction exceeds this, use postfilter.
const HIGH_SELECTIVITY_THRESHOLD = 0.05;

/**
 * Execute a tag-filtered vector search against Postgres + pgvector.
 *
 * @param {object} opts
 * @param {Float32Array|number[]} opts.queryEmbedding   — query vector
 * @param {string}   opts.project       — project id (construct_documents.project)
 * @param {string[]} [opts.tags]        — tag filter
 * @param {'any'|'all'} [opts.tagMatch] — 'any' (default) or 'all'
 * @param {number}   [opts.topK]        — result limit (default 20)
 * @param {object}   opts.db            — postgres client (from lib/db.mjs or postgres pkg)
 * @returns {Promise<Array<{id, title, score}>>}
 */
export async function postgresTagSearch({ queryEmbedding, project, tags = [], tagMatch = 'any', topK = 20, db }) {
  if (!db) throw new Error('postgres-search: db client required');
  if (!queryEmbedding?.length) throw new Error('postgres-search: queryEmbedding required');

  const vecLiteral = `[${Array.from(queryEmbedding).join(',')}]`;

  if (!tags.length) {
    // No tag filter — plain ANN.
    const rows = await db`
      select d.id, d.title, e.embedding <=> ${vecLiteral}::vector as distance
      from construct_embeddings e
      join construct_documents d on d.id = e.document_id
      where d.project = ${project}
      order by e.embedding <=> ${vecLiteral}::vector
      limit ${topK}
    `;
    return rows.map((r) => ({ id: r.id, title: r.title, score: 1 - parseFloat(r.distance) }));
  }

  // Estimate selectivity for this tag set.
  const tagJsonb = JSON.stringify(tags);
  const [{ total }] = await db`select count(*) as total from construct_documents where project = ${project}`;
  const totalCount = parseInt(total, 10) || 1;

  let taggedCount;
  if (tagMatch === 'all') {
    const [{ cnt }] = await db`
      select count(*) as cnt from construct_documents
      where project = ${project} and tags @> ${tagJsonb}::jsonb
    `;
    taggedCount = parseInt(cnt, 10);
  } else {
    // 'any' — count docs with at least one matching tag.
    const [{ cnt }] = await db`
      select count(*) as cnt from construct_documents
      where project = ${project}
        and (${db.unsafe(tags.map((_, i) => `tags ? $${i + 2}`).join(' or '))})
    `;
    taggedCount = parseInt(cnt, 10);
  }

  const selectivity = taggedCount / totalCount;

  if (selectivity < HIGH_SELECTIVITY_THRESHOLD) {
    // High selectivity: GIN prefilter → ANN on filtered set.
    if (tagMatch === 'all') {
      const rows = await db`
        with filtered as (
          select id from construct_documents
          where project = ${project} and tags @> ${tagJsonb}::jsonb
        )
        select d.id, d.title, e.embedding <=> ${vecLiteral}::vector as distance
        from construct_embeddings e
        join filtered f on f.id = e.document_id
        join construct_documents d on d.id = e.document_id
        order by e.embedding <=> ${vecLiteral}::vector
        limit ${topK}
      `;
      return rows.map((r) => ({ id: r.id, title: r.title, score: 1 - parseFloat(r.distance) }));
    }
    // 'any' — OR-expand tag list.
    const tagConditions = tags.map((t) => `tags ? '${t.replace(/'/g, "''")}'`).join(' or ');
    const rows = await db.unsafe(`
      with filtered as (
        select id from construct_documents
        where project = $1 and (${tagConditions})
      )
      select d.id, d.title, e.embedding <=> $2::vector as distance
      from construct_embeddings e
      join filtered f on f.id = e.document_id
      join construct_documents d on d.id = e.document_id
      order by e.embedding <=> $2::vector
      limit $3
    `, [project, vecLiteral, topK]);
    return rows.map((r) => ({ id: r.id, title: r.title, score: 1 - parseFloat(r.distance) }));
  }

  // Low selectivity: HNSW iterative scan → postfilter.
  await db`set hnsw.iterative_scan = relaxed_order`;
  if (tagMatch === 'all') {
    const rows = await db`
      select d.id, d.title, e.embedding <=> ${vecLiteral}::vector as distance
      from construct_embeddings e
      join construct_documents d on d.id = e.document_id
      where d.project = ${project} and d.tags @> ${tagJsonb}::jsonb
      order by e.embedding <=> ${vecLiteral}::vector
      limit ${topK}
    `;
    return rows.map((r) => ({ id: r.id, title: r.title, score: 1 - parseFloat(r.distance) }));
  }
  const tagConditions = tags.map((t) => `d.tags ? '${t.replace(/'/g, "''")}'`).join(' or ');
  const rows = await db.unsafe(`
    select d.id, d.title, e.embedding <=> $1::vector as distance
    from construct_embeddings e
    join construct_documents d on d.id = e.document_id
    where d.project = $2 and (${tagConditions})
    order by e.embedding <=> $1::vector
    limit $3
  `, [vecLiteral, project, topK]);
  return rows.map((r) => ({ id: r.id, title: r.title, score: 1 - parseFloat(r.distance) }));
}
