---
name: exploration-unknown-codebase-onboarding
description: Use when entering an unfamiliar codebase for the first time, or when the task requires understanding a system you haven't touched before.
inputs: [codebase, repo]
artifactType: guidance
---
# Unknown Codebase Onboarding

Use when entering an unfamiliar codebase for the first time, or when the task requires understanding a system you haven't touched before.

## First-hour checklist (orientation)

The goal in the first hour is to build a mental model of the system's shape, not to understand every detail.

**1. Start with the entry points:**
```bash
# What runs? What are the main binaries / services?
ls bin/ scripts/ cmd/ src/main*

# What does the README say is the first command to run?
cat README.md | head -60
```

**2. Understand the dependency graph:**
```bash
cat package.json | jq '{name, version, scripts, dependencies: (.dependencies | keys), devDependencies: (.devDependencies | keys)}'
# or: cat Cargo.toml, go.mod, pom.xml, requirements.txt
```

**3. Find the test suite:**
```bash
ls tests/ test/ spec/ __tests__/
# What's the test runner? How do you run it?
grep -i test package.json | head -5
```

**4. Find the data model:**
```bash
ls db/ schema/ migrations/ prisma/ models/
# For a service: what does it store, and how is it structured?
```

**5. Trace one request end-to-end:**
Pick the simplest happy path through the system and trace it from entry point to output. This reveals the architectural seams and where decisions live.

## First-day checklist (orientation to action)

**Identify the change surface:**
- What is the most recently changed directory? (`git log --name-only --pretty=format: | sort | uniq -c | sort -rn | head -20`)
- What directories do most PRs touch? High-churn areas are where active work lives.

**Understand the invariants:**
- Are there comments marked `INVARIANT`, `IMPORTANT`, `DO NOT CHANGE`, or `CRITICAL`? These are the load-bearing beliefs.
- Are there tests marked `regression` or referencing bug IDs? These document specific failure modes.

**Find the configuration layer:**
```bash
# Environment variables the system reads
grep -r 'process\.env\.\|os\.environ\|getenv' --include='*.js' --include='*.py' --include='*.go' | grep -v test | grep -v node_modules
```

**Identify the seams:**
- Where does the system boundary end? What does it call out to (APIs, databases, queues)?
- What are the contracts at those seams (types, schemas, documented expectations)?

## First-week checklist (productive contribution)

**Build a dependency map:**
- Which modules are leaf nodes (pure logic, few dependencies)?
- Which modules are hubs (imported everywhere, high coupling)?
- Leaf nodes are safe to modify; hub changes have blast radius.

**Read the ADRs and postmortems:**
- Architecture decisions (`docs/adr/`, `decisions/`, `DECISIONS.md`) explain why the code is shaped the way it is.
- Postmortems explain what has already broken and how the system defends against it. Don't break a defense you don't understand.

**Find the test coverage gaps:**
- Which modules have no tests? These are the highest-risk areas to modify.
- Which tests are flaky (retry logic, `skip`, `todo`)? Unreliable tests produce unreliable confidence.

**Validate your mental model:**
- Before making a change, explain to a colleague (or write down) what the change does and why it won't break anything. If you can't explain it, you don't understand it yet.
- After making a change, check: did any behavior you didn't intend to change actually change? Diff the test output.

## Anti-patterns when onboarding

- **Deep-diving before breadth-surveying**: the codebase is large; get the shape before the details.
- **Modifying without understanding invariants**: breaking a behavior that was intentional because you didn't know why it existed.
- **Trusting test coverage numbers**: 80% coverage means 80% of lines are executed, not that 80% of behaviors are tested.
- **Ignoring comments with bug IDs**: comments that say `// workaround for PROJ-123` are load-bearing. Look up the issue before removing them.
