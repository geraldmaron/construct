/**
 * lib/mcp/tools/participation.tool.mjs — self-registered MCP tool
 * (lib/mcp/tool-registry.mjs) for ADR-0070 participation rules
 * (construct-pteo2.16, CLI/MCP/UI parity).
 *
 * One tool, one `action` enum, every action a thin envelope over the same
 * lib/registry/org-api.mjs functions `construct participation` and Org
 * Studio's /api/participation endpoints call — the three surfaces cannot
 * drift because none of them owns any logic. Long-tail (non-core) tool:
 * reachable through the `call` gateway without growing the flat schema
 * surface. Writes land in the project/user tier only; org-api refuses
 * scope 'builtin' at the shared layer.
 */

import {
  listParticipationRules,
  validateParticipationRule,
  upsertParticipationRule,
  removeParticipationRule,
  previewParticipation,
  participationEditorMeta,
} from '../../registry/org-api.mjs';

export const TOOL_DEFS = [
  {
    name: 'participation_rules',
    description:
      'Author and inspect ADR-0070 participation rules (condition -> recruit specialists/teams with role + gate). '
      + 'Actions: list (every declared rule with owner/scope), show (one rule by owner + rule_id), '
      + 'add (validate + upsert a rule onto its owning specialist/team entry), validate (dry-run the same checks add enforces), '
      + 'remove (delete a rule by owner + rule_id, project/user tier), '
      + 'preview (recruited set for a sample request via the live requestSignals + recruiter path), '
      + 'meta (editor vocabulary: watchers, signal keys, role/gate/dimension enums, roster, teams). '
      + 'Identical validation errors to `construct participation` and Org Studio — all three wrap the same org-api writer.',
    inputSchema: {
      type: 'object',
      required: ['action'],
      properties: {
        action: { type: 'string', enum: ['list', 'show', 'add', 'validate', 'remove', 'preview', 'meta'], description: 'The participation operation to perform.' },
        owner: { type: 'string', description: 'Owning specialist or team id the rule attaches to (show/add/validate/remove).' },
        rule_id: { type: 'string', description: 'Rule id (show/remove).' },
        rule: { type: 'object', additionalProperties: true, description: 'The participation rule object (add/validate), schemas/participation-rules.schema.json shape.' },
        request: { type: 'string', description: 'Sample request text (preview).' },
        scope: { type: 'string', enum: ['project', 'user'], description: 'Write tier for add/remove. Default project.' },
      },
    },
    outputSchema: { type: 'object' },
    safety: { class: 'write', filesystem: 'write', network: 'none', process: 'none' },
  },
];

export async function participationRules(args = {}, { cwd = process.cwd() } = {}) {
  const rootDir = cwd;
  const scope = args.scope ?? 'project';

  switch (args.action) {
    case 'list':
      return listParticipationRules({ rootDir });
    case 'show': {
      if (!args.owner || !args.rule_id) return { error: 'show requires "owner" and "rule_id".' };
      const row = listParticipationRules({ rootDir }).items.find((it) => it.owner === args.owner && it.rule.id === args.rule_id);
      return row ?? { error: `No rule "${args.rule_id}" on "${args.owner}".` };
    }
    case 'add':
      if (!args.owner || !args.rule) return { error: 'add requires "owner" and "rule".' };
      return upsertParticipationRule(args.owner, args.rule, { rootDir, scope });
    case 'validate':
      if (!args.owner || !args.rule) return { error: 'validate requires "owner" and "rule".' };
      return validateParticipationRule(args.owner, args.rule, { rootDir });
    case 'remove':
      if (!args.owner || !args.rule_id) return { error: 'remove requires "owner" and "rule_id".' };
      return removeParticipationRule(args.owner, args.rule_id, { rootDir, scope });
    case 'preview':
      if (typeof args.request !== 'string') return { error: 'preview requires "request".' };
      return previewParticipation({ rootDir, request: args.request });
    case 'meta':
      return participationEditorMeta({ rootDir });
    default:
      return { error: `Unknown action "${args.action}".` };
  }
}

export const TOOL_HANDLERS = {
  participation_rules: participationRules,
};
