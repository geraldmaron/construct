/**
 * cli-commands.mjs — single source of truth for all construct CLI commands.
 *
 * Consumed by:
 *   - bin/construct         (usage text + emoji output)
 *   - lib/completions.mjs   (bash + zsh completion generation)
 *
 * Command Visibility:
 *   - core: true → shown in default --help (90% of users)
 *   - core: false → hidden unless --all flag (advanced/internal commands)
 *   - internal: true → hidden from --help and --all; callable but not advertised
 */

import { resolveColors } from './term-format.mjs';
import { resolveUiColors } from './ui/theme.mjs';
import { formatPathLink, terminalLinksEnabled } from './ui/links.mjs';
import { surfaceForCommand } from './registry/surface-map.mjs';

export const CLI_COMMANDS = [
  // ── Core (shown by default) ───────────────────────────────────────────
  {
    name: 'dev',
    emoji: '🚀',
    category: 'Core',
    core: true,
    description: 'Start services for development',
    usage: 'construct dev [--select] [--only=memory,opencode,...]',
    examples: [
      { cmd: 'construct dev', desc: 'Start the default service set' },
      { cmd: 'construct dev --only=memory', desc: 'Start just the memory (cm) service' },
    ],
    options: [
      { flag: '--select', desc: 'Pick which services to start from an interactive checklist' },
      { flag: '--only=<a,b,c>', desc: 'Start only the named services (telemetry, memory, opencode, copilot-bridge)' },
    ],
  },
  {
    name: 'stop',
    emoji: '⏹',
    category: 'Core',
    core: true,
    description: 'Stop all running services',
    usage: 'construct stop',
    examples: [
      { cmd: 'construct stop', desc: 'Stop every running service' },
    ],
  },
  {
    name: 'status',
    emoji: '📡',
    category: 'Core',
    core: true,
    description: 'Show system health and credentials',
    usage: 'construct status',
    strictFlags: true,
    examples: [
      { cmd: 'construct status', desc: 'Human-readable health summary' },
      { cmd: 'construct status --json', desc: 'Full payload for scripting' },
    ],
    options: [
      { flag: '--json', desc: 'Output full status payload as JSON' },
    ],
  },
  {
    name: 'workers',
    emoji: '🫀',
    category: 'Core',
    core: true,
    description: 'List shared-deployment worker heartbeats (requires DATABASE_URL; optional for solo)',
    usage: 'construct workers <list> [--json]',
    strictFlags: true,
    examples: [
      { cmd: 'construct workers list', desc: 'Show live/stale registered workers (Postgres)' },
      { cmd: 'construct workers list --json', desc: 'Machine-readable worker status' },
    ],
    options: [
      { flag: '--json', desc: 'Output worker list as JSON' },
    ],
    next: 'Solo/local Construct does not need DATABASE_URL. Shared/team worker leases require Postgres — set DATABASE_URL then `construct db migrate`.',
  },
  {
    name: 'install',
    emoji: '🛠️',
    category: 'Core',
    core: true,
    description: 'Machine setup (footprint per ADR-0029/ADR-0071): --footprint=project|user|both, default project',
    usage: 'construct install [--footprint=project|user|both] [--yes] [--dry-run] [--no-launch-agent] [--reconfigure] [--with-docling]',
    examples: [
      { cmd: 'construct install --dry-run', desc: 'Preview the plan before writing anything' },
      { cmd: 'construct install --footprint=user --yes', desc: 'Non-interactive user-footprint install' },
    ],
    options: [
      { flag: '--footprint=<f>',  desc: 'project (default, no-op + guidance) | user (writes ~/.config/construct/, MCP, ~/.claude/* via consent) | both' },
      { flag: '--yes',            desc: 'Apply defaults without prompts (only meaningful with --footprint=user|both)' },
      { flag: '--dry-run',        desc: 'Preview the install plan (footprints, files, services) without writing anything' },
      { flag: '--no-launch-agent', desc: 'Skip background macOS LaunchAgent registration' },
      { flag: '--reconfigure',    desc: 'Re-prompt for service consent, ignoring cached answers' },
      { flag: '--with-docling',   desc: 'Eagerly provision the docling document-extraction venv now (heavy, ~10 min; else lazy on first ingest)' },
    ],
  },
  {
    name: 'init',
    emoji: '🏗️',
    category: 'Core',
    core: true,
    strictFlags: true,
    description: 'Project setup (once per repo): scaffold .construct/, AGENTS.md, plan.md, adapters',
    usage: 'construct init [path] [options]',
    examples: [
      { cmd: 'construct init --yes', desc: 'Non-interactive scaffold; docs/ only unless you pass a docs pack or lane flags' },
      { cmd: 'construct init --interactive', desc: 'Guided setup: Packs / Individual docs / Skip' },
      { cmd: 'construct init --yes --docs-preset=lean', desc: 'Non-interactive init with the lean docs pack' },
    ],
    options: [
      { flag: '--yes', desc: 'Accept all defaults (non-interactive; auto-runs git init when .git/ is missing)' },
      { flag: '--no-start', desc: 'Do not start services after init' },
      { flag: '--auto-start', desc: 'Start services even in CI/test contexts' },
      { flag: '--no-beads', desc: 'Skip local issue-tracker initialization (CI/ephemeral)' },
      { flag: '--commit-bootstrap', desc: 'Keep the beads bootstrap commit (default: leave files uncommitted)' },
      { flag: '--force', desc: 'Scaffold even when content exists or target is a nested subdirectory' },
      { flag: '--with-<host>', desc: 'Force-include an adapter set (claude|codex|opencode|vscode|cursor|copilot); unions with lean bootstrap (Claude + already-configured project hosts)' },
      { flag: '--all-hosts', desc: 'Write every host adapter set regardless of PATH detection' },
      { flag: '--interactive, -i', desc: 'Enable interactive setup (Packs / Individual docs / Skip)' },
      { flag: '--quiet, -q', desc: 'Minimal output' },
      { flag: '--verbose, -v', desc: 'Detailed output' },
      { flag: '--docs-preset=<pack>', desc: 'Opt into a curated docs pack: lean|product|full (default init is docs/ only)' },
      { flag: '--docs-lanes=<lanes>', desc: 'Opt into specific doc lanes (comma-separated)' },
      { flag: '--with-docs=<lanes>', desc: 'Same as --docs-lanes (comma-separated, or all)' },
      { flag: '--with-all-docs', desc: 'Enable every documentation lane' },
      { flag: '--with-adrs', desc: 'Enable Architecture Decision Records' },
      { flag: '--with-rfcs', desc: 'Enable RFCs (design reviews)' },
      { flag: '--with-runbooks', desc: 'Enable operational runbooks' },
      { flag: '--with-postmortems', desc: 'Enable incident postmortems' },
      { flag: '--with-architecture', desc: 'Create architecture.md' },
      { flag: '--with-readme', desc: 'Create README.md when missing' },
      { flag: '--watch-inbox', desc: 'Enable continuous inbox watching (non-interactive opt-in)' },
      { flag: '--seed-index', desc: 'Embed existing project docs into the local search index' },
      { flag: '--devcontainer', desc: 'Scaffold a .devcontainer/ recipe' },
      { flag: '--workspace-preset=<id>', desc: 'Set the active Workspace Preset in construct.config.json' },
    ],
  },
  {
    name: 'sync',
    emoji: '🔄',
    category: 'Core',
    core: true,
    description: 'Sync agent adapters to AI tools',
    usage: 'construct sync [--project] [--global] [--dry-run] [--no-docs] [--all-hosts] [--with-<host>] [--hosts=<list>]',
    examples: [
      { cmd: 'construct sync', desc: 'Default: project tier when cwd is a Construct project (.construct/); otherwise global/user tier' },
      { cmd: 'construct sync --with-cursor', desc: 'Include Cursor on top of detected hosts (union, does not prune others)' },
      { cmd: 'construct sync --all-hosts', desc: 'Sync every adapter set (claude, codex, opencode, vscode, cursor, copilot)' },
      { cmd: 'construct sync --dry-run', desc: 'Preview adapter changes without writing' },
    ],
    options: [
      { flag: '--project', desc: 'Write only the project tier into the current repo (.claude/, .codex/, …)' },
      { flag: '--global', desc: 'Write only the global/user tier (front door + hooks under ~/); not needed for ordinary project refresh — default already chooses by cwd' },
      { flag: '--dry-run', desc: 'Preview adapter changes without writing files' },
      { flag: '--no-docs', desc: 'Skip AUTO docs regeneration after syncing adapters' },
      { flag: '--with-<host>', desc: 'Force-include an adapter set (claude|codex|opencode|vscode|cursor|copilot); unions with detection unless --hosts= is set' },
      { flag: '--all-hosts', desc: 'Sync every adapter set regardless of what is installed' },
      { flag: '--hosts=<list>', desc: 'Restrict to a comma-separated host list (or all); CONSTRUCT_SYNC_HOSTS= is the env equivalent' },
    ],
  },
  {
    name: 'intake',
    emoji: '📥',
    category: 'Core',
    core: true,
    description: 'View and process the active profile\'s intake queue (queue label varies by profile)',
    usage: 'construct intake list|show|done|skip|reopen|integrate|classify',
    examples: [
      { cmd: 'construct intake list', desc: 'See pending packets' },
      { cmd: 'construct intake done <id> --output=path', desc: 'Mark processed and stamp the artifact' },
    ],
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
    examples: [
      { cmd: 'construct recommendations list', desc: 'See open recommendations' },
      { cmd: 'construct recommendations dismiss <id>', desc: 'Dismiss one by id' },
    ],
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
      { name: 'index', desc: 'Rebuild the local RAG corpus over .construct/ artifacts' },
      { name: 'add --source=research --slug=<id> --topic="..." [--source-url=<url>]', desc: 'Persist a research finding into .construct/knowledge/external/research/' },
    ],
  },
  {
    name: 'synthesize',
    emoji: '🔗',
    category: 'Work',
    core: false,
    description: 'Cross-project synthesis: map each registered project, reduce to an origin-cited answer',
    usage: 'construct synthesize --ask "<question>" [--projects=all|self|id,...] [--template <name>] [--dry-run] [--json]',
    examples: [
      { cmd: 'construct synthesize --ask "summarize each project\'s docs" --projects=all --dry-run', desc: 'Preview the assembled per-project context (no model call)' },
      { cmd: 'construct synthesize --ask "how do these strategies converge" --projects=proj-app,proj-sdk', desc: 'Synthesize a convergence answer across two projects' },
    ],
  },
  {
    name: 'tracker',
    emoji: '📮',
    category: 'Models & Integrations',
    core: false,
    description: 'Analyze registered projects and contribute governed issue proposals to an external tracker (Jira)',
    usage: 'construct tracker contribute --target <id> [--against <ids|all>] | --apply <proposal-id> [--approve <token>]',
    subcommands: [
      { name: 'contribute --target <id> [--against <ids|all>]', desc: 'Analyze corpora vs the tracker and emit an evidence-cited, deduped proposal artifact' },
      { name: 'contribute --apply <proposal-id> [--approve <token>]', desc: 'Apply a proposal: dry-run by default; --approve executes the governed write batch' },
    ],
  },
  {
    name: 'sandbox',
    emoji: '🧪',
    category: 'Core',
    core: true,
    description: 'Isolated tmpdir-based environment for QA and worker dry-runs',
    usage: 'construct sandbox create|list|delete|prune [--profile=<id>]',
    examples: [
      { cmd: 'construct sandbox create --profile=<id>', desc: 'Spin up an isolated sandbox' },
      { cmd: 'construct sandbox prune --days=7', desc: 'Remove sandboxes older than a week' },
    ],
    subcommands: [
      { name: 'create [--profile=<id>]', desc: 'Create a new sandbox under ~/.construct/sandboxes/' },
      { name: 'list', desc: 'List existing sandboxes, newest first' },
      { name: 'delete <id>', desc: 'Remove one sandbox by id' },
      { name: 'prune [--days=N]', desc: 'Remove sandboxes older than N days (default 7)' },
    ],
  },
  {
    name: 'workspace-preset',
    emoji: '🧭',
    category: 'Core',
    core: true,
    description: 'Inspect and apply workspace-wide defaults',
    usage: 'construct workspace-preset list|show|apply',
    examples: [
      { cmd: 'construct workspace-preset list', desc: 'List presets; * marks the active project preset' },
      { cmd: 'construct workspace-preset show', desc: 'Show the active preset for this project' },
      { cmd: 'construct workspace-preset show creative', desc: 'Inspect one catalog preset' },
      { cmd: 'construct workspace-preset apply creative', desc: 'Set construct.config.json workspacePreset' },
      { cmd: 'construct workspace-preset apply creative --docs-preset=lean', desc: 'Apply preset and opt into the lean docs pack' },
    ],
    subcommands: [
      { name: 'list [--grep=<term>]', desc: 'List workspace presets (sorted by id)' },
      { name: 'show [<id>]', desc: 'Show active or named preset summary (--json for full record)' },
      { name: 'apply <id> [--dry-run] [--docs-preset=lean|product|full] [--yes]', desc: 'Validate and persist workspacePreset; docs packs are opt-in via flag or TTY picker' },
    ],
    flags: [
      { flag: '--docs-preset=<pack>', desc: 'Opt into a curated docs pack after apply: lean|product|full (never silent)' },
      { flag: '--yes', desc: 'Skip the interactive docs-pack picker (does not auto-select a pack)' },
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
    name: 'workspace-domain',
    emoji: '🏗️',
    category: 'Work',
    core: false,
    description: 'Workspace domain model (construct-b0nny.22, target-model.md concept 1) — owner, membership, settings, lifecycle. Distinct from `construct workspace` above, which is the unrelated multi-PM signal-routing command.',
    usage: 'construct workspace-domain init|show|activate|archive|member|settings',
    subcommands: [
      { name: 'init [--name=] [--remote=] [--deployment=embedded|shared]', desc: 'Get-or-create the Workspace for this project (id = deriveProjectKey(rootDir))' },
      { name: 'show [--json]', desc: 'Show the current Workspace record' },
      { name: 'activate | archive', desc: 'Validated lifecycle transitions: provisioning -> active -> archived' },
      { name: 'member add <ref> [--role=owner|member] | member remove <ref> | member list', desc: 'Workspace membership (seed for future multi-user authorization)' },
      { name: 'settings get <key> | settings set <key> <value> | settings list', desc: 'Per-workspace settings (JSON-valued)' },
    ],
  },
  {
    name: 'work-spec',
    emoji: '📐',
    category: 'Work',
    core: false,
    description: 'Work spec schema + graph-informed decomposition check (construct-b0nny.23, target-model.md concepts 6/7/9) — cycle detection, declared-dependency graph resolution, and independence-claim verification over a Work spec\'s decomposition.',
    usage: 'construct work-spec build|check|validate --from=<path|-> [--json] [--strict]',
    subcommands: [
      { name: 'build --from=<path|-> [--json] [--strict]', desc: 'Produce a Work spec scoped to this project\'s Workspace, stamped with Sources/Directives context and a graph-checked decomposition report' },
      { name: 'check --from=<path|-> [--json] [--strict]', desc: 'Run the graph-informed decomposition check (cycles, dependency resolution, independence claims) against a caller-supplied spec' },
      { name: 'validate --from=<path|-> [--json]', desc: 'Schema-validate a Work spec without touching the graph or the Workspace store' },
    ],
  },
  {
    name: 'tracker-projection',
    emoji: '🪞',
    category: 'Work',
    core: false,
    description: 'Beads projection, field authority, and reconciliation (construct-b0nny.27, target-model.md concept 16) — treats bd as a projection of the graph-informed Work model with explicit per-field authority, detect-and-report drift, and read-only raw-record-preserving import. Sits behind bd; issues no bd write.',
    usage: 'construct tracker-projection import|reconcile|status [--json] [--strict]',
    subcommands: [
      { name: 'import [--json]', desc: 'Snapshot live bd, build raw-record-preserving projections, persist them, and report zero-data-loss verification' },
      { name: 'reconcile [--json] [--strict]', desc: 'Diff persisted projections against live bd and report drift (domain-owned conflicts vs absorbed tracker updates); --strict exits 1 on drift' },
      { name: 'status [--json]', desc: 'Print the persisted projection summary (counts by lifecycle state)' },
    ],
  },
  {
    name: 'workplace-loop',
    emoji: '🔁',
    category: 'Work',
    core: false,
    description: 'Production sources/directives/workplace loop (construct-b0nny.25) — detects real signals from a connected source, checks them against Workspace strategy, and routes any proposed external effect through the governed-write chokepoint.',
    usage: 'construct workplace-loop detect|request-approval|approve|apply|verify',
    subcommands: [
      { name: 'detect [--repo=owner/name] [--json]', desc: 'Fetch the source, detect/align/filter signals, and produce a gated proposal (or NOTHING_NEW on an unchanged source)' },
      { name: 'request-approval --proposal <id>', desc: 'Enqueue the proposal\'s external effects on the real ApprovalQueue' },
      { name: 'approve --proposal <id> --by <name>', desc: 'Approve the proposal\'s enqueued effects' },
      { name: 'apply --proposal <id>', desc: 'Drain approved effects through the real M2 governed-write chokepoint; refuses if any effect is unapproved' },
      { name: 'verify --proposal <id>', desc: 'Confirm executed effects match the proposal that was approved' },
    ],
  },
  {
    name: 'server',
    emoji: '🌐',
    category: 'Advanced',
    core: false,
    description: 'Shared workspace server with authentication, a Postgres-backed Workspace store, and a worker-claim queue for multi-user deployments.',
    usage: 'construct server start|migrate',
    subcommands: [
      { name: 'start [--host=] [--port=]', desc: 'Start the HTTP server (requires a reachable DATABASE_URL/CONSTRUCT_DATABASE_URL Postgres)' },
      { name: 'migrate', desc: 'Apply pending Postgres migrations and exit (deployment init step)' },
    ],
  },
  {
    name: 'docs',
    emoji: '📄',
    category: 'Core',
    core: true,
    description: 'Documentation commands',
    usage: 'construct docs check|verify|update',
    examples: [
      { cmd: 'construct docs verify', desc: 'Validate the docs tree' },
      { cmd: 'construct docs update', desc: 'Regenerate AUTO-managed regions' },
    ],
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
    usage: 'construct doctor [<status|logs|tick|report|production|consistency|watch|stop|credentials>]',
    examples: [
      { cmd: 'construct doctor', desc: 'Run all health checks once' },
      { cmd: 'construct doctor report', desc: 'Print the latest health report' },
      { cmd: 'construct doctor production', desc: 'Local production go/no-go gate (evidence-based, not pid-alive)' },
    ],
    subcommands: [
      { name: 'status', desc: 'Doctor daemon status' },
      { name: 'logs', desc: 'Tail doctor daemon logs' },
      { name: 'tick', desc: 'Run one doctor daemon check cycle now' },
      { name: 'report', desc: 'Print the latest health report' },
      { name: 'production', desc: 'Local production go/no-go health gate (construct-4uxq0.14.4)' },
      { name: 'consistency', desc: 'Run cross-surface consistency checks' },
      { name: 'watch', desc: 'Start the doctor daemon (continuous checks)' },
      { name: 'stop', desc: 'Stop the doctor daemon' },
      { name: 'credentials', desc: 'Diagnose provider credential resolution' },
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
    usage: 'construct ingest <file> [--strategy=adapter|provider] [--orchestration=prompt-only|orchestrated] [--strict] [--fidelity=fast|high]',
  },
  {
    name: 'export',
    emoji: '📤',
    category: 'Work',
    core: false,
    description: 'Export markdown to PDF, DOCX, HTML, and other Pandoc formats via Pandoc + Typst (optional system binaries; ADR-0024)',
    usage: 'construct export <markdown-file> --to=<pdf|docx|deck|pptx|html|rtf|odt|epub|tex|txt|md|mdx> [--output=<path>] [--figures|--no-figures] [--plain] [--detect]',
    strictFlags: true,
    options: [
      { flag: '--to=<format>', desc: 'pdf, docx, deck, pptx, html, rtf, odt, epub, tex, txt, md, mdx' },
      { flag: '--output=<path>', desc: 'Output path' },
      { flag: '--figures', desc: 'Render d2/mermaid via pandoc-ext/diagram filter' },
      { flag: '--no-figures', desc: 'Skip diagram rendering' },
      { flag: '--plain, --no-brand', desc: 'Explicitly opt out of Construct branding for a brand-capable output' },
      { flag: '--detect', desc: 'Report binary availability (JSON)' },
    ],
  },
  {
    name: 'publish',
    emoji: '📰',
    category: 'Work',
    core: false,
    description: 'Publish typed artifacts: release gate + export PDF with figures + optional demos',
    usage: 'construct publish <markdown> [--to=pdf] [--type=DOC] [--demo=NAME] [--strict]',
    strictFlags: true,
    options: [
      { flag: '--to=<format>', desc: 'pdf (default), docx, deck, pptx, html, rtf, odt, epub, tex, txt, md, mdx' },
      { flag: '--output=<path>', desc: 'Output path (default: .construct/publish/<name>.<format>)' },
      { flag: '--type=<doc-type>', desc: 'Manifest doc type for release gate (inferred when omitted)' },
      { flag: '--demo=<name>', desc: 'Terminal VHS tape to record (repeatable)' },
      { flag: '--recording=<name>', desc: 'Playwright recording manifest (repeatable)' },
      { flag: '--figures', desc: 'Render d2/mermaid via diagram filter (default on)' },
      { flag: '--no-figures', desc: 'Skip diagram filter' },
      { flag: '--preview', desc: 'Render the export to images and report what was verified' },
      { flag: '--no-gate', desc: 'Skip artifact release gate (escape hatch only)' },
      { flag: '--source-only', desc: 'Write sources only' },
      { flag: '--strict', desc: 'Exit 2 when toolchain or release gate fails (default)' },
      { flag: '--no-strict', desc: 'Do not exit 2 on toolchain/gate failure' },
      { flag: '--detect', desc: 'Print tooling JSON and exit' },
    ],
  },
  {
    name: 'tools',
    emoji: '🧰',
    category: 'Work',
    core: false,
    description: 'Detect optional publish pipeline binaries (Pandoc, D2, VHS, Playwright)',
    usage: 'construct tools detect [--json] [--figures] [--demo=NAME]',
    strictFlags: true,
    next: 'Run `construct tools detect` to see which publish binaries are installed.',
    subcommands: [
      { name: 'detect', desc: 'Probe Pandoc/Typst/D2/Mermaid/VHS readiness for `construct publish`' },
    ],
    options: [
      { flag: '--json', desc: 'JSON output' },
      { flag: '--figures', desc: 'Include figure tooling (default on)' },
      { flag: '--no-figures', desc: 'Skip figure binaries' },
      { flag: '--demo=<name>', desc: 'Include terminal demo recorder check' },
    ],
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
    usage: 'construct storage <sync|status|reset|delete-ingested|repair-migrations|migrations|reconcile>',
    subcommands: [
      { name: 'sync', desc: 'Sync file-backed state into shared SQL when configured' },
      { name: 'status', desc: 'Report storage backend status' },
      { name: 'reset', desc: 'Reset storage (--yes required)' },
    ],
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
    usage: 'construct graph <list|show|from-intake|recommend|build|stat|query|validate|verify|impacted|intent|explain|owasp|update|reconcile|queryUp|queryDown|path|orphans|cycles|owners|requirements|export>',
    subcommands: [
      { name: 'recommend --json [--text|--file|<stdin>]', desc: 'Return a role-aware plan for an artifact without enqueuing (embedded contract; alias of intake classify)' },
      { name: 'build|stat|query|validate|verify|explain', desc: 'Living dependency graph — build/inspect/validate/verify the typed file↔capability↔procedure↔test↔embed graph' },
      { name: 'owasp | missing-tests --security', desc: 'OWASP GenAI Top-10 coverage matrix and the procedure/preset security-coverage gap list (LMCP-N8)' },
      { name: 'update | reconcile', desc: 'Relational graph store (construct-b0nny.3): drain the incremental outbox, or diff a fresh rebuild against live state and apply drift' },
      { name: 'queryUp <id> [--rel <r>...] | queryDown <id> [--rel <r>...]', desc: 'Directive §4.8 up/downstream traversal (construct-b0nny.21), rel-filtered and depth-capped (construct-b0nny.12)' },
      { name: 'path <from> <to> | orphans [--capabilities] | cycles [--rel <r>...] | owners <id> | requirements <id> | export [--format]', desc: 'Recursive-CTE query surface backed by the relational store (node:sqlite, Node >=22.5)' },
    ],
  },
  {
    name: 'pack',
    emoji: '📦',
    category: 'Work',
    core: false,
    description: 'Worker profile and workspace preset pack lifecycle',
    usage: 'construct pack <list|enable|disable|info> [--json]',
    subcommands: [
      { name: 'list', desc: 'Every pack discovered across builtin/user/project tiers with its durable enabled state' },
      { name: 'enable <pack-id>[@version]', desc: 'Validate the pack manifest and record it enabled in .construct/packs.json; refuses on an incompatible compatVersion or other validation failure' },
      { name: 'disable <pack-id>', desc: 'Remove the pack\'s enabled entry (idempotent; the core pack cannot be disabled)' },
      { name: 'info <pack-id>', desc: 'Full manifest plus enabled state for one pack' },
    ],
  },
  {
    name: 'models',
    emoji: '🧠',
    category: 'Models & Integrations',
    core: false,
    description: 'Show or update model tier assignments',
    usage: 'construct models <list|set|free|reset|resolve|policy|explain>',
    subcommands: [
      { name: 'list', desc: 'Show current tier assignments' },
      { name: 'set --tier=<reasoning|standard|fast> --model=<model>', desc: 'Set a model for a tier' },
      { name: 'free', desc: 'List available free models' },
      { name: 'reset', desc: 'Reset all tier assignments' },
      { name: 'resolve --json', desc: 'Resolve the model for an embedded procedure given host context' },
      { name: 'policy show', desc: 'Show the effective policy: winning source per tier + work-category map' },
      { name: 'policy set <budget|free|frontier|local>', desc: 'Compute a preset and persist it to registry/models.json' },
      { name: 'explain --worker-profile <id>', desc: 'Per-worker-profile model resolution trace' },
    ],
  },
  {
    name: 'capability',
    emoji: '🧩',
    category: 'Models & Integrations',
    core: false,
    description: 'Inspect typed operations the system can perform',
    usage: 'construct capability list|show|describe',
    subcommands: [
      { name: 'list', desc: 'List capabilities' },
      { name: 'show <id>', desc: 'Show one capability' },
      { name: 'describe', desc: 'Emit the read-only capability contract for this install (--json)' },
    ],
  },
  {
    name: 'execution',
    emoji: '🪢',
    category: 'Models & Integrations',
    core: false,
    description: 'Resolve the execution-capability contract for an embedded procedure (orchestrated vs prompt-only; descriptive, not enforced)',
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
    description: 'Construct-owned local orchestration runtime and readiness preflight',
    usage: 'construct orchestrate <run|status|preflight> [options] [--remote]',
    subcommands: [
      { name: 'run "<request>" [--strategy S] [--host H] [--worker-backend provider] [--no-construct] [--no-execute] [--json] [--remote]', desc: 'Plan and run a request through Construct-owned worker assignments; --remote drives the local daemon over HTTP' },
      { name: 'status [run-id] [--json] [--remote]', desc: 'Inspect a run, or list recent runs (locally or from the daemon)' },
      { name: 'preflight [--host H] [--json] [--no-probe]', desc: 'Verify orchestration tool attachment/readiness and return a typed reason plus recovery step' },
    ],
  },
  {
    name: 'flow',
    emoji: '🧵',
    category: 'Models & Integrations',
    core: false,
    description: 'Deterministic flow-engine runs: start or resume a checkpointed flow, or inspect its status',
    usage: 'construct flow <resume|status> <run-id> [--flow=<path>] [--state=<json>]',
    subcommands: [
      { name: 'resume <run-id> --flow=<path> [--state=<json>]', desc: 'Start (new run-id) or resume a checkpointed flow and drive it to completion' },
      { name: 'status <run-id>', desc: 'Read a flow checkpoint without driving it' },
    ],
  },
  {
    name: 'db',
    emoji: '🗄️',
    category: 'Models & Integrations',
    core: false,
    description: 'Inspect and migrate the optional Postgres backend',
    usage: 'construct db <status|migrate> [--json]',
    subcommands: [
      { name: 'status [--json]', desc: 'Check Postgres reachability and migration state' },
      { name: 'migrate [--json]', desc: 'Apply pending Postgres migrations idempotently' },
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
    description: 'Agent performance review from telemetry (run|legacy), or a deterministic PR-diff review for CI (pr)',
    usage: 'construct review [run|legacy|pr --base=<ref> [--output=<file>]]',
    subcommands: [
      { name: 'run', desc: 'Generate the per-agent performance review from local session costs + telemetry' },
      { name: 'legacy', desc: 'Telemetry pipeline report (requires CONSTRUCT_TELEMETRY_* credentials)' },
      { name: 'pr', desc: 'Deterministic diff review vs a base ref — secret/quality heuristics, no model, no credentials (backs the CI review gate, ADR-0069)' },
    ],
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
    name: 'improvement',
    emoji: '🔁',
    category: 'Observability',
    core: false,
    surface: 'thin-cli',
    description: 'Governed improvement loop — review, approve, and record apply/rollback for proposals',
    usage: 'construct improvement submit|review|pending|show|approve|apply|rollback|list',
  },
  {
    name: 'cleanup',
    emoji: '🧹',
    category: 'Diagnostics',
    core: false,
    description: 'Release dev-agent memory pressure by cleaning stale helper and bridge processes',
    usage: 'construct cleanup [--dry-run] [--quiet] [--pressure-release] [--pressure-only] [--disk-only]',
    strictFlags: true,
    options: [
      { flag: '--dry-run',          desc: 'Show what would be cleaned without changing anything' },
      { flag: '--quiet',            desc: 'Minimal output' },
      { flag: '--pressure-release', desc: 'Also kill stale dev-agent and leaked VHS demo-recorder processes' },
      { flag: '--pressure-only',    desc: 'Pressure release only — skip disk cleanup' },
      { flag: '--disk-only',        desc: 'Disk cleanup only — skip pressure release' },
    ],
  },
  {
    name: 'worker-profile',
    emoji: '👥',
    category: 'Work',
    core: false,
    description: 'Inspect assignable worker configurations',
    usage: 'construct worker-profile <list|show|validate|create>',
    examples: [
      { cmd: 'construct worker-profile list', desc: 'List worker profiles (sorted by id)' },
      { cmd: 'construct worker-profile list --grep=security', desc: 'Filter profiles by id or routing hint' },
      { cmd: 'construct worker-profile show engineer', desc: 'Show one worker profile summary' },
      { cmd: 'construct worker-profile validate --file=.construct/org/worker-profiles/custom.json', desc: 'Validate a custom profile record' },
      { cmd: 'construct worker-profile create widget-worker --description="Owns widget implementation" --skills=development/typescript', desc: 'Scaffold a custom Worker Profile under .construct/org/' },
    ],
    subcommands: [
      { name: 'list [--grep=<term>]', desc: 'List worker profiles (shows active Workspace Preset)' },
      { name: 'show <id>', desc: 'Show one worker profile (--json for full record)' },
      { name: 'validate [--file=<path>]', desc: 'Validate a custom Worker Profile JSON record from stdin or file' },
      { name: 'create <id> [--scope=project|user]', desc: 'Scaffold a custom Worker Profile JSON record and prompt stub (see create --help)' },
    ],
  },
  {
    name: 'audit',
    emoji: '🔍',
    category: 'Diagnostics',
    core: false,
    description: 'Audit Construct internals and review the mutation trail',
    usage: 'construct audit <skills|worker-profiles|prompts-skills|tests|trail>',
    subcommands: [
      { name: 'skills', desc: 'Audit skill corpus coverage and metadata (`--inventory` checks certification skill inventory freshness)' },
      { name: 'worker-profiles', desc: 'Audit worker profile and skill cross-checks' },
      { name: 'prompts-skills', desc: 'Audit obsolete prompts, unrouted skills, and stale role references (`--remediate` fixes MCP catalog usedBy drift)' },
      { name: 'tests', desc: 'Validate behavior-to-test capability traceability (`--corpus` checks test-file inventory)' },
      { name: 'trail', desc: 'Review mutation audit trail' },
    ],
  },
  {
    name: 'certify',
    emoji: '✅',
    category: 'Diagnostics',
    core: false,
    description: 'Inspect and run scenario-based certification under .construct/certification/',
    usage: 'construct certify list|show|scenarios|models|demos|parity|document-io|status|gate|run <scenario-id>|compare',
    subcommands: [
      { name: 'list', desc: 'List recorded certification run ids' },
      { name: 'show', desc: 'Show one certification run record as JSON' },
      { name: 'scenarios', desc: 'List available certification scenarios with model tier' },
      { name: 'models', desc: 'List routable certification models (free by default)' },
      { name: 'demos', desc: 'Canonical demo scenario catalog for Tauri/web/VHS parity' },
      { name: 'parity', desc: 'Cross-surface demo parity report (--write persists under tests/certification/demos/)' },
      { name: 'document-io', desc: 'Export matrix over every output format (--certified hard-fails on a format skipped for a missing engine)' },
      { name: 'status', desc: 'Roll up certification posture across capabilities and surfaces' },
      { name: 'gate', desc: 'Release candidate gate — stale or failing release-critical certification evidence blocks' },
      { name: 'run', desc: 'Execute a scenario (live requires CONSTRUCT_CERTIFY_LIVE=1; paid requires CONSTRUCT_CERTIFY_ALLOW_PAID=1)' },
    ],
  },
  {
    name: 'artifact',
    emoji: '📋',
    category: 'Work',
    core: false,
    description: 'Plan or locally execute manifest-backed artifact procedures with execution provenance',
    usage: 'construct artifact validate <path> --type=<doc-type> [--check-links] [--json] | construct artifact run ...',
    next: 'Run `construct artifact validate path/to/doc.md --type=prd` (unknown --type= lists valid types).',
    subcommands: [
      { name: 'validate <path> --type=<doc-type>', desc: 'Run manifest structure, citation, and reviewer checks' },
      { name: 'run', desc: 'Return a truthful plan/run report; --apply only runs local validation/export after approval' },
    ],
    options: [
      { flag: '--type=<doc-type>', desc: 'Registered artifact class (prd, adr, research-brief, …); required for validate' },
      { flag: '--check-links', desc: 'Fetch http(s) citation URLs and fail on broken links' },
      { flag: '--no-check-links', desc: 'Skip link fetch even when the type enables citationLint' },
      { flag: '--json', desc: 'Emit the gate result as JSON' },
      { flag: '--recruited=<csv>', desc: 'Condition-recruited reviewer ids for enforced reviewerGate' },
    ],
    examples: [
      { cmd: 'construct artifact validate docs/specs/prd/example.md --type=prd', desc: 'Validate a PRD against the release gate' },
      { cmd: 'construct artifact validate brief.md --type=research-brief --check-links', desc: 'Validate a research brief and fetch cited URLs' },
    ],
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
    description: 'Capture improvement feedback and update Construct core',
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
    name: 'diagram',
    emoji: '📊',
    category: 'Work',
    core: false,
    description: 'Render code-driven diagrams via D2/Graphviz (optional system binaries; ADR-0001)',
    usage: 'construct diagram <description> [--type=architecture|flow|sequence|state|er|class] [--format=svg|png] [--theme=<name>] [--out=<path>] [--source-only]',
    strictFlags: true,
    options: [
      { flag: '--type=<t>',     desc: 'architecture (default) | flow | sequence | state | er | class' },
      { flag: '--format=<f>',   desc: 'svg (default) | png' },
      { flag: '--theme=<name>', desc: 'D2 theme name (e.g. neutral, sketch, cool-classics)' },
      { flag: '--out=<path>',   desc: 'Output path (default: .construct/diagrams/<slug>-<ts>.<ext>)' },
      { flag: '--source-only',  desc: 'Always write the source file; skip rendering' },
    ],
  },
  {
    name: 'demo',
    emoji: '🎬',
    category: 'Work',
    core: false,
    description: 'Run guided tours or record VHS/asciinema tapes',
    usage: 'construct demo <list|init|record|tour|name> [--surface=tape|playwright] [--format=gif|mp4|webm] [--out=<path>] [--source-only]',
    strictFlags: true,
    options: [
      { flag: '--surface=<s>', desc: 'tape (default) | playwright' },
      { flag: '--accessible', desc: 'Screen-reader-friendly linear tour renderer' },
      { flag: '--skip-input', desc: 'Tour: auto-advance without waiting for Enter (headless/CI)' },
      { flag: '--format=<f>',  desc: 'gif (default) | mp4 | webm (tape surface only)' },
      { flag: '--out=<path>',  desc: 'Output path (tape recording)' },
      { flag: '--from=<t>',    desc: 'Template for init: quickstart | diagram' },
      { flag: '--from-project', desc: 'init: scaffold a project demo plug-in under .construct/demos/' },
      { flag: '--source-only', desc: 'Tape: write .tape only; skip recording' },
    ],
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
    name: 'contract',
    emoji: '⚖️',
    category: 'Work',
    core: false,
    description: 'Inspect and clear the contract enforcement ladder gating an artifact',
    usage: 'construct contract <status|sign-off|override> ...',
    next: 'Run `construct contract status <artifact>` to see which contracts gate it and what would clear them.',
    subcommands: [
      { name: 'status <artifact> [--type=<t>] [--json]', desc: 'Show which contracts gate an artifact and what would clear them' },
      { name: 'sign-off <contract-id> --as=<worker-profile>', desc: 'Record an approval; the only thing that clears a hard rung' },
      { name: 'override <contract-id> --reason=<text>', desc: 'Proceed past a soft rung, recorded in the audit trail' },
    ],
    options: [
      { flag: '--type=<artifact-type>', desc: 'Artifact class used for trigger matching; inferred from the path when omitted' },
      { flag: '--as=<worker-profile>', desc: "Approving Worker Profile; must be named in the contract's approvalWorkerProfiles" },
      { flag: '--artifact=<path>', desc: 'Scope the record to one artifact; omit to record it contract-wide' },
      { flag: '--reason=<text>', desc: 'Required for override — an unexplained override is indistinguishable from a missing gate' },
      { flag: '--actor=<name>', desc: 'Human or process recording the decision, carried into the audit entry' },
      { flag: '--json', desc: 'Emit the gate evaluation as JSON' },
    ],
    examples: [
      { cmd: 'construct contract status docs/memo.md --type=compliance-memo', desc: 'Show the contracts gating a compliance memo' },
      { cmd: 'construct contract sign-off legal-compliance-to-release-manager --as=security', desc: 'Clear a hard rung with an approver sign-off' },
    ],
  },
  {
    name: 'sources',
    emoji: '🔗',
    category: 'Advanced',
    core: false,
    description: 'Manage typed integration source targets in construct.config.json',
    usage: 'construct sources list|add|remove|validate|sync|link|unlink',
    subcommands: [
      { name: 'list', desc: 'Show config targets, legacy env merge, corpus freshness, and effective set' },
      { name: 'add <provider> <id> <selector-json>', desc: 'Add a typed target (directory, github, jira, linear, slack)' },
      { name: 'remove <id>', desc: 'Remove a config target by id' },
      { name: 'validate', desc: 'Validate sources.targets in construct.config.json' },
      { name: 'sync [<id>]', desc: 'Clone/fetch the content cache for corpus targets' },
    ],
  },
  {
    name: 'monitor',
    emoji: '🛰️',
    category: 'Advanced',
    core: false,
    description: 'One-command setup for continuous monitoring-as-a-role: sources.targets + embed.yaml roles + capability enable + daemon start',
    usage: 'construct monitor --as <capability-id> --targets <provider:value>[,...] [--secondary <role>] [--config <path>] [--no-start] [--supervise]',
    options: [
      { flag: '--as <capability-id>', desc: 'Embed capability to enable (see `construct embed list`); its worker profile becomes embed.yaml roles.primary' },
      { flag: '--targets <spec>[,<spec>...]', desc: 'Comma-separated provider:value targets (e.g. github:org/repo, jira:PROJ, slack:channel:intent); repeatable' },
      { flag: '--secondary <role>', desc: 'Set embed.yaml roles.secondary' },
      { flag: '--config <path>', desc: 'embed.yaml path (default: ./embed.yaml)' },
      { flag: '--no-start', desc: 'Assemble config and enable the capability but do not start the daemon' },
      { flag: '--supervise', desc: 'Also install OS-level supervision (construct embed supervise) after starting' },
    ],
  },
  {
    name: 'templates',
    emoji: '📝',
    category: 'Advanced',
    core: false,
    description: 'List doc templates and register custom document classes (project-tier overlay; builtin manifest untouched)',
    usage: 'construct templates list|register <type>',
    subcommands: [
      { name: 'list', desc: 'Show shipped templates and project overrides' },
      { name: 'register <type> [--description "..."] [--from <file>] [--force]', desc: 'Register a custom doc class: writes .construct/templates/docs/<type>.md + a project artifact-manifest overlay entry' },
    ],
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
      { flag: '--keep-state',       desc: 'Only remove the launcher + adapters; preserve .construct/, ~/.config/construct, Postgres' },
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
    description: 'List worker profiles (shortcut for worker-profile list); shows active Workspace Preset',
    usage: 'construct list [--json]',
    options: [
      { flag: '--json', desc: 'Output worker profiles as JSON' },
    ],
    next: 'Prefer `construct worker-profile list` for the catalog command with show support.',
  },
  {
    name: 'role',
    emoji: '🎭',
    category: 'Advanced',
    core: false,
    description: 'Worker Profile invocation queue (event-driven dispatch)',
    usage: 'construct role <list|latest|show|status|resolve|prune|reset>',
    subcommands: [
      { name: 'list', desc: 'Show pending Worker Profile invocations' },
      { name: 'latest', desc: 'Show the most recent unresolved invocation brief' },
      { name: 'show <fingerprint>', desc: 'Show one invocation by fingerprint' },
      { name: 'status', desc: 'List onboarded Worker Profiles and their event types' },
      { name: 'resolve <fingerprint>', desc: 'Mark one invocation resolved' },
      { name: 'prune', desc: 'Drop resolved and TTL-expired queue entries' },
      { name: 'reset', desc: 'Clear the pending invocation queue' },
    ],
    next: 'For the Worker Profile catalog, use `construct worker-profile list`. This command manages the event-driven invocation queue.',
  },
  {
    name: 'embed',
    emoji: '🔁',
    category: 'Advanced',
    core: false,
    description: 'Embed mode management',
    usage: 'construct embed start|stop|status|snapshot|migrate-model|list|enable|disable|dry-run|assignments|supervise|unsupervise',
    subcommands: [
      { name: 'start', desc: 'Fork the detached embed daemon' },
      { name: 'stop', desc: 'Stop the running embed daemon' },
      { name: 'status [<id>] [--json]', desc: 'Daemon status, or per-capability bindings/filter/runtime/last-tick with an id' },
      { name: 'snapshot', desc: 'Write an embed daemon state snapshot' },
      { name: 'migrate-model', desc: 'Reconcile embedding schema/dim after CONSTRUCT_EMBEDDING_MODEL changes' },
      { name: 'list [--json]', desc: 'Available embed capabilities and per-project enabled state (ADR-0061)' },
      { name: 'enable <id>', desc: 'Enable an embed capability: validate and write .construct/embed/<id>.manifest.json' },
      { name: 'disable <id>', desc: 'Disable an embed capability (idempotent)' },
      { name: 'dry-run <id> [--json]', desc: 'Resolve the worker-profile→providers→filter→framework→authority→runtime chain; no side effects' },
      { name: 'assignments', desc: 'List or inspect standing embed assignments' },
      { name: 'supervise', desc: 'Install OS-level supervision (launchd/systemd) for the embed daemon' },
      { name: 'unsupervise', desc: 'Remove OS-level supervision for the embed daemon' },
    ],
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
    usage: 'construct skills <coverage|apply|suggest|routing>',
    subcommands: [
      { name: 'coverage', desc: 'Show skill coverage for the active workspace preset' },
      { name: 'apply', desc: 'Apply skill profile to host config' },
      { name: 'suggest', desc: 'Rank skills for an intent string' },
      { name: 'routing', desc: 'Dump machine-readable routing table' },
    ],
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
      { flag: 'parity', desc: 'Show and validate capability parity across solo, multi-user, and enterprise deployments' },
      { flag: '--json', desc: 'Emit the parity contract as JSON' },
    ],
  },
  {
    name: 'policy',
    emoji: '🔒',
    category: 'Advanced',
    core: false,
    description: 'Inspect rules governing authority, approval, and external effects',
    usage: 'construct policy list|show',
    subcommands: [
      { name: 'list', desc: 'List policies' },
      { name: 'show <id>', desc: 'Show one policy' },
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
    usage: 'construct provider list|status|health|validate|test|add|configure',
    subcommands: [
      { name: 'list', desc: 'List all resolved providers with capabilities and health' },
      { name: 'status [--json]', desc: 'Alias of list with breaker state, degradation, and active filter columns' },
      { name: 'health [id] [--json]', desc: 'Run health probes; exits non-zero if any probe fails' },
      { name: 'validate <path|id> [--strict] [--json]', desc: 'Validate a manifest file or provider id against the B1 schema' },
      { name: 'info <id>', desc: 'Show a single provider\'s metadata and config schema' },
      { name: 'test <id>', desc: 'Run one provider\'s health probe; exits non-zero on failure' },
      { name: 'add <id> [--json]', desc: 'Scaffold instance config from the provider\'s configSchema defaults, persisted to .construct/providers/<id>.json' },
      { name: 'configure <id> [--key.path value ...] [--json]', desc: 'Merge + validate instance config (incl. ADR-0060 filter block) against configSchema; rejects with the schema path on failure' },
      { name: 'plugins <add|remove> <id> [<package>] [--global]', desc: 'Register or remove a plugin provider override' },
      { name: 'new <name> [--capabilities=...]', desc: 'Scaffold a new provider module' },
    ],
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
    name: 'approvals',
    emoji: '✅',
    category: 'Core',
    core: true,
    description: 'Manage pending MCP tool approvals',
    usage: 'construct approvals list|approve|deny|status',
    subcommands: [
      { name: 'list', desc: 'List pending approvals with tool name, requestedAt, requestedBy' },
      { name: 'approve <id>', desc: 'Approve a pending approval by id' },
      { name: 'deny <id> [--reason=...]', desc: 'Deny a pending approval by id' },
      { name: 'status <id>', desc: 'Show the full status of a specific approval' },
    ],
  },
  {
    name: 'directives',
    emoji: '📋',
    category: 'Core',
    core: true,
    description: 'View standing directives (construct.config.json directives[]) and their due status',
    usage: 'construct directives list|status',
    subcommands: [
      { name: 'list', desc: 'List configured directives and their due status' },
      { name: 'status <id>', desc: 'Show the full status of a specific directive' },
    ],
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
    description: 'Manage provider credentials (login, set, rotate, revoke, list, test)',
    usage: 'construct creds <list|login|set|rotate|revoke|test>',
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
    name: 'procedure',
    emoji: '🔄',
    category: 'Work',
    core: false,
    description: 'Inspect and invoke reusable deterministic procedures',
    usage: 'construct procedure <list|show|invoke>',
    subcommands: [
      { name: 'list', desc: 'List procedures' },
      { name: 'show <id>', desc: 'Show one procedure' },
      { name: 'invoke --json --procedure-id <id> [--text|--file|<stdin>]', desc: 'Invoke a Procedure non-interactively with approval gating and provenance (embedded contract)' },
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
    description: 'List and inspect session handoff files in .construct/handoffs/',
    usage: 'construct handoffs <list|show>',
  },
  {
    name: 'feedback:record',
    emoji: '📝',
    category: 'Observability',
    core: false,
    description: 'Record an outcome rating for a recent worker invocation',
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
    description: 'Regenerate generated reference pages under docs/guides/reference/',
    usage: 'construct docs:site [--check]',
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
  { name: 'init:update',       category: 'Internal', core: false, internal: true, description: 'Internal: re-run init scaffolding for an existing project', usage: 'construct init:update' },
  { name: 'lint:worker-profiles', category: 'Internal', core: false, internal: true, description: 'Internal lint: worker profile definitions', usage: 'construct lint:worker-profiles' },
  { name: 'lint:comments',     category: 'Internal', core: false, internal: true, description: 'Internal lint: source comments', usage: 'construct lint:comments' },
  { name: 'lint:contracts',    category: 'Internal', core: false, internal: true, description: 'Internal lint: registry contracts', usage: 'construct lint:contracts' },
  { name: 'lint:research',     category: 'Internal', core: false, internal: true, description: 'Internal lint: research artifacts', usage: 'construct lint:research' },
  { name: 'lint:templates',    category: 'Internal', core: false, internal: true, description: 'Internal lint: shipped templates', usage: 'construct lint:templates' },
  { name: 'registry:status',   category: 'Internal', core: false, internal: true, surface: 'internal', description: 'Dev: capability registry inspector', usage: 'construct registry:status [--json]' },
  { name: 'registry:validate', category: 'Internal', core: false, internal: true, surface: 'internal', strictFlags: true, description: 'Validate the capability catalog or complete canonical registry', usage: 'construct registry:validate [--json] [--unified]', options: [
    { flag: '--json', desc: 'Emit the validation report as JSON' },
    { flag: '--unified', desc: 'Validate every canonical registry catalog instead of only the capability catalog' },
  ] },
  { name: 'registry:generate-docs', category: 'Internal', core: false, internal: true, surface: 'internal', description: 'Generate docs/guides/reference/capabilities.md from registry', usage: 'construct registry:generate-docs' },
  { name: 'oracle', emoji: '🔮', category: 'Core', core: true, description: 'Oracle meta-controller — fleet health review and bounded-auto maintenance', usage: 'construct oracle status|review|pending|approve|gaps|reconcile|invariants|impact|semantic-review|miss|miss-analysis' },
  { name: 'impact', category: 'Diagnostics', core: false, internal: false, surface: 'thin-cli', description: 'Change-impact analysis — map changed files to affected tests, capabilities, and procedures', usage: 'construct impact [files…] [--stdin] [--run] [--json]' },
  { name: 'rules', category: 'Diagnostics', core: false, internal: false, surface: 'thin-cli', description: 'Rule and hook reference telemetry rollup', usage: 'construct rules usage [--since=30d]' },
  { name: 'evaluator:rubrics', category: 'Internal', core: false, internal: true, description: 'Internal: list registered evaluator rubrics', usage: 'construct evaluator:rubrics' },
  { name: 'activation:status', category: 'Internal', core: false, internal: true, description: 'Internal: agent activation telemetry', usage: 'construct activation:status' },
  { name: 'prune',             category: 'Internal', core: false, internal: true, description: 'Internal: prune ephemeral storage entries', usage: 'construct prune' },
  { name: 'overrides',         category: 'Internal', core: false, internal: true, description: 'Internal: list project overrides over the catalog', usage: 'construct overrides' },
  { name: 'resources',         category: 'Internal', core: false, internal: true, description: 'Internal: resource probe', usage: 'construct resources' },
];

for (const cmd of CLI_COMMANDS) {
  if (!cmd.surface) cmd.surface = surfaceForCommand(cmd.name);
}

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

/** Retired top-level commands — still rejected, but with a canonical pointer. */
export const RETIRED_COMMAND_HINTS = Object.freeze({
  specialist: { replacement: 'worker-profile', note: 'Worker Profile replaced the specialist command in Construct 2.0.' },
  specialists: { replacement: 'worker-profile', note: 'Worker Profile replaced the specialists command in Construct 2.0.' },
  persona: { replacement: 'worker-profile', note: 'Worker Profile replaced the persona command in Construct 2.0.' },
  personas: { replacement: 'worker-profile', note: 'Worker Profile replaced the personas command in Construct 2.0.' },
  scope: { replacement: 'workspace-preset', note: 'Workspace Preset replaced the scope command in Construct 2.0.' },
  team: { replacement: 'worker-profile', note: 'Teams were retired in Construct 2.0; assign work via Worker Profiles.' },
  workflow: { replacement: 'procedure', note: 'Procedure replaced the workflow command in Construct 2.0.' },
  matrix: { replacement: 'graph', note: 'construct graph replaced the matrix alias (ADR-0053; alias removed after sunset).' },
});

export function editDistance(a, b) {
  if (a === b) return 0;
  if (!a.length || !b.length) return Math.max(a.length, b.length);
  const row = Array(b.length + 1).fill(0).map((_, i) => i);
  for (let i = 1; i <= a.length; i += 1) {
    let prev = i;
    for (let j = 1; j <= b.length; j += 1) {
      const cur = a[i - 1] === b[j - 1]
        ? row[j - 1]
        : 1 + Math.min(row[j - 1], row[j], prev);
      row[j - 1] = prev;
      prev = cur;
    }
    row[b.length] = prev;
  }
  return row[b.length];
}

/** Prefix → substring → Levenshtein (≤2) suggestion against a candidate list. */
export function suggestClosestMatch(input, candidates, { maxDistance = 2 } = {}) {
  if (!input || !candidates?.length) return null;
  const prefix = candidates.find((n) => n.startsWith(input));
  if (prefix) return prefix;
  const substring = candidates.find((n) => n.includes(input));
  if (substring) return substring;
  let bestDist = maxDistance + 1;
  let suggestion = null;
  for (const name of candidates) {
    const d = editDistance(input, name);
    if (d < bestDist) { bestDist = d; suggestion = name; }
  }
  return bestDist <= maxDistance ? suggestion : null;
}

export function formatRetiredCommandHint(name) {
  const hint = RETIRED_COMMAND_HINTS[name];
  if (!hint) return null;
  if (hint.replacement) {
    return `Did you mean construct ${hint.replacement}? ${hint.note}`;
  }
  return hint.note;
}

// Render a per-command help block. Pulls usage, description, subcommands,
// and options from the CLI_COMMANDS entry so help stays consistent across
// every command. Internal commands fall back to a minimal block.

export function formatCommandHelp(name, { colors = false } = {}) {
  const c = resolveUiColors({ enabled: colors });
  const linksOn = terminalLinksEnabled(process.env);
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
    const subs = [...spec.subcommands].sort((a, b) => a.name.localeCompare(b.name));
    const width = Math.max(...subs.map((s) => s.name.length));
    for (const sub of subs) {
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

  if (spec.examples && spec.examples.length > 0) {
    lines.push(`${c.bold}Examples${c.reset}`);
    for (const ex of spec.examples) {
      lines.push(`  ${ex.cmd}`);
      if (ex.desc) lines.push(`    ${c.dim}${ex.desc}${c.reset}`);
    }
    lines.push('');
  }

  // Every help block closes with the obvious next action: an explicit `next`,
  // else "run a subcommand" for grouped commands, plus a See also pointer to the
  // full reference — so no surface is a dead end.

  const firstSub = spec.subcommands?.[0]?.name.split(/\s+/)[0];
  const next = spec.next
    || (firstSub ? `Run \`construct ${spec.name} ${firstSub}\` to start; add --help to any subcommand for details.` : null);
  if (next) {
    lines.push(`${c.dim}Next:${c.reset} ${next}`);
    lines.push('');
  }
  const cliDocs = formatPathLink('docs/guides/reference/cli/', c, { enabled: linksOn });
  lines.push(`${c.dim}See also:${c.reset} run \`construct --help\` for all commands; full reference in ${cliDocs}.`);
  lines.push('');
  return lines.join('\n');
}
