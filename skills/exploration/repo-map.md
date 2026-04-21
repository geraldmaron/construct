<!--
skills/exploration/repo-map.md — Repo Exploration — Codebase Mapping Playbook — Use this skill when entering an unfamiliar codebase, doing deep investigation wo

Use this skill when entering an unfamiliar codebase, doing deep investigation work, or producing a `.cx/codebase-map.md` artifact for future sessions. Agents: `
-->
# Repo Exploration — Codebase Mapping Playbook

Use this skill when entering an unfamiliar codebase, doing deep investigation work, or producing a `.cx/codebase-map.md` artifact for future sessions.

Agents: `cx-explorer` (primary), `cx-debugger` (tracing failures), `cx-architect` (architecture questions)

---

## Phase 1: Orient (5 minutes max)

Answer these questions before reading any source files:

```
What is this project?       → README.md, package.json description, go.mod module name
What language/runtime?      → file extensions, Dockerfile, .tool-versions, .nvmrc
How do I run it?            → Makefile, justfile, package.json scripts, Procfile, README "Quick Start"
How do I test it?           → CI config (.github/workflows/, .circleci/, Jenkinsfile)
What does it depend on?     → package.json/go.mod/Cargo.toml/requirements.txt top-level deps
How old / active is it?     → git log --oneline -10, git shortlog -sn --no-merges | head -5
```

Commands:
```bash
cat README.md | head -80
cat package.json 2>/dev/null || cat go.mod 2>/dev/null || cat Cargo.toml 2>/dev/null
ls -la
git log --oneline -10
git shortlog -sn --no-merges | head -5
find . -name "Makefile" -o -name "justfile" | head -3
```

---

## Phase 2: Map the Structure

### 2a. Top-level inventory
```bash
ls -la                          # root entries
find . -maxdepth 2 -type d \
  ! -path '*/node_modules/*' \
  ! -path '*/.git/*' \
  ! -path '*/vendor/*' \
  ! -path '*/.next/*' \
  ! -path '*/dist/*' \
  ! -path '*/__pycache__/*'
```

Classify each top-level directory as one of:
- **entry** — main executables, CLIs, servers (cmd/, bin/, app/, main.*)
- **lib** — shared library code (lib/, pkg/, src/, internal/)
- **ui** — frontend/views (web/, frontend/, views/, components/)
- **config** — configuration, env templates (.env.example, config/, etc/)
- **infra** — deployment, CI/CD, Docker (deploy/, k8s/, .github/, terraform/)
- **test** — test-only code (test/, tests/, __tests__/, spec/)
- **docs** — documentation (docs/, .cx/)
- **generated** — auto-generated, do not read (dist/, build/, .next/, vendor/)

### 2b. Entry points

Find where execution begins:
```bash
# Node/Bun
cat package.json | python3 -c "import json,sys; p=json.load(sys.stdin); print(p.get('main',''), p.get('scripts',{}))"

# Go
find . -name "main.go" ! -path '*/vendor/*'

# Python
find . -name "__main__.py" -o -name "wsgi.py" -o -name "asgi.py" | head -5

# Rust
grep -r "fn main" --include="*.rs" -l | head -5

# Shell
grep -rl "#!/" --include="*.sh" . | head -5
```

### 2c. Dependency graph (module level)

```bash
# What imports what?
# Node — find the most imported internal modules
grep -rh "from '\.\." --include="*.ts" --include="*.tsx" --include="*.js" . \
  ! -path '*/node_modules/*' | sort | uniq -c | sort -rn | head -20

# Go
grep -rh '".*/' --include="*.go" . ! -path '*/vendor/*' \
  | grep -v 'github.com/\|golang.org/' | sort | uniq -c | sort -rn | head -20

# Python
grep -rh "^from \." --include="*.py" . | sort | uniq -c | sort -rn | head -20
```

---

## Phase 3: Trace the Hot Paths

A "hot path" is the most important flow in the system. For most projects that's one of:
- **Web API**: HTTP request → middleware → handler → service → DB → response
- **CLI**: parse args → load config → execute command → output
- **Worker**: consume queue → process → persist → emit event
- **UI**: user action → state update → API call → render

### Find the hot path:

```bash
# Largest files (usually core logic, not generated)
find . -name "*.ts" -o -name "*.go" -o -name "*.py" -o -name "*.rs" \
  ! -path '*/node_modules/*' ! -path '*/vendor/*' ! -path '*/dist/*' \
  | xargs wc -l 2>/dev/null | sort -rn | head -20

# Most-changed files (highest churn = highest importance)
git log --format=format: --name-only | grep -v '^$' | sort | uniq -c | sort -rn | head -20

# Most-imported files (highest fan-in = highest centrality)
# (see Phase 2c commands above)
```

### Trace one hot path end to end:

1. Pick the most central handler/service file
2. Read it fully
3. Follow every dependency one level deep
4. Stop when you hit: external library call, DB query, external API call, or file I/O

Document as: `ENTRY → fn1() → fn2() → fn3() → [DB|API|FS]`

---

## Phase 4: Identify Conventions

Answer these by reading 3–5 files in each category:

**Naming**: camelCase? snake_case? PascalCase for types? Consistent file naming?

**Error handling**: Throw/catch? Result type? Custom error types? Error logged or propagated?

**Testing**: Co-located tests (`*.test.ts`)? Separate `/test` dir? Fixtures? Mocking approach?

**Dependencies**: Injected? Global singletons? Module-level init?

**Configuration**: Env vars only? Config files? Validation at startup?

**Auth pattern**: Middleware? Guard functions? Where are permissions enforced?

```bash
# Find test files
find . -name "*.test.*" -o -name "*.spec.*" ! -path '*/node_modules/*' | head -20
find . -path '*/test*' -name "*.go" | head -10

# Find error types / custom errors
grep -rl "class.*Error\|type.*Error\|errors.New\|fmt.Errorf" --include="*.ts" --include="*.go" . \
  ! -path '*/node_modules/*' | head -10
```

---

## Phase 5: Detect Debt and Gaps

```bash
# TODOs and FIXMEs (volume = debt signal)
grep -rn "TODO\|FIXME\|HACK\|XXX\|NOSONAR" \
  ! -path '*/node_modules/*' ! -path '*/.git/*' | wc -l

grep -rn "TODO\|FIXME\|HACK" \
  ! -path '*/node_modules/*' ! -path '*/.git/*' | head -20

# Commented-out code
grep -rn "^[[:space:]]*//.*[a-zA-Z].*[a-zA-Z]" --include="*.ts" --include="*.go" . \
  ! -path '*/node_modules/*' | grep -v "http\|Copyright\|License" | head -20

# Missing test coverage signals
find . -name "*.ts" ! -name "*.test.ts" ! -name "*.d.ts" ! -path '*/node_modules/*' \
  | while read f; do
    base="${f%.ts}"
    [ ! -f "${base}.test.ts" ] && echo "no test: $f"
  done | head -20

# Stale dependencies
npm outdated 2>/dev/null | head -20
go list -m -u all 2>/dev/null | grep '\[' | head -20
```

---

## Phase 6: Produce the Map

Write `.cx/codebase-map.md` in the project root using this template:

```markdown
# Codebase Map — {project-name}

Generated: {date}
Mapped by: cx-explorer

## Overview
{1-3 sentences: what this is, what it does, who uses it}

## Tech Stack
- Runtime: {language + version}
- Framework: {main framework}
- Database: {DB + ORM if any}
- Key deps: {3-5 most important libraries}
- Test framework: {test runner}

## Structure
| Directory | Role |
|---|---|
| `cmd/` | Entry points — CLI commands |
| `internal/` | Core domain logic |
| `pkg/` | Shared libraries |
| ... | ... |

## Entry Points
- `{file}:{function}` — {what triggers it, e.g. "HTTP server start"}
- `{file}:{function}` — {e.g. "CLI entrypoint"}

## Hot Paths
### {Primary flow name, e.g. "API Request → Response"}
`handler.ts:handleRequest` → `service.ts:processRequest` → `db.ts:query` → response

### {Secondary flow if applicable}
...

## Key Conventions
- **Errors**: {how errors are handled}
- **Config**: {how config is loaded}
- **Auth**: {where auth is enforced}
- **Testing**: {test file location + approach}
- **Naming**: {naming conventions observed}

## Files to Know
| File | Why It Matters |
|---|---|
| `{path}` | {e.g. "Central router — all HTTP routes defined here"} |
| `{path}` | {e.g. "DB connection pool — touch before any DB work"} |
| `{path}` | {e.g. "Auth middleware — all protected routes pass through here"} |

## Debt + Watch Areas
- {TODO/FIXME count}: {N} open TODOs, concentrated in {area}
- {Testing gap}: {which modules lack test coverage}
- {Outdated deps}: {specific dep names if notable}
- {Other}: {anything surprising or risky}

## What to Read First
If you're about to {do X}, start with: {file or path}
If you're about to {do Y}, start with: {file or path}
```

---

## Quick Reference — Useful One-Liners

```bash
# File count by extension
find . ! -path '*/node_modules/*' ! -path '*/.git/*' -type f \
  | sed 's/.*\.//' | sort | uniq -c | sort -rn | head -15

# Largest directories
du -sh */ 2>/dev/null | sort -rh | head -10

# Recent hot files (changed in last 30 days)
git log --since="30 days ago" --format=format: --name-only \
  | grep -v '^$' | sort | uniq -c | sort -rn | head -20

# Who knows this codebase
git shortlog -sn --no-merges | head -10

# Find config/env loading
grep -rn "process.env\|os.Getenv\|os.environ\|dotenv" \
  ! -path '*/node_modules/*' -l | head -10

# Find all HTTP routes
grep -rn "router\.\|app\.get\|app\.post\|http\.HandleFunc\|@Get\|@Post" \
  ! -path '*/node_modules/*' | head -20

# Find DB schema / models
find . -name "schema.*" -o -name "models.*" -o -name "*.prisma" \
  -o -name "*_migration*" ! -path '*/node_modules/*' | head -10
```

---

## Agent Handoffs

After producing `.cx/codebase-map.md`:

- **Explain architecture decisions** → `cx-architect`
- **Trace a specific failure** → `cx-debugger` (provide the codebase-map as context)
- **Check security posture** → `cx-security` (highlight auth files from the map)
- **Assess test coverage** → `cx-qa` (provide the files-to-know list)
- **Understand a library used** → `cx-docs-researcher` (provide the dep name)
