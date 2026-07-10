/**
 * lib/mcp/tool-definitions-project.mjs — raw tool schemas: project context, diffs, document extraction/ingestion, storage.
 *
 * Pure data: name/description/inputSchema/outputSchema for a slice of the
 * hardcoded (non-self-registered) MCP tool catalog. Split out of
 * lib/mcp/tool-definitions.mjs (which itself was split out of
 * lib/mcp/server.mjs) purely to keep each file under the ~600-line
 * house limit — no behavior differs from one combined array.
 * lib/mcp/server.mjs concatenates every slice and applies
 * withSafetyEnvelope (lib/mcp/tool-safety.mjs) at load time.
 */
export const TOOL_DEFS_PROJECT = [
    {
      name: 'agent_health',
      outputSchema: { type: 'object' },
      description: 'Returns agent health summaries from the most recent performance review.',
      inputSchema: {
        type: 'object',
        properties: {
          agent_name: {
            type: 'string',
            description: 'Specific agent name to filter, or omit for all agents.',
          },
        },
      },
    },
    {
      name: 'summarize_diff',
      outputSchema: { type: 'object' },
      description: 'Summarizes the git diff between the current state and a base ref.',
      inputSchema: {
        type: 'object',
        properties: {
          base_ref: {
            type: 'string',
            description: 'Git ref to diff against (default: HEAD~1).',
          },
          cwd: {
            type: 'string',
            description: 'Working directory for the git command.',
          },
        },
      },
    },
    {
      name: 'scan_file',
      outputSchema: { type: 'object' },
      description: 'Scans a file for secrets and code quality issues.',
      inputSchema: {
        type: 'object',
        properties: {
          file_path: {
            type: 'string',
            description: 'Absolute path to the file to scan.',
          },
        },
        required: ['file_path'],
      },
    },
    {
      name: 'extract_document_text',
      outputSchema: { type: 'object' },
      description: 'Extracts readable text from a local document path. Uses node-native extractors (unpdf/mammoth) first; escalates to the docling Python sidecar or whisper.cpp when needed (same pipeline as `construct ingest`). Supports PDF, DOCX, XLSX, PPTX, HTML, plain text, email, and transcripts.',
      inputSchema: {
        type: 'object',
        properties: {
          file_path: {
            type: 'string',
            description: 'Absolute or relative path to the document file.',
          },
          max_chars: {
            type: 'number',
            description: 'Maximum characters to return (default 20000, hard cap 200000).',
          },
        },
        required: ['file_path'],
      },
    },
    {
      name: 'ingest_document',
      outputSchema: { type: 'object' },
      description: 'Converts a local document into a normalized markdown file, placing it into an indexed project path by default.',
      inputSchema: {
        type: 'object',
        properties: {
          file_path: {
            type: 'string',
            description: 'Absolute or relative path to the source document.',
          },
          out_path: {
            type: 'string',
            description: 'Optional explicit markdown output path.',
          },
          out_dir: {
            type: 'string',
            description: 'Optional directory for generated markdown output files.',
          },
          target: {
            type: 'string',
            description: 'Output mode: knowledge/internal, knowledge/external, knowledge/decisions, knowledge/how-tos, knowledge/reference, or sibling. Defaults to knowledge/internal.',
          },
          cwd: {
            type: 'string',
            description: 'Project root used to resolve default output paths and storage sync.',
          },
          sync: {
            type: 'boolean',
            description: 'When true, sync file-state into configured SQL/vector storage after writing output.',
          },
        },
        required: ['file_path'],
      },
    },
    {
      name: 'infer_document_schema',
      outputSchema: { type: 'object' },
      description: 'Infers a structured field schema from a local document using AI. Returns field names, types, formats, examples, and confidence. Supports all document types handled by extract_document_text. Pass multiple file_paths to get a reconciled unified schema across documents.',
      inputSchema: {
        type: 'object',
        properties: {
          file_path: {
            type: 'string',
            description: 'Absolute or relative path to the document file. For unified inference across multiple documents, use file_paths instead.',
          },
          file_paths: {
            type: 'array',
            items: { type: 'string' },
            description: 'Multiple document paths for unified schema inference. Reconciles fields across all documents.',
          },
          max_chars: {
            type: 'number',
            description: 'Maximum characters of document text to send to the model (default 40000, hard cap 200000).',
          },
          save: {
            type: 'boolean',
            description: 'When true, write the schema result as a .schema.json artifact under .construct/knowledge/reference/schemas/.',
          },
          cwd: {
            type: 'string',
            description: 'Project root used to resolve output paths when save is true.',
          },
          sample_size: {
            type: 'number',
            description: 'For unified inference: max number of documents to sample (default 10).',
          },
          threshold: {
            type: 'number',
            description: 'For unified inference: minimum fraction of documents a field must appear in to be included (default 0.5).',
          },
        },
      },
    },
    {
      name: 'list_schema_artifacts',
      outputSchema: { type: 'object' },
      description: 'Lists all inferred schema artifacts (.schema.json files) in the project.',
      inputSchema: {
        type: 'object',
        properties: {
          cwd: {
            type: 'string',
            description: 'Project directory to search (default: process.cwd()).',
          },
        },
      },
    },
    {
      name: 'storage_status',
      outputSchema: { type: 'object' },
      description: 'Returns SQL, local vector index, and ingested-artifact status for the current project.',
      inputSchema: {
        type: 'object',
        properties: {
          cwd: {
            type: 'string',
            description: 'Project directory to inspect.',
          },
          project: {
            type: 'string',
            description: 'Optional explicit project key for SQL document counts.',
          },
        },
      },
    },
    {
      name: 'storage_sync',
      description: 'Syncs file-state documents into the local vector index and configured SQL storage.',
      inputSchema: {
        type: 'object',
        properties: {
          cwd: {
            type: 'string',
            description: 'Project directory to sync.',
          },
          project: {
            type: 'string',
            description: 'Optional explicit project key.',
          },
        },
      },
    },
    {
      name: 'storage_reset',
      description: 'Resets SQL/vector storage state for a project. Requires explicit confirm=true.',
      inputSchema: {
        type: 'object',
        properties: {
          cwd: {
            type: 'string',
            description: 'Project directory whose storage should be reset.',
          },
          project: {
            type: 'string',
            description: 'Optional explicit project key.',
          },
          reset_sql: {
            type: 'boolean',
            description: 'Set false to keep SQL state intact.',
          },
          reset_vector: {
            type: 'boolean',
            description: 'Set false to keep the local vector index intact.',
          },
          reset_ingested: {
            type: 'boolean',
            description: 'Set true to also delete ingested markdown artifacts under .construct/knowledge/.',
          },
          confirm: {
            type: 'boolean',
            description: 'Must be true or the reset is rejected.',
          },
        },
      },
    },
    {
      name: 'delete_ingested_artifacts',
      description: 'Deletes ingested markdown artifacts. Requires explicit confirm=true and only allows files under the ingested artifact directory.',
      inputSchema: {
        type: 'object',
        properties: {
          cwd: {
            type: 'string',
            description: 'Project directory whose ingested artifacts should be deleted.',
          },
          files: {
            type: 'array',
            description: 'Optional relative file paths under .construct/knowledge/. Omit to delete all ingested markdown artifacts.',
            items: { type: 'string' },
          },
          confirm: {
            type: 'boolean',
            description: 'Must be true or deletion is rejected.',
          },
        },
      },
    },
    {
      name: 'project_context',
      outputSchema: { type: 'object' },
      description: 'Returns project context: .construct/context.md content, recent commits, and working tree status.',
      inputSchema: {
        type: 'object',
        properties: {
          cwd: {
            type: 'string',
            description: 'Project directory (default: process.cwd()).',
          },
        },
      },
    },
];
