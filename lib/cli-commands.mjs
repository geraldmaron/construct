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
    name: 'models',
    emoji: '🧠',
    category: 'Core',
    core: true,
    description: 'Manage AI model assignments',
    usage: 'construct models [--apply|--poll]',
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
  {
    name: 'memory',
    emoji: '💡',
    category: 'Work',
    core: false,
    description: 'Inspect memory layer',
    usage: 'construct memory stats|consolidate',
  },
  {
    name: 'reflect',
    emoji: '🪞',
    category: 'Work',
    core: false,
    description: 'Capture improvement feedback',
    usage: 'construct reflect [--summary=<text>]',
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
    name: 'bootstrap',
    emoji: '🌱',
    category: 'Work',
    core: false,
    description: 'Import seed observations',
    usage: 'construct bootstrap',
  },
  {
    name: 'team',
    emoji: '👥',
    category: 'Work',
    core: false,
    description: 'Team review and templates',
    usage: 'construct team review|templates',
  },
  
  // ── Integrations ──────────────────────────────────────────────────────
  {
    name: 'mcp',
    emoji: '🔌',
    category: 'Integrations',
    core: false,
    description: 'Manage MCP integrations',
    usage: 'construct mcp list|add|remove',
  },
  {
    name: 'ollama',
    emoji: '🦙',
    category: 'Integrations',
    core: false,
    description: 'Manage local Ollama models',
    usage: 'construct ollama status|pull|test',
  },
  {
    name: 'plugin',
    emoji: '🧩',
    category: 'Integrations',
    core: false,
    description: 'Manage plugin manifests',
    usage: 'construct plugin list|validate',
  },
  {
    name: 'hosts',
    emoji: '🖥️',
    category: 'Integrations',
    core: false,
    description: 'Check host capabilities',
    usage: 'construct hosts',
  },
  {
    name: 'claude:allow',
    emoji: '🔓',
    category: 'Integrations',
    core: false,
    description: 'Manage Claude Code permissions',
    usage: 'construct claude:allow list|add|check',
  },
  
  // ── Observability ─────────────────────────────────────────────────────
  // Cost / pricing entries are intentionally absent from the public catalog.
  // Ledger writes continue in the background; the consumer surface lands with
  // the OTel + dashboard wiring (see plan Workstream J).
  {
    name: 'efficiency',
    emoji: '🧮',
    category: 'Observability',
    core: false,
    description: 'Read efficiency metrics',
    usage: 'construct efficiency',
  },
  {
    name: 'review',
    emoji: '📈',
    category: 'Observability',
    core: false,
    description: 'Agent performance review',
    usage: 'construct review [--days=N]',
  },
  {
    name: 'optimize',
    emoji: '⚙️',
    category: 'Observability',
    core: false,
    description: 'Prompt optimization',
    usage: 'construct optimize <agent>',
  },
  {
    name: 'evals',
    emoji: '🧪',
    category: 'Observability',
    core: false,
    description: 'Evaluator catalog',
    usage: 'construct evals',
  },
  {
    name: 'llm-judge',
    emoji: '⚖️',
    category: 'Observability',
    core: false,
    description: 'LLM-as-judge evaluations',
    usage: 'construct llm-judge',
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
    name: 'audit',
    emoji: '🔍',
    category: 'Advanced',
    core: false,
    description: 'Audit Construct internals',
    usage: 'construct audit skills|trail',
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
    name: 'cleanup',
    emoji: '🧹',
    category: 'Advanced',
    core: false,
    description: 'Clean stale processes',
    usage: 'construct cleanup',
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
  'Integrations',
  'Observability',
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
