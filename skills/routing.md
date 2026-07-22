<!--
skills/routing.md — generated render of skills/routing.json. Do not hand-edit: run
`node scripts/generate-skill-routing.mjs --write` (or `npm run skills:routes -- --write`).
-->

# Skill routing

One row per skill reachable via `suggest_skills`/`search_skills`. A skill with authored
`triggers:` frontmatter is marked **authored**; everything else gets a lower-priority
**derived** entry from its own name/description so it stays reachable regardless.

## ai

| Skill | Keywords | Source |
|---|---|---|
| `ai/agent-dev` | agent dev, building, agents, tool-use, systems, multi-agent | derived |
| `ai/llm-security` | llm security, securing, llm-powered, applications, against, prompt | derived |
| `ai/ml-ops` | ml ops, patterns, anti-patterns, reference, guidance, operations | derived |
| `ai/orchestration-workflow` | orchestration, handoff contract, workflow state | authored |
| `ai/prompt-and-eval` | prompt and eval, designing, prompts, evaluating, model, performance | derived |
| `ai/prompt-optimizer` | prompt optimizer, closed-loop, prompt, optimization, guide, task | derived |
| `ai/rag-system` | rag, retrieval, vector database, embedding | authored |
| `ai/trace-triage` | trace triage, agent, telemetry, traces, need, triage | derived |

## architecture

| Skill | Keywords | Source |
|---|---|---|
| `architecture/api-design` | api design, designing, rest, graphql, grpc, apis | derived |
| `architecture/caching` | caching, designing, strategies, applications, apis, infrastructure | derived |
| `architecture/cloud-native` | cloud native, designing, containerized, orchestrated, microservice-based, systems | derived |
| `architecture/message-queue` | message queue, designing, asynchronous, communication, event-driven, systems | derived |
| `architecture/security-arch` | security arch, designing, authentication, authorization, network, security | derived |

## brand

| Skill | Keywords | Source |
|---|---|---|
| `brand/output-vibe` | prd, write a prd, product requirements doc, export, deck, pdf, presentation, artifact vibe | authored |

## compliance

| Skill | Keywords | Source |
|---|---|---|
| `compliance/ai-disclosure` | ai disclosure, reviewing, features, disclosure, requirements, transparency | derived |
| `compliance/case-law-research` | case law research, verifying, case, reporter, citations, holdings | derived |
| `compliance/data-privacy` | data privacy, reviewing, data, collection, storage, processing | derived |
| `compliance/license-audit` | license audit, auditing, dependency, licenses, evaluating, compliance | derived |
| `compliance/regulatory-review` | regulatory review, conducting, compliance, review, shipping, features | derived |

## development

| Skill | Keywords | Source |
|---|---|---|
| `development/cpp` | cpp, writing, reviewing, debugging, code | derived |
| `development/go` | go, writing, reviewing, debugging, code | derived |
| `development/java` | java, writing, reviewing, debugging, kotlin, code | derived |
| `development/kotlin` | kotlin, patterns, anti-patterns, reference, guidance, android | derived |
| `development/mobile-crossplatform` | mobile crossplatform, choosing, framework, answer, task, matches | derived |
| `development/python` | python, writing, reviewing, debugging, code | derived |
| `development/rust` | rust, writing, reviewing, debugging, code | derived |
| `development/shell` | shell, writing, reviewing, debugging, bash, posix | derived |
| `development/swift` | swift, enforces, data-race, safety, compile, time | derived |
| `development/typescript` | typescript, writing, reviewing, debugging, javascript, code | derived |

## devops

| Skill | Keywords | Source |
|---|---|---|
| `devops/ci-cd` | ci cd, designing, debugging, optimizing, pipelines | derived |
| `devops/containerization` | containerization, writing, dockerfiles, optimizing, image, size | derived |
| `devops/cost-optimization` | cost optimization, reducing, cloud, spend, right-sizing, resources | derived |
| `devops/data-engineering` | data engineering, idempotency, pipelines, multiple, times, without | derived |
| `devops/database` | database, designing, schemas, writing, migrations, optimizing | derived |
| `devops/dependency-management` | dependency management, managing, package, upgrades, resolving, cves | derived |
| `devops/devsecops` | devsecops, integrating, security, pipelines, managing, supply | derived |
| `devops/git-workflow` | git workflow, establishing, branching, strategies, commit, conventions | derived |
| `devops/incident-response` | incident response, define, severity, runbook, assign, early | derived |
| `devops/monorepo` | monorepo, selecting, tooling, structuring, packages, optimizing | derived |
| `devops/observability` | observability, designing, logging, tracing, metrics, alerting | derived |
| `devops/performance` | performance, profiling, load, testing, optimizing, application | derived |
| `devops/testing` | testing, planning, test, coverage, selecting, types | derived |

## docs

| Skill | Keywords | Source |
|---|---|---|
| `docs/adr-workflow` | adr, architecture decision | authored |
| `docs/artifact-authorship` | artifact, prd, requirements, draft, author, anti-fabrication | authored |
| `docs/backlog-proposal-workflow` | backlog proposal workflow, product, evidence, create, update, jira | derived |
| `docs/codebase-research-workflow` | codebase research workflow, researcher, maps, repo, entry, points, cx-researcher | derived |
| `docs/customer-profile-workflow` | customer profile workflow, customer, evidence, update, durable, product | derived |
| `docs/document-ingest-workflow` | document ingest workflow, user, points, word, spreadsheet, slide | derived |
| `docs/evidence-ingest-workflow` | evidence ingest workflow, user, pastes, customer, notes, slack | derived |
| `docs/init-docs` | init docs, init, docs, create, structure, documentation | derived |
| `docs/init-project` | init project, starting, work, project, joining, existing | derived |
| `docs/memo-and-decision-capture` | memo and decision capture, decision, status, update, announcement, needs | derived |
| `docs/prd-workflow` | prd, product requirements, write a prd | authored |
| `docs/prfaq-workflow` | prfaq workflow, user, asks, prfaq, working-backwards, launch | derived |
| `docs/product-intelligence-review` | product intelligence review, reviewing, prds, meta, prfaqs, evidence | derived |
| `docs/product-intelligence-workflow` | product intelligence workflow, request, involves, customer, evidence, synthesis | derived |
| `docs/product-signal-workflow` | product signal workflow, user, asks, customers, asking, themes | derived |
| `docs/research-workflow` | research brief, user research | authored |
| `docs/runbook-workflow` | runbook workflow, creating, operational, procedures, services, alerts | derived |
| `docs/strategy-workflow` | strategy, bets, non-bets | authored |
| `docs/transcript-synthesis` | transcript synthesis, meeting, call, interview, transcript, needs | derived |
| `docs/user-research-workflow` | user research workflow, researcher, worker, profile, synthesizes, user | derived |

## exploration

| Skill | Keywords | Source |
|---|---|---|
| `exploration/dependency-graph-reading` | dependency graph reading, assessing, risk, surface, project, dependencies | derived |
| `exploration/repo-map` | explore repo, map codebase, codebase map, unfamiliar codebase, how is this structured | authored |
| `exploration/tracer-bullet-method` | tracer bullet method, beginning, implementation, system, integration, architectural | derived |
| `exploration/unknown-codebase-onboarding` | unknown codebase onboarding, entering, unfamiliar, codebase, first, time | derived |

## frameworks

| Skill | Keywords | Source |
|---|---|---|
| `frameworks/django` | django, patterns, anti-patterns, reference, guidance, task | derived |
| `frameworks/nextjs` | nextjs, patterns, anti-patterns, reference, guidance, next | derived |
| `frameworks/react` | react, default, components, server, they, state | derived |
| `frameworks/spring-boot` | spring boot, patterns, anti-patterns, reference, guidance, spring | derived |

## frontend-design

| Skill | Keywords | Source |
|---|---|---|
| `frontend-design/accessibility` | accessibility, target, wcag, minimum, public-facing, product | derived |
| `frontend-design/component-patterns` | component patterns, designing, component, architecture, building, design | derived |
| `frontend-design/engineering` | engineering, working, build, tooling, bundling, rendering | derived |
| `frontend-design/screen-reader-testing` | screen reader testing, needs, tested, screen, reader, keyboard | derived |
| `frontend-design/state-management` | state management, choosing, state, management, tools, structuring | derived |
| `frontend-design/ui-aesthetics` | ui aesthetics, making, visual, design, decisions, color | derived |
| `frontend-design/ux-principles` | ux principles, designing, user, flows, evaluating, usability | derived |

## operating

| Skill | Keywords | Source |
|---|---|---|
| `operating/change-management` | change management, change, needs, categorized, reversibility, designing | derived |
| `operating/fleet-health-routing` | fleet health routing, fleet-level, routing, bounded-auto, policy, orchestrator, cx-orchestrator | derived |
| `operating/incident-response` | incident response, issue, active, production, building, incident | derived |
| `operating/oncall-rotation` | oncall rotation, setting, on-call, reviewing, health, handling | derived |
| `operating/orchestration-reference` | orchestration reference, detailed, orchestration, reference, loaded, demand | derived |
| `operating/raw-data-structuring` | raw data structuring, dataset, json, export, dump, needs | derived |
| `operating/unstructured-triage` | unstructured triage, brain-dump, rough, notes, free-form, input | derived |

## quality-gates

| Skill | Keywords | Source |
|---|---|---|
| `quality-gates/premortem` | premortem, plan, design, needs, imagining, already | derived |
| `quality-gates/review-work` | review work, methodology, change, needs, rigorous, pre-merge | derived |
| `quality-gates/verify-change` | change impact, regression, what broke | authored |
| `quality-gates/verify-module` | verify module, check, module, package, structurally, complete | derived |
| `quality-gates/verify-quality` | code quality, complexity, code smell | authored |
| `quality-gates/verify-security` | security scan, vulnerability, secrets, auth audit | authored |

## security

| Skill | Keywords | Source |
|---|---|---|
| `security/blue-team` | blue team, defending, systems, responding, incidents, building | derived |
| `security/code-audit` | code audit, reviewing, source, code, security, vulnerabilities | derived |
| `security/pentest` | pentest, owasp, sql injection, xss | authored |
| `security/red-team` | red team, planning, executing, offensive, security, assessments | derived |
| `security/threat-intel` | threat intel, performing, osint, threat, modeling, building | derived |
| `security/vuln-research` | vuln research, analyzing, binaries, fuzzing, software, developing | derived |

## strategy

| Skill | Keywords | Source |
|---|---|---|
| `strategy/competitive-intel` | competitive intel, populating, competitive, landscape, tables, primary | derived |
| `strategy/competitive-landscape` | competitive landscape, team, needs, structured, read, market | derived |
| `strategy/experimentation` | experiment, a/b test, ab test, split test, feature flag rollout, canary, holdout, sample size, statistical power, minimum detectable effect | authored |
| `strategy/financial-model` | financial model, competitive, financial, sections, make, revenue | derived |
| `strategy/jobs-to-be-done` | jobs to be done, user, research, needs, uncover, hiring | derived |
| `strategy/market-research-methods` | market research methods, team, needs, validate, assumptions, committing | derived |
| `strategy/narrative-arc` | narrative arc, argument, must, move, people, just | derived |
| `strategy/pricing-positioning` | pricing positioning, team, needs, price, adjust, positioning | derived |
| `strategy/prioritization-methods` | prioritize, prioritization, backlog ranking, roadmap prioritization, rice score, wsjf, cost of delay, value versus effort, which to build first, what to build next | authored |

## utility

| Skill | Keywords | Source |
|---|---|---|
| `utility/clean-code` | clean code, patterns, heuristics, identifying, removing, ai-generated | derived |

