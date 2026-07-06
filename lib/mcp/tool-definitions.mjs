/**
 * lib/mcp/tool-definitions.mjs — raw MCP tool schema catalog (hardcoded, non-self-registered tools).
 *
 * Pure data: name/description/inputSchema/outputSchema for every tool that
 * isn't self-registered via lib/mcp/tools/*.mjs's TOOL_DEFS convention (see
 * lib/mcp/tool-registry.mjs). Extracted from lib/mcp/server.mjs so the
 * dispatcher module stays readable; server.mjs applies withSafetyEnvelope
 * (lib/mcp/tool-safety.mjs classifications) to this array at load time.
 *
 * The catalog itself is split across tool-definitions-{project,skills,memory,
 * workflow}.mjs to keep each file under the ~600-line house limit; this
 * module concatenates them back into one array so callers see no difference
 * from a single combined catalog.
 */
import { TOOL_DEFS_PROJECT } from './tool-definitions-project.mjs';
import { TOOL_DEFS_SKILLS } from './tool-definitions-skills.mjs';
import { TOOL_DEFS_MEMORY } from './tool-definitions-memory.mjs';
import { TOOL_DEFS_WORKFLOW } from './tool-definitions-workflow.mjs';

export const RAW_HARDCODED_TOOL_DEFS = [
  ...TOOL_DEFS_PROJECT,
  ...TOOL_DEFS_SKILLS,
  ...TOOL_DEFS_MEMORY,
  ...TOOL_DEFS_WORKFLOW,
];
