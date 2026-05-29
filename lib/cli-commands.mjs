/**
 * cli-commands.mjs — single source of truth for all construct CLI commands.
 *
 * Consumed by:
 *   - bin/construct         (usage text + emoji output)
 *   - lib/completions.mjs   (bash + zsh completion generation)
 *   - lib/server/index.mjs  (/api/status → dashboard)
 *
 * Command Visibility:
 *   - core: true → shown in default --help (90% of users)
 *   - core: false → hidden unless --all flag (advanced/internal commands)
 */

export const CLI_COMMANDS = [
  // ── Core (shown by default) ───────────────────────────────────────────
  {
    name: 'dev',
    emoji: '🚀',
    category: 'Core',
    core: true,
    description: 'Start services for development',
    usage: 'construct dev',
  },
  {
    name: 'stop',
    emoji: '⏹',
    category: 'Core',
    core: true,
    description: 'Stop all running services',
    usage: 'construct stop',
  },
  {
    name: 'status',
    emoji: '📡',
    category: 'Core',
    core: true,
    description: 'Show system health and credentials',
    usage: 'construct status',
    options: [
      { flag: '--json', desc: 'Output full status payload as JSON' },
    ],
  },
  {
    name: 'install',
    emoji: '🛠️',
    category: 'Core',
    core: true,
    description: 'Machine setup: install Docker, cm, and bootstrap config',
    usage: 'construct install [--yes]',
    options: [
      { flag: '--yes', desc: 'Apply defaults without prompts' },
    ],
  },
  {
    name: 'init',
    emoji: '🏗️',
    category: 'Core',
    core: true,
    description: 'Initialize project and start services',
    usage: 'construct init [path] [options]',
    options: [
      { flag: '--yes', desc: 'Accept all defaults (non-interactive)' },
      { flag: '--no-start', desc: 'Do not start services after init' },
      { flag: '--interactive, -i', desc: 'Enable interactive setup with project detection' },
      { flag: '--quiet, -q', desc: 'Minimal output' },
      { flag: '--verbose, -v', desc: 'Detailed output' },
      { flag: '--with-docs=adrs,rfcs', desc: 'Enable specific doc lanes (comma-separated)' },
      { flag: '--with-all-docs', desc: 'Enable all documentation lanes' },
      { flag: '--with-adrs', desc: 'Enable Architecture Decision Records' },
      { flag: '--with-rfcs', desc: 'Enable RFCs (design reviews)' },
      { flag: '--with-runbooks', desc: 'Enable operational runbooks' },
      { flag: '--with-postmortems', desc: 'Enable incident postmortems' },
      { flag: '--with-architecture', desc: 'Create architecture.md' },
    ],
  },
  {
    name: 'sync',
    emoji: '🔄',
    category: 'Core',
    core: true,
    description: 'Sync agent adapters to AI tools',
    usage: 'construct sync [--project] [--dry-run] [--no-docs] [--compress-personas]',
    options: [
      { flag: '--project', desc: 'Write project-local Claude adapters into the current repo only' },
      { flag: '--dry-run', desc: 'Preview adapter changes without writing files' },
      { flag: '--no-docs', desc: 'Skip AUTO docs regeneration after syncing adapters' },
      { flag: '--compress-personas', desc: 'Write compressed runtime persona prompts without changing the source prompts' },
    ],
  },
  {
    name: 'intake',
    emoji: '📥',
    category: 'Core',
    core: true,
    description: 'View and process the active profile\'s intake queue (queue label varies by profile)',
    usage: 'construct intake list|show|done|skip',
  },
  {
    name: 'recommendations',
    emoji: '💡',
    category: 'Core',
    core: true,
    description: 'View and manage artifact recommendations',
    usage: 'construct recommendations list|show|dismiss|stats',
  },
  {
    name: 'integrations',
    emoji: '🔗',
    category: 'Work',
    core: false,
    description: 'Check and manage external system connections',
    usage: 'construct integrations status',
    subcommands: [
      { name: 'status', desc: 'Check which external integrations are configured' },
    ],
  },
  {
    name: 'customer',
    emoji: '👤',
    category: 'Work',
    core: false,
    description: 'Manage customer profiles for product intelligence',
    usage: 'construct customer list|show|add|update|search',
    subcommands: [
      { name: 'list', desc: 'List all customer profiles' },
      { name: 'show <id>', desc: 'Show a customer profile' },
      { name: 'add --name=Acme --owner=Jane', desc: 'Create a new customer profile' },
      { name: 'search <query>', desc: 'Search customer profiles by name/alias' },
    ],
  },
  {
    name: 'knowledge',
    emoji: '🧠',
    category: 'Work',
    core: false,
    description: 'Query, index, or add to the project knowledge base',
    usage: 'construct knowledge trends|index|add',
    subcommands: [
      { name: 'trends', desc: 'Show trend report across observations and artifacts' },
      { name: 'index', desc: 'Rebuild the local RAG corpus over .cx/ artifacts' },
      { name: 'add --source=research --slug=<id> --topic="..." [--source-url=<url>]', desc: 'Persist a research finding into .cx/knowledge/external/research/' },
    ],
  },
  {
    name: 'sandbox',
    emoji: '🧪',
    category: 'Core',
    core: true,
    description: 'Isolated tmpdir-based environment for QA / specialist dry-runs',
    usage: 'construct sandbox create|list|delete|prune [--profile=<id>]',
    subcommands: [
      { name: 'create [--profile=<id>]', desc: 'Create a new sandbox under ~/.cx/sandboxes/' },
      { name: 'list', desc: 'List existing sandboxes, newest first' },
      { name: 'delete <id>', desc: 'Remove one sandbox by id' },
      { name: 'prune [--days=N]', desc: 'Remove sandboxes older than N days (default 7)' },
    ],
  },
  {
    name: 'profile',
    emoji: '🧭',
    category: 'Core',
    core: true,
    description: 'Manage the active org profile and its lifecycle (draft, promote, archive, health)',
    usage: 'construct profile show|list|set|create|drafts|archive|health',
    subcommands: [
      { name: 'show', desc: 'Show the active profile' },
      { name: 'list', desc: 'List curated profiles' },
      { name: 'set <id>', desc: 'Switch the active profile (writes construct.config.json)' },
      { name: 'create <id> [--display=…] [--role=…] [--department=…] [--yes|--dry-run]', desc: 'Scaffold a draft profile; previews and confirms by default, prompts interactively when no flags' },
      { name: 'drafts', desc: 'List in-progress draft profiles' },
      { name: 'archive <id> --reason="..."', desc: 'Move a curated profile into archive/profiles/<id>/' },
      { name: 'health <id> [--days=N]', desc: 'Per-profile observation + outcome rollup' },
    ],
  },
  {
    name: 'workspace',
    emoji: '🏢',
    category: 'Work',
    core: false,
    description: 'Manage PM workspaces for multi-PM signal routing',
    usage: 'construct workspace list|create|show|assign',
    subcommands: [
      { name: 'list', desc: 'List all workspaces' },
      { name: 'create --name=X --owner=Jane', desc: 'Create a new workspace' },
      { name: 'show <id>', desc: 'Show workspace details' },
      { name: 'assign --customer=X --workspace=Y', desc: 'Assign customer to workspace' },
    ],
  },
  {
    name: 'docs',
    emoji: '📄',
    category: 'Core',
    core: true,
    description: 'Documentation commands',
    usage: 'construct docs check|verify|update',
    subcommands: [
      { name: 'check', desc: 'Check for missing how-to guides' },
      { name: 'verify', desc: 'Validate documentation quality' },
      { name: 'update', desc: 'Regenerate AUTO-managed regions' },
    ],
  },
  {
    name: 'doctor',
    emoji: '🩺',
    category: 'Core',
    core: true,
    description: 'Check installation health',
    usage: 'construct doctor',
  },
  
  // ── Work (project workflows) ──────────────────────────────────────────
  {
    name: 'distill',
    emoji: '🔬',
    category: 'Work',
    core: false,
    description: 'Distill documents with query-focused chunking',
    usage: 'construct distill <dir> [--format=summary|decisions|full]',
  },
  {
    name: 'ingest',
    emoji: '📥',
    category: 'Work',
    core: false,
    description: 'Convert documents to indexed markdown',
    usage: 'construct ingest <file> [--sync]',
  },
  {
    name: 'infer',
    emoji: '🧠',
    category: 'Work',
    core: false,
    description: 'Infer schema from documents',
    usage: 'construct infer <file> [--unified]',
  },
  {
    name: 'search',
    emoji: '🔎',
    category: 'Work',
    core: false,
    description: 'Hybrid search across project state',
    usage: 'construct search <query>',
  },
  {
    name: 'storage',
    emoji: '🗄️',
    category: 'Work',
    core: false,
    description: 'Manage storage backend',
    usage: 'construct storage sync|status|reset',
  },
  {
    name: 'headhunt',
    emoji: '🧭',
    category: 'Work',
    core: false,
    description: 'Create domain expertise overlays',
    usage: 'construct headhunt <domain>',
  },
  {
    name: 'graph',
    emoji: '🕸️',
    category: 'Work',
    core: false,
    description: 'Task graph management',
    usage: 'construct graph list|show|from-intake',
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
    name: 'plugin',
    emoji: '🧩',
    category: 'Models & Integrations',
    description: 'Manage external Construct plugin manifests',
    usage: 'construct plugin <list|info|validate|init> [name]',
    subcommands: [
      { name: 'list', desc: 'Show loaded plugins and manifest sources' },
      { name: 'info', desc: 'Show details for a plugin' },
      { name: 'validate', desc: 'Validate all discovered plugin manifests' },
      { name: 'init', desc: 'Create a starter plugin manifest in .cx/plugins/' },
    ],
  },
  {
    name: 'hosts',
    emoji: '🖥️',
    category: 'Models & Integrations',
    description: 'Show host support for Construct orchestration',
    usage: 'construct hosts',
  },
  {
    name: 'claude:allow',
    emoji: '🔓',
    category: 'Models & Integrations',
    description: 'Manage Claude Code `permissions.allow` from the outside (auto-classifier blocks the agent from editing it)',
    usage: 'construct claude:allow <list|add|remove|check> [pattern...] [--apply]',
    subcommands: [
      { name: 'list',   desc: 'Print every allowlist entry' },
      { name: 'add',    desc: 'Add one or more patterns (idempotent)' },
      { name: 'remove', desc: 'Remove patterns' },
      { name: 'check',  desc: 'Detect branch-prefix gaps; `--apply` writes the suggestions' },
    ],
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
    name: 'eval-datasets',
    emoji: '📊',
    category: 'Observability',
    description: 'Sync scored Langfuse traces into eval datasets for prompt regression testing',
    usage: 'construct eval-datasets [--limit=N]',
    options: [
      { flag: '--limit=N', desc: 'Maximum scored traces to sync (default: 100)' },
    ],
  },
  {
    name: 'llm-judge',
    emoji: '⚖️',
    category: 'Observability',
    description: 'Run LLM-as-a-judge evaluations on unscored traces for continuous quality feedback',
    usage: 'construct llm-judge [--limit=N] [--model=NAME]',
    options: [
      { flag: '--limit=N', desc: 'Maximum traces to evaluate (default: 10)' },
      { flag: '--model=NAME', desc: 'LLM model to use for evaluation (default: claude-3-5-sonnet-20241022)' },
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
  {
    name: 'cleanup',
    emoji: '🧹',
    category: 'Diagnostics',
    description: 'Release dev-agent memory pressure by cleaning stale helper and bridge processes',
    usage: 'construct cleanup [--pressure-release] [--quiet]',
    options: [
      { flag: '--pressure-release', desc: 'Also terminate stale cass index processes when swap is above threshold' },
      { flag: '--quiet', desc: 'Suppress per-process output and only act on the current policy' },
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
      { name: 'templates', desc: 'List available team templates from specialists/teams.json' },
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
    name: 'doc',
    emoji: '🔏',
    category: 'Diagnostics',
    description: 'Verify or inspect auditability stamps on Construct-generated markdown files',
    usage: 'construct doc <verify|install-hooks> [path] [--json]',
    subcommands: [
      { name: 'verify',       desc: 'Check body_hash stamps on one file or all .md files under a path. Exits non-zero if any fail.' },
      { name: 'install-hooks', desc: 'Install the prepare-commit-msg git hook into .git/hooks/ for AI provenance trailers.' },
    ],
  },
   {
     name: 'bootstrap',
     emoji: '🌱',
     category: 'Work',
     description: 'Import seed observation corpus into local memory store for cold-start acceleration',
     usage: 'construct bootstrap [--verbose]',
     options: [
       { flag: '--verbose', desc: 'Print each observation imported or skipped' },
     ],
   },
   {
     name: 'reflect',
     emoji: '🪞',
     category: 'Work',
     description: 'Capture improvement feedback from chat session and update Construct core',
     usage: 'construct reflect [--target=<internal|how-tos|decisions>] [--summary=<text>]',
     options: [
       { flag: '--target=<internal|how-tos|decisions>', desc: 'Knowledge subdir to store feedback (default: internal)' },
       { flag: '--summary=<text>', desc: 'Brief summary of the improvement feedback' },
     ],
   },
  {
    name: 'memory',
    emoji: '💡',
    category: 'Work',
    core: false,
    description: 'Inspect memory layer',
    usage: 'construct memory stats|consolidate',
  },
  {
    name: 'drop',
    emoji: '📥',
    category: 'Work',
    core: false,
    description: 'Ingest file from Downloads/Desktop',
    usage: 'construct drop [--list]',
  },
  {
    name: 'wireframe',
    emoji: '✏️',
    category: 'Work',
    core: false,
    description: 'Generate wireframes from description',
    usage: 'construct wireframe "<description>"',
  },
  {
    name: 'ollama',
    emoji: '🦙',
    category: 'Integrations',
    core: false,
    description: 'Manage local Ollama models',
    usage: 'construct ollama status|pull|test',
  },
  
  // ── Advanced (hidden by default) ──────────────────────────────────────
  {
    name: 'beads',
    emoji: '📿',
    category: 'Advanced',
    core: false,
    description: 'Task queue management',
    usage: 'construct beads status|cleanup',
  },
  {
    name: 'config',
    emoji: '⚙️',
    category: 'Advanced',
    core: false,
    description: 'Deployment mode configuration',
    usage: 'construct config mode',
  },
  {
    name: 'uninstall',
    emoji: '🧹',
    category: 'Advanced',
    core: false,
    description: 'Remove Construct state',
    usage: 'construct uninstall',
  },
  {
    name: 'update',
    emoji: '⬆️',
    category: 'Advanced',
    core: false,
    description: 'Reinstall this checkout',
    usage: 'construct update',
  },
  {
    name: 'upgrade',
    emoji: '🚀',
    category: 'Advanced',
    core: false,
    description: 'Upgrade to latest npm version',
    usage: 'construct upgrade',
  },
  {
    name: 'completions',
    emoji: '⌨️',
    category: 'Advanced',
    core: false,
    description: 'Shell completion scripts',
    usage: 'construct completions',
  },
  {
    name: 'list',
    emoji: '📋',
    category: 'Advanced',
    core: false,
    description: 'List all agents',
    usage: 'construct list',
  },
  {
    name: 'role',
    emoji: '🎭',
    category: 'Advanced',
    core: false,
    description: 'Role framework management',
    usage: 'construct role list|status',
  },
  {
    name: 'embed',
    emoji: '🔁',
    category: 'Advanced',
    core: false,
    description: 'Embed mode management',
    usage: 'construct embed start|stop|status',
  },
  {
    name: 'backup',
    emoji: '💾',
    category: 'Advanced',
    core: false,
    description: 'System backups',
    usage: 'construct backup create|restore',
  },
  {
    name: 'validate',
    emoji: '✅',
    category: 'Advanced',
    core: false,
    description: 'Validate registry structure',
    usage: 'construct validate',
  },
  {
    name: 'diff',
    emoji: '📍',
    category: 'Advanced',
    core: false,
    description: 'Show agent changes since HEAD',
    usage: 'construct diff',
  },
  {
    name: 'version',
    emoji: 'ℹ️',
    category: 'Advanced',
    core: false,
    description: 'Show version',
    usage: 'construct version | construct --version',
  },
  {
    name: 'skills',
    emoji: '🎯',
    category: 'Advanced',
    core: false,
    description: 'Skill relevance detection',
    usage: 'construct skills scope|apply',
  },
  {
    name: 'hooks:health',
    emoji: '🩺',
    category: 'Advanced',
    core: false,
    description: 'Check hook health',
    usage: 'construct hooks:health',
  },
  {
    name: 'gates:audit',
    emoji: '🛡️',
    category: 'Advanced',
    core: false,
    description: 'Audit policy gates',
    usage: 'construct gates:audit',
  },
  {
    name: 'policy',
    emoji: '🔒',
    category: 'Advanced',
    core: false,
    description: 'Show active policy gates with enforcement details',
    usage: 'construct policy show',
    options: [
      { flag: '--json', desc: 'Output as JSON' },
    ],
  },
  {
    name: 'ci',
    emoji: '⚙️',
    category: 'Advanced',
    core: false,
    description: 'Local CI mirror: run CI jobs locally or view recent run status',
    usage: 'construct ci <preview|status|list>',
    options: [
      { flag: '--job=<name>', desc: 'Run a single CI job by id or name fragment' },
      { flag: '--list',       desc: 'List all jobs without running them' },
      { flag: '--full',       desc: 'Include Docker/Trivy steps (requires Docker daemon)' },
    ],
  },
  {
    name: 'provider',
    emoji: '🔌',
    category: 'Advanced',
    core: false,
    description: 'Provider management',
    usage: 'construct provider list|test',
  },
  {
    name: 'auth:status',
    emoji: '🔐',
    category: 'Advanced',
    core: false,
    description: 'Check auth status',
    usage: 'construct auth:status',
  },
  {
    name: 'tags',
    emoji: '🏷',
    category: 'Work',
    core: false,
    description: 'Manage the controlled tag vocabulary (propose, add, deprecate, audit)',
    usage: 'construct tags <audit|propose|add|deprecate|archive|list|proposed>',
  },
  {
    name: 'scheduler',
    emoji: '⏰',
    category: 'Advanced',
    core: false,
    description: 'Manage scheduled background jobs (tag-mining, doc-hygiene, skill-rollup)',
    usage: 'construct scheduler <list|run|runner>',
  },
  {
    name: 'creds',
    emoji: '🔑',
    category: 'Integrations',
    core: false,
    description: 'Manage provider credentials (set, rotate, revoke, list)',
    usage: 'construct creds <list|set|rotate|revoke|test>',
  },
  {
    name: 'providers',
    emoji: '🔌',
    category: 'Integrations',
    core: false,
    description: 'Provider status, circuit-breaker reset, and resource discovery',
    usage: 'construct providers <status|discover>',
  },
  {
    name: 'workflow',
    emoji: '🔄',
    category: 'Work',
    core: false,
    description: 'Instantiate workflow templates (PRD-to-review chains, onboarding, handoffs)',
    usage: 'construct workflow <list|show|new>',
  },
  {
    name: 'telemetry',
    emoji: '📊',
    category: 'Observability',
    core: false,
    description: 'Query telemetry traces and latency data',
    usage: 'construct telemetry query <latency|top-slow|errors|trace>',
  },
];

/** Flat list of all top-level command names (for completions). */
export const COMMAND_NAMES = CLI_COMMANDS.map(c => c.name);

/** Commands grouped by category, sorted alphabetically by name within each group. */
export const CLI_COMMANDS_BY_CATEGORY = CLI_COMMANDS.reduce((acc, cmd) => {
  const cat = cmd.category ?? 'Other';
  if (!acc[cat]) acc[cat] = [];
  acc[cat].push(cmd);
  return acc;
}, {});
for (const cat of Object.keys(CLI_COMMANDS_BY_CATEGORY)) {
  CLI_COMMANDS_BY_CATEGORY[cat].sort((a, b) => a.name.localeCompare(b.name));
}

/** Canonical category display order. */
export const CATEGORY_ORDER = [
  'Core',
  'Work',
  'Models & Integrations',
  'Integrations',
  'Observability',
  'Diagnostics',
  'Advanced',
];

/** Check if a command should be shown by default (core: true) or hidden (core: false). */
export function isCoreCommand(commandName) {
  const cmd = CLI_COMMANDS.find(c => c.name === commandName);
  return cmd?.core ?? false;
}

/** Get commands filtered by visibility. */
export function getCommands(options = {}) {
  const { showAll = false } = options;
  if (showAll) return CLI_COMMANDS;
  return CLI_COMMANDS.filter(cmd => cmd.core);
}
