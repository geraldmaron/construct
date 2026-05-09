<!--
skills/ai/rag-system.md — RAG System Design — Use this skill when building retrieval-augmented generation pipelines, vector se

Use this skill when building retrieval-augmented generation pipelines, vector search, or knowledge-grounded AI systems. ## Document Processing
-->
# RAG System Design

Use this skill when building retrieval-augmented generation pipelines, vector search, or knowledge-grounded AI systems.

## Document Processing

### Chunking Strategies
- Fixed size: 512-1024 tokens with 10-20% overlap; simple, predictable
- Semantic: split on paragraph, section, or topic boundaries; preserves coherence
- Recursive: try large chunks, split smaller only when needed
- Document-aware: respect headers, tables, code blocks as atomic units
- Always preserve metadata: source, page, section, timestamp

### Preprocessing
- Extract text from PDFs, DOCX, HTML; preserve structure
- Normalize whitespace, encoding, and character sets
- Strip boilerplate (headers, footers, navigation) from web pages
- Deduplicate identical or near-identical chunks
- Handle tables and images: extract text, generate descriptions

## Embedding

- Choose embedding model based on retrieval quality, not just speed
- Match embedding model to chunk size (most optimize for 256-512 tokens)
- Normalize vectors if using cosine similarity
- Benchmark retrieval accuracy on a representative eval set before deploying
- Consider late-interaction models (ColBERT) for higher accuracy at more compute

## Vector Database

| System | Strength |
|---|---|
| Pinecone | Managed, serverless scaling |
| Weaviate | Hybrid search, multi-modal |
| Qdrant | Filtering, payload storage |
| pgvector | Postgres-native, simple deployment |
| Chroma | Local development, lightweight |

### Indexing
- HNSW for high recall with reasonable memory
- IVF for large-scale with memory constraints
- Tune `ef_construction` and `M` parameters for recall vs build time
- Partition by tenant or document collection for isolation

## Retrieval

### Hybrid Search
- Combine dense vector search with sparse keyword search (BM25)
- Use reciprocal rank fusion to merge result lists
- Keyword search catches exact matches that embeddings miss
- Dense search captures semantic similarity that keywords miss

### Reranking
- Cross-encoder reranker on top-k candidates (k=20-50)
- Improves precision significantly at moderate latency cost
- Use a smaller, faster model than the generation LLM

### Query Processing
- Query expansion: rephrase user query into multiple search queries
- HyDE: generate a hypothetical answer, embed it, search with that vector
- Decomposition: break complex queries into sub-queries, retrieve for each
- Filter by metadata when the query implies scope (date, source, category)

## Context Assembly

- Order retrieved chunks by relevance
- Deduplicate overlapping content
- Include source attribution for each chunk
- Respect context window limits; prioritize quality over quantity
- Typical prompt structure: system instructions, retrieved context, user query

## Evaluation

### Retrieval Metrics
- Recall@k: did the relevant chunks appear in top-k results?
- MRR: how high is the first relevant result?
- NDCG: overall ranking quality of returned results

### Generation Metrics
- Faithfulness: does the answer stay grounded in retrieved context?
- Relevance: does the answer address the user's question?
- Completeness: does the answer cover all aspects of the query?
- Hallucination rate: percentage of claims not supported by context

### Eval Process
1. Build a labeled dataset: query + relevant passages + expected answer
2. Measure retrieval quality independent of generation
3. Measure generation quality with gold-standard context
4. Measure end-to-end with the full pipeline
5. Automate eval runs on every pipeline change

## Common Failures

- Chunk too large: dilutes relevance signal
- Chunk too small: loses context needed for coherent answers
- Missing metadata: cannot filter or attribute sources
- No reranking: first-stage retrieval alone has low precision
- No eval: impossible to know if changes improve or degrade quality
- Stale index: documents updated but embeddings not refreshed
