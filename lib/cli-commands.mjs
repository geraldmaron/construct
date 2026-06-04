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
 *   - internal: true → hidden from --help and --all; callable but not advertised
 */

import { resolveColors } from './term-format.mjs';

export const CLI_COMMANDS = [
  // ── Core (shown by default) ───────────────────────────────────────────
  {
    name: 'dev',
    emoji: '🚀',
    category: 'Core',
    core: true,
    description: 'Start services for development',
    usage: 'construct dev [--select] [--only=postgres,dashboard,...]',
    options: [
      { flag: '--select', desc: 'Pick which services to start from an interactive checklist' },
      { flag: '--only=<a,b,c>', desc: 'Start only the named services (postgres, dashboard, telemetry, memory, opencode)' },
    ],
  },
  {
    name: 'dashboard',
    emoji: '📊',
    category: 'Core',
    core: true,
    description: 'Start the local dashboard/orchestration daemon (or --token to mint a dashboard token)',
    usage: 'construct dashboard [--token]',
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
    description: 'Machine setup (once per machine): Docker, cm/cass, config, embeddings',
    usage: 'construct install [--yes] [--no-docker] [--reconfigure]',
    options: [
      { flag: '--yes',         desc: 'Apply defaults without prompts' },
      { flag: '--no-docker',   desc: 'Skip Docker-based service setup (local Postgres)' },
      { flag: '--reconfigure', desc: 'Re-prompt for service consent, ignoring cached answers' },
    ],
  },
  {
    name: 'init',
    emoji: '🏗️',
    category: 'Core',
    core: true,
    description: 'Project setup (once per repo): scaffold .cx/, AGENTS.md, plan.md, adapters',
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
    usage: 'construct intake list|show|done|skip|reopen|integrate|classify',
    subcommands: [
      { name: 'list', desc: 'List pending packets' },
      { name: 'show <id>', desc: 'Show one packet (triage, related docs, excerpt, tag suggestions)' },
      { name: 'done <id> [--output=<path>]', desc: 'Mark processed; optionally stamp the produced artifact' },
      { name: 'skip <id> [--reason=…]', desc: 'Drop without action; preserves audit trail' },
      { name: 'reopen <id>', desc: 'Move a processed or skipped packet back to pending' },
      { name: 'integrate <id> <github|jira|confluence> [--publish-issues]', desc: 'Create an external ticket from a packet (--publish-issues unlocks the demo-source gate)' },
      { name: 'classify --json [--text|--file|<stdin>]', desc: 'Classify an artifact and return a role-aware plan without enqueuing (embedded contract)' },
    ],
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
    usage: 'construct doctor [<status|logs|tick|report|consistency|watch|stop|credentials>] [--fix-legacy-agents]',
    subcommands: [
      { name: 'status', desc: 'Doctor daemon status' },
      { name: 'logs', desc: 'Tail doctor daemon logs' },
      { name: 'tick', desc: 'Run one doctor daemon check cycle now' },
      { name: 'report', desc: 'Print the latest health report' },
      { name: 'consistency', desc: 'Run cross-surface consistency checks' },
      { name: 'watch', desc: 'Start the doctor daemon (continuous checks)' },
      { name: 'stop', desc: 'Stop the doctor daemon' },
      { name: 'credentials', desc: 'Diagnose provider credential resolution' },
    ],
    options: [
      { flag: '--fix-legacy-agents', desc: 'Sweep legacy cx-*.md agents at user scope and re-sync' },
    ],
  },
  
  // ── Work (project workflows) ──────────────────────────────────────────
  {
    name: 'distill',
    emoji: '🔬',
    category: 'Work',
    core: false,
    description: 'Distill documents with query-focused chunking',
    usage: 'construct distill <file>',
  },
  {
    name: 'ingest',
    emoji: '📥',
    category: 'Work',
    core: false,
    description: 'Convert documents to indexed markdown',
    usage: 'construct ingest <file> [--strategy=adapter|provider] [--orchestration=prompt-only|orchestrated] [--strict] [--legacy-extractor]',
  },
  {
    name: 'infer',
    emoji: '🧠',
    category: 'Work',
    core: false,
    description: 'Infer schema from documents',
    usage: 'construct infer <file>',
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
    usage: 'construct storage <status|reset>',
  },
  {
    name: 'headhunt',
    emoji: '🧭',
    category: 'Work',
    core: false,
    description: 'Create domain expertise overlays',
    usage: 'construct headhunt <create|list>',
  },
  {
    name: 'graph',
    emoji: '🕸️',
    category: 'Work',
    core: false,
    description: 'Task graph management',
    usage: 'construct graph <list|show|from-intake|recommend>',
    subcommands: [
      { name: 'recommend --json [--text|--file|<stdin>]', desc: 'Return a role-aware plan for an artifact without enqueuing (embedded contract; alias of intake classify)' },
    ],
  },
  {
    name: 'models',
    emoji: '🧠',
    category: 'Models & Integrations',
    core: false,
    description: 'Show or update model tier assignments',
    usage: 'construct models <list|set|free|reset|usage|cost|resolve>',
    subcommands: [
      { name: 'list', desc: 'Show current tier assignments' },
      { name: 'set --tier=<reasoning|standard|fast> --model=<model>', desc: 'Set a model for a tier' },
      { name: 'free', desc: 'List available free models' },
      { name: 'reset', desc: 'Reset all tier assignments' },
      { name: 'usage', desc: 'Show token usage per tier' },
      { name: 'cost', desc: 'Show cost breakdown' },
      { name: 'resolve --json', desc: 'Resolve the model for an embedded workflow given host context' },
    ],
  },
  {
    name: 'capability',
    emoji: '🧩',
    category: 'Models & Integrations',
    core: false,
    description: 'Describe what this Construct install can do (embedded contract; read-only, secret-free)',
    usage: 'construct capability describe --json',
    subcommands: [
      { name: 'describe --json', desc: 'Emit versions, interfaces, roles, skills, workflows, schemas, models, policies, telemetry, plugins' },
    ],
  },
  {
    name: 'execution',
    emoji: '🪢',
    category: 'Models & Integrations',
    core: false,
    description: 'Resolve the execution-capability contract for an embedded workflow (orchestrated vs prompt-only; descriptive, not enforced)',
    usage: 'construct execution resolve --json',
    subcommands: [
      { name: 'resolve --json', desc: 'Report executionMode, active Construct capabilities, and any degradation given host/strategy context' },
    ],
  },
  {
    name: 'orchestrate',
    emoji: '🎼',
    category: 'Models & Integrations',
    core: false,
    description: 'Construct-owned local orchestration runtime, in-process or against the local daemon (--remote)',
    usage: 'construct orchestrate <run|status> [options] [--remote]',
    subcommands: [
      { name: 'run "<request>" [--strategy S] [--host H] [--worker-backend provider] [--no-construct] [--no-execute] [--json] [--remote]', desc: 'Plan and run a request through a Construct-owned specialist chain; --remote drives the local daemon over HTTP' },
      { name: 'status [run-id] [--json] [--remote]', desc: 'Inspect a run, or list recent runs (locally or from the daemon)' },
    ],
  },
  {
    name: 'acp',
    emoji: '🔗',
    category: 'Models & Integrations',
    core: false,
    description: 'Run Construct as an Agent Client Protocol (ACP) server over stdio for Zed/JetBrains/VS Code ACP clients',
    usage: 'construct acp',
  },
  {
    name: 'mcp',
    emoji: '🔌',
    category: 'Models & Integrations',
    core: false,
    description: 'Manage MCP integrations',
    usage: 'construct mcp <list|add|remove|info>',
    subcommands: [
      { name: 'list', desc: 'List configured MCP integrations' },
      { name: 'add <id>', desc: 'Add an MCP integration by id' },
      { name: 'remove <id>', desc: 'Remove an MCP integration' },
      { name: 'info <id>', desc: 'Show details for one MCP integration' },
    ],
  },
  {
    name: 'plugin',
    emoji: '🧩',
    category: 'Models & Integrations',
    core: false,
    description: 'Manage external Construct plugin manifests',
    usage: 'construct plugin <list|info|init|validate|engine>',
    subcommands: [
      { name: 'list', desc: 'List discovered plugin manifests' },
      { name: 'info <id>', desc: 'Show details for one plugin' },
      { name: 'init', desc: 'Scaffold a new plugin manifest' },
      { name: 'validate', desc: 'Validate a plugin manifest against the schema' },
      { name: 'engine', desc: 'Plugin engine operations' },
    ],
  },
  {
    name: 'hosts',
    emoji: '🖥️',
    category: 'Models & Integrations',
    core: false,
    description: 'Show host support for Construct orchestration',
    usage: 'construct hosts [--json]',
  },
  {
    name: 'claude:allow',
    emoji: '🔓',
    category: 'Models & Integrations',
    core: false,
    description: 'Manage Claude Code `permissions.allow` from the outside (auto-classifier blocks the agent from editing it)',
    usage: 'construct claude:allow <check|apply|add|remove>',
  },
  {
    name: 'review',
    emoji: '📈',
    category: 'Observability',
    core: false,
    description: 'Generate agent performance review from the configured telemetry trace backend',
    usage: 'construct review [--agent=<id>] [--days=N]',
  },
  {
    name: 'optimize',
    emoji: '⚙️',
    category: 'Observability',
    core: false,
    description: 'Prompt optimization using telemetry trace quality scores',
    usage: 'construct optimize <agent>',
  },
  {
    name: 'telemetry-backfill',
    emoji: '🩹',
    category: 'Observability',
    core: false,
    description: 'Backfill sparse traces with observations (trace backend)',
    usage: 'construct telemetry-backfill',
  },
  {
    name: 'eval-datasets',
    emoji: '📊',
    category: 'Observability',
    core: false,
    description: 'Sync scored traces from the telemetry backend into eval datasets for prompt regression testing',
    usage: 'construct eval-datasets',
  },
  {
    name: 'llm-judge',
    emoji: '⚖️',
    category: 'Observability',
    core: false,
    description: 'Run LLM-as-a-judge evaluations on unscored traces for continuous quality feedback',
    usage: 'construct llm-judge',
  },
  {
    name: 'efficiency',
    emoji: '🧮',
    category: 'Observability',
    core: false,
    description: 'Show read efficiency, repeated files, and context-budget guidance',
    usage: 'construct efficiency [--json]',
  },
  {
    name: 'evals',
    emoji: '🧪',
    category: 'Observability',
    core: false,
    description: 'Show evaluator catalog for prompt and agent experiments',
    usage: 'construct evals <list|run>',
  },
  {
    name: 'cleanup',
    emoji: '🧹',
    category: 'Diagnostics',
    core: false,
    description: 'Release dev-agent memory pressure by cleaning stale helper and bridge processes',
    usage: 'construct cleanup [--dry-run] [--quiet] [--pressure-release] [--pressure-only] [--disk-only]',
    options: [
      { flag: '--dry-run',          desc: 'Show what would be cleaned without changing anything' },
      { flag: '--quiet',            desc: 'Minimal output' },
      { flag: '--pressure-release', desc: 'Also kill stale dev-agent processes' },
      { flag: '--pressure-only',    desc: 'Pressure release only — skip disk cleanup' },
      { flag: '--disk-only',        desc: 'Disk cleanup only — skip pressure release' },
    ],
  },
  {
    name: 'team',
    emoji: '👥',
    category: 'Work',
    core: false,
    description: 'Team review and template listing',
    usage: 'construct team <list|review>',
  },
  {
    name: 'audit',
    emoji: '🔍',
    category: 'Diagnostics',
    core: false,
    description: 'Audit Construct internals and review the mutation trail',
    usage: 'construct audit <events|trail>',
  },
  {
    name: 'doc',
    emoji: '🔏',
    category: 'Diagnostics',
    core: false,
    description: 'Verify or inspect auditability stamps on Construct-generated markdown files',
    usage: 'construct doc <verify|inspect>',
  },
  {
    name: 'bootstrap',
    emoji: '🌱',
    category: 'Work',
    core: false,
    description: 'Import seed observation corpus into local memory store for cold-start acceleration',
    usage: 'construct bootstrap',
  },
  {
    name: 'reflect',
    emoji: '🪞',
    category: 'Work',
    core: false,
    description: 'Capture improvement feedback from chat session and update Construct core',
    usage: 'construct reflect',
  },
  {
    name: 'memory',
    emoji: '💡',
    category: 'Work',
    core: false,
    description: 'Inspect memory layer',
    usage: 'construct memory <status|search>',
  },
  {
    name: 'drop',
    emoji: '📥',
    category: 'Work',
    core: false,
    description: 'Ingest file from Downloads/Desktop',
    usage: 'construct drop <file>',
  },
  {
    name: 'wireframe',
    emoji: '✏️',
    category: 'Work',
    core: false,
    description: 'Generate wireframes from description',
    usage: 'construct wireframe <description>',
  },
  {
    name: 'ollama',
    emoji: '🦙',
    category: 'Integrations',
    core: false,
    description: 'Manage local Ollama models',
    usage: 'construct ollama <list|pull|run>',
  },
  {
    name: 'beads',
    emoji: '📿',
    category: 'Advanced',
    core: false,
    description: 'Task queue management',
    usage: 'construct beads <list|show|create|update|close|drift|stats>',
  },
  {
    name: 'config',
    emoji: '⚙️',
    category: 'Advanced',
    core: false,
    description: 'Deployment mode configuration',
    usage: 'construct config <get|set>',
  },
  {
    name: 'uninstall',
    emoji: '🧹',
    category: 'Advanced',
    core: false,
    description: 'Remove Construct state',
    usage: 'construct uninstall [--dry-run] [--yes] [--all] [--keep-state] [--scope=project|machine|all]',
    options: [
      { flag: '--dry-run',          desc: 'Print the plan and exit; change nothing' },
      { flag: '--yes',              desc: 'Remove auto-risk (✓) categories without prompting' },
      { flag: '--all',              desc: 'Combined with --yes: also remove ask-risk (◐) categories (project data, machine config)' },
      { flag: '--keep-state',       desc: 'Only remove the launcher + adapters; preserve .cx/, ~/.construct, Postgres' },
      { flag: '--scope=<...>',      desc: 'Limit to project | machine | all (default: all)' },
    ],
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
    usage: 'construct completions <bash|zsh|install>',
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
    usage: 'construct role <list|latest|show|status|resolve|prune|reset>',
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
    name: 'decisions',
    emoji: '🧭',
    category: 'Advanced',
    core: false,
    description: 'Index load-bearing decisions and their enforcement bindings',
    usage: 'construct decisions [list|validate|json|check|baseline|golden]',
    options: [
      { flag: 'list', desc: 'Show decisions with status and enforcement (default)' },
      { flag: 'validate', desc: 'Validate registry structure; exit 1 on error' },
      { flag: 'check', desc: 'Fail on dangling markers, enforcement/supersede/linkage/precedence drift' },
      { flag: 'baseline', desc: 'Print the enforced baseline; --write to regenerate it' },
      { flag: 'golden', desc: 'Check the CLI/agent/hook surface snapshot; --write to regenerate it' },
      { flag: 'json', desc: 'Emit the full registry as JSON' },
    ],
  },
  {
    name: 'deployment',
    emoji: '🛰️',
    category: 'Advanced',
    core: false,
    description: 'Deployment posture tools (capability parity contract)',
    usage: 'construct deployment parity',
    options: [
      { flag: 'parity', desc: 'Show and validate capability parity across solo/team/enterprise' },
      { flag: '--json', desc: 'Emit the parity contract as JSON' },
    ],
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
    usage: 'construct workflow <list|show|new|invoke>',
    subcommands: [
      { name: 'invoke --json --workflow-type <t> [--text|--file|<stdin>]', desc: 'Invoke a workflow (roles/skills) non-interactively with approval gating and provenance (embedded contract)' },
    ],
  },
  {
    name: 'telemetry',
    emoji: '📊',
    category: 'Observability',
    core: false,
    description: 'Query telemetry traces and latency data',
    usage: 'construct telemetry query <latency|top-slow|errors|trace>',
  },
  {
    name: 'ask',
    emoji: '❓',
    category: 'Work',
    core: false,
    description: 'One-shot ask against the active knowledge index',
    usage: 'construct ask <query>',
  },
  {
    name: 'handoffs',
    emoji: '📦',
    category: 'Work',
    core: false,
    description: 'List and inspect session handoff files in .cx/handoffs/',
    usage: 'construct handoffs <list|show>',
  },
  {
    name: 'feedback:record',
    emoji: '📝',
    category: 'Observability',
    core: false,
    description: 'Record an outcome rating for a recent specialist invocation',
    usage: 'construct feedback:record <id> --score=<0-1> [--note="..."]',
  },
  {
    name: 'feedback:history',
    emoji: '📜',
    category: 'Observability',
    core: false,
    description: 'Show recorded outcome ratings',
    usage: 'construct feedback:history [--days=N]',
  },
  {
    name: 'roles:list',
    emoji: '🎭',
    category: 'Advanced',
    core: false,
    description: 'List installed role contracts',
    usage: 'construct roles:list',
  },
  {
    name: 'roles:set',
    emoji: '🎭',
    category: 'Advanced',
    core: false,
    description: 'Activate a role contract',
    usage: 'construct roles:set <role>',
  },
  {
    name: 'docs:check',
    emoji: '📄',
    category: 'Diagnostics',
    core: false,
    description: 'Check for missing how-to guides (alias for `docs check`)',
    usage: 'construct docs:check',
  },
  {
    name: 'docs:verify',
    emoji: '📄',
    category: 'Diagnostics',
    core: false,
    description: 'Validate documentation quality (alias for `docs verify`)',
    usage: 'construct docs:verify',
  },
  {
    name: 'docs:update',
    emoji: '📄',
    category: 'Diagnostics',
    core: false,
    description: 'Regenerate AUTO-managed doc regions (alias for `docs update`)',
    usage: 'construct docs:update',
  },
  {
    name: 'docs:reconcile',
    emoji: '📄',
    category: 'Diagnostics',
    core: false,
    description: 'Reconcile docs against the registry',
    usage: 'construct docs:reconcile',
  },
  {
    name: 'docs:site',
    emoji: '📄',
    category: 'Diagnostics',
    core: false,
    description: 'Manage the docs static site build',
    usage: 'construct docs:site <build|serve>',
  },
  {
    name: 'beads:stats',
    emoji: '📿',
    category: 'Advanced',
    core: false,
    description: 'Show beads counters and drift summary',
    usage: 'construct beads:stats',
  },
  {
    name: 'telemetry-setup',
    emoji: '🩹',
    category: 'Observability',
    core: false,
    description: 'Configure telemetry backend credentials and trace export (OTLP or Langfuse-compatible)',
    usage: 'construct telemetry-setup',
  },
  // ── Internal — callable but not advertised in help or completions ────
  { name: 'hook',              category: 'Internal', core: false, internal: true, description: 'Hook dispatch — invoked by the harness, not by users', usage: 'construct hook <event>' },
  { name: 'seed-traces',       category: 'Internal', core: false, internal: true, description: 'Dev fixture: seed traces for testing', usage: 'construct seed-traces' },
  { name: 'migrate',           category: 'Internal', core: false, internal: true, description: 'Internal: run pending storage migrations', usage: 'construct migrate' },
  { name: 'dashboard:sync',    category: 'Internal', core: false, internal: true, description: 'Internal: refresh dashboard state from the registry', usage: 'construct dashboard:sync' },
  { name: 'init:update',       category: 'Internal', core: false, internal: true, description: 'Internal: re-run init scaffolding for an existing project', usage: 'construct init:update' },
  { name: 'lint:agents',       category: 'Internal', core: false, internal: true, description: 'Internal lint: agent definitions', usage: 'construct lint:agents' },
  { name: 'lint:comments',     category: 'Internal', core: false, internal: true, description: 'Internal lint: source comments', usage: 'construct lint:comments' },
  { name: 'lint:contracts',    category: 'Internal', core: false, internal: true, description: 'Internal lint: specialist contracts', usage: 'construct lint:contracts' },
  { name: 'lint:research',     category: 'Internal', core: false, internal: true, description: 'Internal lint: research artifacts', usage: 'construct lint:research' },
  { name: 'lint:templates',    category: 'Internal', core: false, internal: true, description: 'Internal lint: shipped templates', usage: 'construct lint:templates' },
  { name: 'evaluator:rubrics', category: 'Internal', core: false, internal: true, description: 'Internal: list registered evaluator rubrics', usage: 'construct evaluator:rubrics' },
  { name: 'activation:status', category: 'Internal', core: false, internal: true, description: 'Internal: agent activation telemetry', usage: 'construct activation:status' },
  { name: 'prune',             category: 'Internal', core: false, internal: true, description: 'Internal: prune ephemeral storage entries', usage: 'construct prune' },
  { name: 'overrides',         category: 'Internal', core: false, internal: true, description: 'Internal: list project overrides over the catalog', usage: 'construct overrides' },
  { name: 'resources',         category: 'Internal', core: false, internal: true, description: 'Internal: resource probe', usage: 'construct resources' },
];

/** Flat list of all top-level command names (for completions). */
export const COMMAND_NAMES = CLI_COMMANDS.filter((c) => !c.internal).map((c) => c.name);

/** Every handler key (including internal) — used for catalog-parity tests. */
export const ALL_COMMAND_NAMES = CLI_COMMANDS.map((c) => c.name);

/** Commands grouped by category, sorted alphabetically by name within each group. */
export const CLI_COMMANDS_BY_CATEGORY = CLI_COMMANDS
  .filter((c) => !c.internal)
  .reduce((acc, cmd) => {
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
  const cmd = CLI_COMMANDS.find((c) => c.name === commandName);
  return cmd?.core ?? false;
}

/** Check if a command is internal (hidden from --help and --all). */
export function isInternalCommand(commandName) {
  const cmd = CLI_COMMANDS.find((c) => c.name === commandName);
  return cmd?.internal === true;
}

/** Get commands filtered by visibility. */
export function getCommands(options = {}) {
  const { showAll = false } = options;
  const visible = CLI_COMMANDS.filter((c) => !c.internal);
  if (showAll) return visible;
  return visible.filter((cmd) => cmd.core);
}

/** Look up a single command entry by name. */
export function getCommandSpec(name) {
  return CLI_COMMANDS.find((c) => c.name === name) || null;
}

// Render a per-command help block. Pulls usage, description, subcommands,
// and options from the CLI_COMMANDS entry so help stays consistent across
// every command. Internal commands fall back to a minimal block.

export function formatCommandHelp(name, { colors = false } = {}) {
  const c = resolveColors({ enabled: colors });
  const spec = getCommandSpec(name);
  if (!spec) {
    return `Unknown command: ${name}\n\nRun 'construct --help' for available commands.\n`;
  }
  const lines = [];
  lines.push(`${c.bold}construct ${spec.name}${c.reset} — ${spec.description}`);
  lines.push('');
  if (spec.usage) {
    lines.push(`${c.dim}Usage:${c.reset} ${spec.usage}`);
    lines.push('');
  }
  if (spec.subcommands && spec.subcommands.length > 0) {
    lines.push(`${c.bold}Subcommands${c.reset}`);
    const width = Math.max(...spec.subcommands.map((s) => s.name.length));
    for (const sub of spec.subcommands) {
      lines.push(`  ${sub.name.padEnd(width)}  ${sub.desc}`);
    }
    lines.push('');
  }
  if (spec.options && spec.options.length > 0) {
    lines.push(`${c.bold}Options${c.reset}`);
    const width = Math.max(...spec.options.map((o) => o.flag.length));
    for (const opt of spec.options) {
      lines.push(`  ${opt.flag.padEnd(width)}  ${opt.desc}`);
    }
    lines.push('');
  }
  return lines.join('\n');
}
