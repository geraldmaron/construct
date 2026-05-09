<!--
docs/how-to/how-to-distill-infer.md — How to use construct distill and construct infer.

Covers distilling a directory of documents with query-focused chunk selection
and inferring structured field schemas from one or more documents.
-->

# How to Use Distill and Infer

## Distill a directory

`construct distill` reads a directory of markdown, code, or text files and returns a
context-budget-friendly summary focused on a specific question.

```bash
construct distill docs/
construct distill docs/ --query="what are the accepted ADR decisions?"
```

Without `--query`, it produces a general summary. With `--query`, chunk selection is focused on
answering that question specifically — useful before a long coding session to pre-load only
the relevant context.

### Output formats

```bash
construct distill docs/ --format=summary       # default: paragraph summary
construct distill docs/ --format=decisions     # bullet list of decisions only
construct distill docs/ --format=full          # all chunks, ranked by relevance
construct distill docs/ --format=extract       # raw chunk text, no synthesis
```

### Write output to a file

```bash
construct distill docs/ --query="storage layer" --out=.cx/distill-storage.md
```

The file can be passed as context to a fresh agent session or committed alongside a plan.

### Control scan depth and file types

```bash
construct distill src/ --depth=2 --ext=ts,tsx
```

`--depth` limits directory recursion. `--ext` restricts to specific extensions.

---

## Infer a document schema

`construct infer` sends a document (or a batch of documents) to the model and returns a
structured field schema — field names, types, formats, examples, and confidence scores.

### Single document

```bash
construct infer docs/prd/prd-001-storage.md
```

Output is a JSON schema printed to stdout.

### Multiple documents (unified schema)

```bash
construct infer docs/prd/*.md --unified
```

Reconciles fields across all matched files. Fields that appear in fewer than 50% of documents
are excluded by default.

| Flag | Effect |
|---|---|
| `--unified` | Reconcile fields across multiple files into one schema |
| `--max-chars=N` | Max characters per document sent to the model (default: 40000) |
| `--sample=N` | Max documents to sample in unified mode (default: 10) |
| `--threshold=0.5` | Field inclusion threshold for unified mode (0.0–1.0) |

### Save the schema as an artifact

The MCP tool `infer_document_schema` accepts a `save: true` flag that writes the result to
`.cx/knowledge/reference/schemas/<name>.schema.json`. This is not available via the CLI flag
yet — use the MCP surface directly when saving to the schema registry is needed.
