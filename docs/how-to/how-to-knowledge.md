<!--
docs/how-to/how-to-knowledge.md — How to query and manage the knowledge base.

Covers construct ask, construct search, construct knowledge, construct ingest,
and construct storage.
-->

# How to Query and Manage the Knowledge Base

Construct's knowledge layer is a hybrid store: BM25 + cosine vector search over indexed
markdown chunks stored in a local SQLite file and an optional vector index. All operations
work offline.

## Ask a question

```bash
construct ask "what is the retry policy for the embed daemon?"
```

Runs hybrid retrieval over indexed observations, artifacts, and doc chunks. Returns an answer
with cited sources and relevance scores.

Useful flags:

| Flag | Effect |
|---|---|
| `--json` | Output raw retrieval hits as JSON |
| `--top=N` | Return top N chunks (default: 5) |

## Search by keyword

```bash
construct search "storage backend"
```

Runs file, SQL, and semantic retrieval over core project state. Returns matching observations,
docs, and snapshots with snippet previews.

## View knowledge trends

```bash
construct knowledge trends
```

Shows recurring patterns across stored observations — which roles are most active, which
categories recur most, and which observations have been retrieved most often.

## Rebuild the knowledge index

```bash
construct knowledge index
```

Re-indexes all observations, artifacts, and snapshots from the local store. Run after bulk
ingest operations or after manually editing `.cx/knowledge/` files.

## Ingest a document

```bash
construct ingest report.pdf
construct ingest ./meeting-notes/ --target=knowledge/decisions
```

Converts PDFs, DOCX, XLSX, and plain text into indexed markdown artifacts under `.cx/knowledge/`.
The `--sync` flag also writes chunks into the vector index immediately.

| Flag | Effect |
|---|---|
| `--target=MODE` | Destination lane: `knowledge/internal`, `knowledge/external`, `knowledge/decisions`, `knowledge/how-tos`, `knowledge/reference` |
| `--out-dir=DIR` | Override output directory |
| `--sync` | Write chunks to vector index after conversion |

## Drop a recently downloaded file

```bash
construct drop
```

Ingests the most recent file dropped into `~/Downloads`, Desktop, Documents, or iCloud Drive.
Useful for quickly indexing a PDF or spreadsheet without specifying its full path.

| Flag | Effect |
|---|---|
| `--list` | Show recent droppable files instead of ingesting |
| `--index N` | Pick the Nth file from the list |
| `--since 1h` | Limit to files modified within the last hour |

## Inspect storage state

```bash
construct storage
```

Shows SQL and vector index status: row counts, last sync time, index size, and any sync errors.

```bash
construct storage --sync
```

Forces a full re-sync of file-state into SQL and vector storage.
