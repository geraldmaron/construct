/**
 * lib/mcp/tools/artifact-author.mjs — MCP `author_artifact` tool.
 *
 * Opencode-reachable equivalent of the native chat `/loop` author pass: the
 * calling agent is the model and supplies the drafted typed-artifact markdown,
 * which gets materialized to its canonical path and run through the release gate.
 * Returns the path and a structured verdict so the agent can fix and re-call.
 * allowScaffold stays off — a real draft is required, never an empty scaffold.
 */
import { runConstructArtifactLoop } from '../../artifact-loop-core.mjs';

export async function authorArtifact(args = {}, { ROOT_DIR } = {}) {
  const draftMarkdown = args.draft_markdown || args.draft || '';
  const cwd = args.cwd || process.cwd();
  const result = await runConstructArtifactLoop({
    draftMarkdown,
    artifactType: args.artifact_type,
    text: args.subject || args.text || '',
    cwd,
    rootDir: ROOT_DIR,
    explicit: true,
    allowScaffold: false,
  });

  return {
    ok: Boolean(result.ok),
    artifact_type: result.artifactType,
    path: result.relPath,
    written: !result.draftMissing,
    gate: result.validation?.ok ? 'PASS' : 'FAIL',
    errors: result.validation?.errors || [],
    warnings: result.validation?.warnings || [],
    workflow_plan: (result.invokePlan?.selectedRoles || []).map((r) => `cx-${r}`),
    summary: result.summary,
  };
}
