/**
 * cli-commands.mjs — single source of truth for all construct CLI commands.
 *
 * Consumed by:
 *   - bin/construct         (usage text + emoji output)
 *   - lib/completions.mjs   (bash + zsh completion generation)
 *   - lib/server/index.mjs  (/api/status → dashboard)
 */

export const CLI_COMMANDS = [
  // ── Services ──────────────────────────────────────────────────────────
  {
    name: 'up',
    emoji: '🚀',
    category: 'Services',
    description: 'Start services (memory, dashboard)',
    usage: 'construct up',
  },
  {
    name: 'down',
    emoji: '⏹',
    category: 'Services',
    description: 'Stop all running services',
    usage: 'construct down',
  },
  {
    name: 'status',
    emoji: '📡',
    category: 'Services',
    description: 'Show canonical system health across runtime and integrations',
    usage: 'construct status',
    options: [
      { flag: '--json', desc: 'Output full status payload as JSON' },
    ],
  },
  {
    name: 'show',
    emoji: '📊',
    category: 'Services',
    description: 'Show runtime service URLs and live status (compat view)',
    usage: 'construct show',
  },
  {
    name: 'serve',
    emoji: '🌐',
    category: 'Services',
    description: 'Start the Construct dashboard (auto-selects port)',
    usage: 'construct serve',
  },
  {
    name: 'setup',
    emoji: '🛠️',
    category: 'Services',
    description: 'Bootstrap user config after npm or manual install',
    usage: 'construct setup [--yes] [--no-docker]',
    options: [
      { flag: '--yes', desc: 'Apply sensible defaults without pausing for prompts' },
      { flag: '--no-docker', desc: 'Skip managed local Postgres startup' },
    ],
  },

  // ── Agents & Sync ─────────────────────────────────────────────────────
  {
    name: 'sync',
    emoji: '🔄',
    category: 'Agents & Sync',
    description: 'Generate agent adapters for all platforms',
    usage: 'construct sync [--project]',
    options: [
      { flag: '--project', desc: 'Sync to current project directory only' },
    ],
  },
  {
    name: 'list',
    emoji: '📋',
    category: 'Agents & Sync',
    description: 'Show all personas and specialist agents',
    usage: 'construct list',
  },

  // ── Work ──────────────────────────────────────────────────────────────
  {
    name: 'do',
    emoji: '⚡',
    category: 'Work',
    description: 'Execute a natural language goal via the orchestrator',
    usage: 'construct do <goal>',
  },
  {
    name: 'distill',
    emoji: '🔬',
    category: 'Work',
    description: 'Distill documents with query-focused, citation-ready chunk selection',
    usage: 'construct distill <dir> [--format=summary|decisions|full|extract] [--query=TEXT] [--mode=auto|prompt|json] [--out=FILE]',
    options: [
      { flag: '--format=TYPE', desc: 'Output format: summary | decisions | full | extract (default: summary)' },
      { flag: '--query=TEXT',  desc: 'Focus chunk selection and output on a specific question' },
      { flag: '--mode=TYPE',   desc: 'Execution mode: auto | prompt | json (default: auto)' },
      { flag: '--out=FILE',    desc: 'Write output to file instead of stdout' },
      { flag: '--depth=N',     desc: 'Max directory depth to scan (default: 3)' },
      { flag: '--ext=LIST',    desc: 'Comma-separated extensions to include (default: all text)' },
    ],
  },
  {
    name: 'ingest',
    emoji: '📥',
    category: 'Work',
    description: 'Convert PDFs, office docs, spreadsheets, and text files into indexed markdown artifacts',
    usage: 'construct ingest <file-or-dir> [more paths] [--out=FILE] [--out-dir=DIR] [--target=product-intel|sibling] [--sync]',
    options: [
      { flag: '--out=FILE', desc: 'Write a single converted markdown file to an explicit path' },
      { flag: '--out-dir=DIR', desc: 'Directory for generated markdown outputs (default: .cx/product-intel/sources/ingested)' },
      { flag: '--target=MODE', desc: 'Output mode: product-intel | sibling (default: product-intel)' },
      { flag: '--sync', desc: 'After writing markdown files, sync file-state into configured SQL/vector storage' },
    ],
  },
  {
    name: 'research',
    emoji: '🔎',
    category: 'Work',
    description: 'Run query-focused bounded retrieval over project documents',
    usage: 'construct research <query> [--dir=PATH] [--ext=LIST] [--depth=N]',
    options: [
      { flag: '--dir=PATH', desc: 'Directory to search (default: docs)' },
      { flag: '--ext=LIST', desc: 'Comma-separated extensions to include' },
      { flag: '--depth=N', desc: 'Max directory depth to scan (default: 3)' },
    ],
  },
  {
    name: 'docs',
    emoji: '📚',
    category: 'Work',
    description: 'Run documentation-focused bounded retrieval over markdown-like files',
    usage: 'construct docs <query> [--dir=PATH] [--depth=N]',
    options: [
      { flag: '--dir=PATH', desc: 'Directory to search (default: docs)' },
      { flag: '--depth=N', desc: 'Max directory depth to scan (default: 3)' },
    ],
  },
  {
    name: 'search',
    emoji: '🔎',
    category: 'Work',
    description: 'Run hybrid file, SQL, and semantic retrieval over core project state',
    usage: 'construct search <query> [--limit=N]',
    options: [
      { flag: '--limit=N', desc: 'Maximum results to return (default: 10)' },
    ],
  },
  {
    name: 'storage',
    emoji: '🗄️',
    category: 'Work',
    description: 'Sync and inspect the hybrid storage backend',
    usage: 'construct storage <sync|status|reset|delete-ingested>',
    subcommands: [
      { name: 'sync', desc: 'Sync file-state artifacts into shared storage' },
      { name: 'status', desc: 'Show storage backend configuration and health' },
      { name: 'reset', desc: 'Reset SQL/vector state for the current project (requires --yes)' },
      { name: 'delete-ingested', desc: 'Delete ingested markdown artifacts (requires --yes)' },
    ],
  },
  {
    name: 'headhunt',
    emoji: '🧭',
    category: 'Work',
    description: 'Create a temporary domain expertise overlay or promotion request',
    usage: 'construct headhunt <domain> [--for=OBJECTIVE] [--scope=TEXT] [--temp|--save] [--team=a,b] | construct headhunt <list|promote|challenge|cleanup|template>',
    options: [
      { flag: '--for=OBJECTIVE', desc: 'Outcome the domain expertise should support' },
      { flag: '--scope=TEXT', desc: 'Optional scope boundary for the overlay' },
      { flag: '--temp', desc: 'Force temporary overlay mode' },
      { flag: '--save', desc: 'Create a promotion request in addition to the temporary overlay' },
      { flag: '--team=a,b', desc: 'Explicit existing specialists to attach the overlay to' },
      { flag: '--freshness=current|stable', desc: 'Research freshness requirement (default: current)' },
      { flag: 'list', desc: 'List active overlays and promotion requests' },
      { flag: 'promote <id>', desc: 'Create a promotion request from an existing overlay' },
      { flag: 'challenge <id>', desc: 'Update devil\'s advocate challenge status for a promotion request' },
      { flag: 'cleanup', desc: 'Remove expired temporary overlays' },
      { flag: 'template [name] --for=OBJECTIVE', desc: 'Assemble a named team template as a domain overlay' },
    ],
  },
  {
    name: 'workflow',
    emoji: '🗂️',
    category: 'Work',
    description: 'Manage .cx/workflow.json orchestration state',
    usage: 'construct workflow <init|add|task|align|from-plan>',
    subcommands: [
      { name: 'init',      desc: 'Initialize a new workflow' },
      { name: 'add',       desc: 'Add a task to the workflow' },
      { name: 'task',      desc: 'Update a task status' },
      { name: 'align',     desc: 'Check alignment findings' },
      { name: 'from-plan', desc: 'Import tasks from a plan markdown file' },
    ],
  },
  {
    name: 'init-docs',
    emoji: '📝',
    category: 'Work',
    description: 'Generate AI-tailored doc structure for the current project',
    usage: 'construct init-docs [path] [--yes]',
    options: [
      { flag: '--yes', desc: 'Skip interactive questions, use defaults' },
    ],
  },

  // ── Models & Integrations ─────────────────────────────────────────────
  {
    name: 'models',
    emoji: '🧠',
    category: 'Models & Integrations',
    description: 'Show or update model tier assignments',
    usage: 'construct models [--poll|--apply|--reset|--tier=TIER|--set=MODEL|--prefer-free|--prefer-free-same-family]',
    options: [
      { flag: '--poll',        desc: 'Query OpenRouter for currently free models' },
      { flag: '--apply',       desc: 'Auto-apply best free models and sync' },
      { flag: '--reset',       desc: 'Remove model overrides, restore defaults' },
      { flag: '--tier=TIER',   desc: 'Target tier: reasoning | standard | fast' },
      { flag: '--set=MODEL_ID',desc: 'Set specific model for the tier' },
      { flag: '--prefer-free', desc: 'When inferring sibling tiers, prefer free models where possible' },
      { flag: '--prefer-free-same-family', desc: 'Prefer free siblings only when they stay in the same provider family' },
    ],
  },
  {
    name: 'mcp',
    emoji: '🔌',
    category: 'Models & Integrations',
    description: 'Manage MCP integrations',
    usage: 'construct mcp <list|add|remove|info> [name]',
    subcommands: [
      { name: 'list',   desc: 'Show all MCP integrations and status' },
      { name: 'add',    desc: 'Add an MCP integration interactively' },
      { name: 'remove', desc: 'Remove an MCP integration' },
      { name: 'info',   desc: 'Show setup details for an integration' },
    ],
  },
  {
    name: 'hosts',
    emoji: '🖥️',
    category: 'Models & Integrations',
    description: 'Show host support for Construct orchestration',
    usage: 'construct hosts',
  },

  // ── Observability ─────────────────────────────────────────────────────
  {
    name: 'review',
    emoji: '📈',
    category: 'Observability',
    description: 'Generate agent performance review from Langfuse trace backend',
    usage: 'construct review [--days=N] [--agent=NAME] [--schedule]',
    options: [
      { flag: '--days=N',      desc: 'Review window in days (default: 30)' },
      { flag: '--agent=NAME',  desc: 'Filter to a specific agent' },
      { flag: '--out=PATH',    desc: 'Output directory' },
      { flag: '--json-only',   desc: 'Write raw JSON only, skip markdown report' },
      { flag: '--schedule',    desc: 'Schedule automatic weekly reviews' },
      { flag: '--cadence=CRON',desc: 'Cron expression for --schedule (default: Monday 9am)' },
    ],
  },
  {
    name: 'optimize',
    emoji: '⚙️',
    category: 'Observability',
    description: 'Prompt optimization using Langfuse trace quality scores',
    usage: 'construct optimize <agent> [--dry-run] [--list]',
    options: [
      { flag: '--dry-run',       desc: 'Preview changes without applying' },
      { flag: '--list',          desc: 'Show all agents with quality scores' },
      { flag: '--threshold=N',   desc: 'Quality threshold to trigger optimization (default: 0.7)' },
      { flag: '--days=N',        desc: 'Trace window in days (default: 7)' },
      { flag: '--min-traces=N',  desc: 'Minimum traces required (default: 20)' },
    ],
  },
  {
    name: 'telemetry-backfill',
    emoji: '🩹',
    category: 'Observability',
    description: 'Backfill sparse traces with observations (trace backend)',
    usage: 'construct telemetry-backfill [--limit=N]',
    options: [
      { flag: '--limit=N', desc: 'Maximum sparse traces to backfill (default: 10)' },
      { flag: '--best-effort', desc: 'Skip failures instead of exiting non-zero' },
    ],
  },
  {
    name: 'cost',
    emoji: '💰',
    category: 'Observability',
    description: 'Show token usage, cost, cache read rate, and per-agent breakdown',
    usage: 'construct cost [--days=N] [--agent=NAME] [--reset] [--json]',
    options: [
      { flag: '--days=N',     desc: 'Limit report to last N days' },
      { flag: '--agent=NAME', desc: 'Filter to a specific agent (e.g. cx-engineer)' },
      { flag: '--reset',      desc: 'Clear the cost log' },
      { flag: '--json',       desc: 'Output raw JSON' },
    ],
  },
  {
    name: 'efficiency',
    emoji: '🧮',
    category: 'Observability',
    description: 'Show read efficiency, repeated files, and context-budget guidance',
    usage: 'construct efficiency [--json]',
    options: [
      { flag: '--json', desc: 'Output raw JSON' },
    ],
  },
  {
    name: 'evals',
    emoji: '🧪',
    category: 'Observability',
    description: 'Show evaluator catalog for prompt and agent experiments',
    usage: 'construct evals [--json]',
    options: [
      { flag: '--json', desc: 'Output raw JSON' },
    ],
  },

  // ── Teams & Audit ────────────────────────────────────────────────────
  {
    name: 'team',
    emoji: '👥',
    category: 'Work',
    description: 'Team review and template listing',
    usage: 'construct team <review|templates>',
    subcommands: [
      { name: 'review',    desc: 'Run telemetry-backed team performance review' },
      { name: 'templates', desc: 'List available team templates from agents/teams.json' },
    ],
  },
  {
    name: 'audit',
    emoji: '🔍',
    category: 'Diagnostics',
    description: 'Audit Construct internals and review the mutation trail',
    usage: 'construct audit <skills|trail>',
    subcommands: [
      { name: 'skills', desc: 'Audit skill files for stub headers, broken references, and missing content' },
      { name: 'trail',  desc: 'Show the append-only audit trail of every mutation (agent, task, file, hash). Supports --verify, --agent, --tool, --since, --json.' },
    ],
  },
  {
    name: 'drop',
    emoji: '📥',
    category: 'Work',
    description: 'Ingest the most recent file dropped into ~/Downloads, Desktop, Documents, or iCloud Drive',
    usage: 'construct drop [--list] [--index N] [--type ext] [--since 1h]',
    subcommands: [],
  },
  {
    name: 'wireframe',
    emoji: '✏️',
    category: 'Work',
    description: 'Generate a low-fi wireframe (Mermaid diagram or sketch-style HTML) from a description',
    usage: 'construct wireframe "<description>" [--type flow|state|sequence|er|layout|user-journey]',
    subcommands: [],
  },
  {
    name: 'skills',
    emoji: '🎯',
    category: 'Diagnostics',
    description: 'Detect project tech stack and scope installed skills to relevance',
    usage: 'construct skills <scope|apply>',
    subcommands: [
      { name: 'scope', desc: 'Detect stack from filesystem signals; classify installed skills as relevant/irrelevant/unmapped' },
      { name: 'apply', desc: 'Write per-host skill filter configs so this project disables irrelevant skills. Use --host claude|opencode|codex|all. Respects construct safeguards.' },
    ],
  },

  // ── Docs ──────────────────────────────────────────────────────────────
  {
    name: 'docs:update',
    emoji: '📄',
    category: 'Docs',
    description: 'Regenerate AUTO-managed regions in README and docs/',
    usage: 'construct docs:update [--check]',
    options: [
      { flag: '--check', desc: 'Exit non-zero if any region would change (used by CI)' },
    ],
  },
  {
    name: 'docs:site',
    emoji: '🌐',
    category: 'Docs',
    description: 'Generate site/docs/ content for the MkDocs GitHub Pages site',
    usage: 'construct docs:site',
  },
  {
    name: 'lint:comments',
    emoji: '🗒️',
    category: 'Docs',
    description: 'Check all files against the comment policy (rules/common/comments.md)',
    usage: 'construct lint:comments [--fix]',
    options: [
      { flag: '--fix', desc: 'Insert stub headers for files missing one' },
    ],
  },
  {
    name: 'lint:research',
    emoji: '🔍',
    category: 'Docs',
    description: 'Check research and evidence artifacts for minimum structure and evidence metadata',
    usage: 'construct lint:research',
  },

  // ── Diagnostics ───────────────────────────────────────────────────────
  {
    name: 'doctor',
    emoji: '🩺',
    category: 'Diagnostics',
    description: 'Run installation health checks',
    usage: 'construct doctor',
  },
  {
    name: 'validate',
    emoji: '✅',
    category: 'Diagnostics',
    description: 'Validate registry.json structure and field constraints',
    usage: 'construct validate',
  },
  {
    name: 'diff',
    emoji: '📍',
    category: 'Diagnostics',
    description: 'Show which agents changed prompts or settings since HEAD',
    usage: 'construct diff',
  },
  {
    name: 'version',
    emoji: 'ℹ️',
    category: 'Diagnostics',
    description: 'Show version',
    usage: 'construct version',
  },
];

/** Flat list of all top-level command names (for completions). */
export const COMMAND_NAMES = CLI_COMMANDS.map(c => c.name);

/** Commands grouped by category, preserving order within each group. */
export const CLI_COMMANDS_BY_CATEGORY = CLI_COMMANDS.reduce((acc, cmd) => {
  const cat = cmd.category ?? 'Other';
  if (!acc[cat]) acc[cat] = [];
  acc[cat].push(cmd);
  return acc;
}, {});

/** Canonical category display order. */
export const CATEGORY_ORDER = [
  'Services',
  'Agents & Sync',
  'Work',
  'Models & Integrations',
  'Observability',
  'Docs',
  'Diagnostics',
];
