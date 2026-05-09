<!--
skills/routing.md — Construct AI Agent — Skill Routing — Read the matching skill file before responding when the user's request matches t

Read the matching skill file before responding when the user's request matches trigger keywords below. ## Exploration Domain
-->
# Construct AI Agent — Skill Routing

Read the matching skill file before responding when the user's request matches trigger keywords below.

## Exploration Domain

| Trigger Keywords | Skill File | Description |
|---|---|---|
| explore repo, map codebase, understand codebase, unfamiliar codebase, slog through, get oriented, codebase map, how is this structured, how does this work, where is X, entry point, hot path, code map | `skills/exploration/repo-map.md` | Systematic repo exploration — produce .cx/codebase-map.md |

## Quality Gates

| Trigger Keywords | Skill File | Description |
|---|---|---|
| security scan, vulnerability, secrets, auth audit | `skills/quality-gates/verify-security.md` | Security vulnerability scan |
| code quality, complexity, code smell, naming | `skills/quality-gates/verify-quality.md` | Code quality analysis |
| change impact, what broke, doc sync, regression | `skills/quality-gates/verify-change.md` | Change impact analysis |
| module structure, exports, completeness | `skills/quality-gates/verify-module.md` | Module structure check |
| parallel review, adversarial review, 5-reviewer, pre-merge review | `skills/quality-gates/review-work.md` | 5-role parallel adversarial review methodology |

## Utility Domain

| Trigger Keywords | Skill File | Description |
|---|---|---|
| ai slop, verbose code, over-commented, clean code, hedging names, dead comments, unnecessary wrapper | `skills/utility/clean-code.md` | AI slop removal patterns and heuristics |

## Security Domain

| Trigger Keywords | Skill File | Description |
|---|---|---|
| pentest, red team, exploit, C2, lateral movement, privilege escalation, evasion, persistence | `skills/security/red-team.md` | Red team attack techniques |
| blue team, alert, IOC, incident response, forensics, SIEM, EDR, containment | `skills/security/blue-team.md` | Blue team defense and incident response |
| web pentest, API security, OWASP, SQLi, XSS, SSRF, RCE, injection | `skills/security/pentest.md` | Web and API penetration testing |
| code audit, dangerous function, taint analysis, sink, source | `skills/security/code-audit.md` | Source code security audit |
| binary, reversing, PWN, fuzzing, stack overflow, heap overflow, ROP | `skills/security/vuln-research.md` | Vulnerability research and exploitation |
| OSINT, threat intelligence, threat modeling, ATT&CK, threat hunting | `skills/security/threat-intel.md` | Threat intelligence and OSINT |

## Architecture Domain

| Trigger Keywords | Skill File | Description |
|---|---|---|
| API design, REST, GraphQL, gRPC, endpoint, versioning | `skills/architecture/api-design.md` | API design patterns |
| caching, Redis, Memcached, cache invalidation, CDN | `skills/architecture/caching.md` | Caching strategies |
| cloud native, Kubernetes, Docker, microservice, service mesh | `skills/architecture/cloud-native.md` | Cloud-native architecture |
| message queue, Kafka, RabbitMQ, event driven, pub/sub | `skills/architecture/message-queue.md` | Message queue and event-driven patterns |
| security architecture, zero trust, defense in depth, IAM | `skills/architecture/security-arch.md` | Security architecture |

## AI / MLOps Domain

| Trigger Keywords | Skill File | Description |
|---|---|---|
| RAG, retrieval augmented, vector database, embedding, chunking | `skills/ai/rag-system.md` | RAG system design |
| AI agent, tool use, function calling, agent framework, orchestration | `skills/ai/agent-dev.md` | AI agent development |
| workflow state, orchestration state, task key, handoff contract, phase gate, project alignment | `skills/ai/orchestration-workflow.md` | Construct-style workflow state and phase alignment |
| LLM security, prompt injection, jailbreak, guardrail | `skills/ai/llm-security.md` | LLM security and guardrails |
| prompt engineering, model evaluation, benchmark, fine-tuning | `skills/ai/prompt-and-eval.md` | Prompt engineering and evaluation |
| prompt optimization, improve prompt, optimize agent, quality score, staging prompt, promotion | `skills/ai/prompt-optimizer.md` | Closed-loop prompt auto-optimization via Langfuse traces |
| MLOps, ML pipeline, model registry, model deployment, feature store, drift detection, model monitoring, training pipeline | `skills/ai/ml-ops.md` | ML operations and model lifecycle |

## DevOps Domain

| Trigger Keywords | Skill File | Description |
|---|---|---|
| Git workflow, branching strategy, trunk-based, GitFlow | `skills/devops/git-workflow.md` | Git workflow patterns |
| testing strategy, unit test, integration test, e2e, test pyramid | `skills/devops/testing.md` | Testing strategy |
| database, migration, schema design, indexing, query optimization | `skills/devops/database.md` | Database patterns |
| performance, profiling, load test, latency, throughput | `skills/devops/performance.md` | Performance engineering |
| observability, logging, tracing, metrics, Prometheus, Grafana | `skills/devops/observability.md` | Observability and monitoring |
| DevSecOps, CI security, SAST, DAST, supply chain | `skills/devops/devsecops.md` | DevSecOps practices |
| cost optimization, cloud cost, FinOps, resource right-sizing | `skills/devops/cost-optimization.md` | Cloud cost optimization |
| CI/CD, pipeline, GitHub Actions, GitLab CI, workflow, continuous integration, continuous deployment, build pipeline | `skills/devops/ci-cd.md` | CI/CD pipeline design and optimization |
| monorepo, pnpm workspaces, Turborepo, Nx, Bazel, workspace, multi-package, affected builds | `skills/devops/monorepo.md` | Monorepo tooling and management |
| dependency upgrade, package update, lock file, Dependabot, Renovate, transitive CVE, npm audit, vulnerability, outdated packages | `skills/devops/dependency-management.md` | Dependency management and upgrade safety |
| Docker, container, Dockerfile, multi-stage, image scanning, Trivy, Snyk, OCI, containerize | `skills/devops/containerization.md` | Docker and OCI container best practices |
| incident response, on-call, runbook, post-mortem, blameless, PagerDuty, SLA, outage, escalation | `skills/devops/incident-response.md` | Incident response and post-mortem process |
| data pipeline, ELT, ETL, dbt, Airflow, Kafka, Spark, Flink, data warehouse, feature store, data contract | `skills/devops/data-engineering.md` | Data pipeline and warehouse engineering |

## Development Domain

| Trigger Keywords | Skill File | Description |
|---|---|---|
| Python, Django, Flask, FastAPI, pip, poetry | `skills/development/python.md` | Python best practices |
| Go, Golang, goroutine, channel | `skills/development/go.md` | Go best practices |
| Rust, cargo, borrow checker, lifetime | `skills/development/rust.md` | Rust best practices |
| TypeScript, JavaScript, Node, Deno, Bun | `skills/development/typescript.md` | TypeScript best practices |
| Java, Kotlin, Spring, JVM, Maven, Gradle | `skills/development/java.md` | Java best practices |
| C, C++, CMake, pointer, memory management | `skills/development/cpp.md` | C/C++ best practices |
| Shell, Bash, Zsh, scripting, CLI | `skills/development/shell.md` | Shell scripting best practices |
| Swift, iOS, SwiftUI, Xcode, UIKit, Combine | `skills/development/swift.md` | Swift / iOS development |
| Kotlin Android, Jetpack Compose, coroutines, Android, Hilt | `skills/development/kotlin.md` | Kotlin / Android development |
| Flutter, React Native, cross-platform mobile, Dart, Expo | `skills/development/mobile-crossplatform.md` | Cross-platform mobile frameworks |

## Frontend Design Domain

| Trigger Keywords | Skill File | Description |
|---|---|---|
| UI aesthetics, visual design, color theory, layout | `skills/frontend-design/ui-aesthetics.md` | UI visual design |
| UX principles, usability, user flow, information architecture | `skills/frontend-design/ux-principles.md` | UX design principles |
| component patterns, design system, atomic design | `skills/frontend-design/component-patterns.md` | Component architecture |
| state management, Redux, Zustand, Pinia, context | `skills/frontend-design/state-management.md` | Frontend state management |
| frontend engineering, build tool, bundler, SSR, SSG | `skills/frontend-design/engineering.md` | Frontend engineering |
| accessibility, WCAG, ARIA, screen reader, keyboard navigation, a11y, color contrast, inclusive design | `skills/frontend-design/accessibility.md` | WCAG 2.2 accessibility and inclusive design |

## Frameworks Domain

| Trigger Keywords | Skill File | Description |
|---|---|---|
| React, JSX, hooks, useState, useEffect, RSC, Server Components | `skills/frameworks/react.md` | React patterns and best practices |
| Next.js, App Router, Server Actions, ISR, route handler, Vercel | `skills/frameworks/nextjs.md` | Next.js App Router |
| Django, DRF, Django REST, Django ORM, Django views | `skills/frameworks/django.md` | Django and Django REST Framework |
| Spring Boot, Spring Security, JPA, @RestController, @Service | `skills/frameworks/spring-boot.md` | Spring Boot layered architecture |

## Documentation Domain

| Trigger Keywords | Skill File | Description |
|---|---|---|
| init docs, create docs structure, set up documentation, docs scaffold, documentation init | `skills/docs/init-docs.md` | Initialize required project-state docs and documentation structure |
| research X, investigate X, find evidence, gather evidence | `skills/docs/research-workflow.md` | Research workflow — question to .cx/research/ file |
| product intelligence, customer notes, field notes, product signals, customer profile, evidence brief, signal brief, backlog proposal | `skills/docs/product-intelligence-workflow.md` | Product Intelligence workflow — evidence to product artifacts |
| ingest evidence, ingest customer notes, ingest Slack thread, ingest support ticket, normalize field notes | `skills/docs/evidence-ingest-workflow.md` | Evidence ingest workflow — raw source to .cx/product-intel/ |
| write a PRD, create requirements, spec out, requirements document, Meta PRD, platform PRD | `skills/docs/prd-workflow.md` | PRD workflow — requirements to docs/prd/ or docs/meta-prd/ |
| write a PRFAQ, working backwards doc, press release FAQ | `skills/docs/prfaq-workflow.md` | PRFAQ workflow — launch narrative from PRD or evidence |
| create Jira proposal, update Linear, backlog proposal, issue proposal | `skills/docs/backlog-proposal-workflow.md` | Backlog proposal workflow — approval-gated issue tracker changes |
| record this decision, create an ADR, architecture decision | `skills/docs/adr-workflow.md` | ADR workflow — decision to docs/adr/ file |
| write a runbook, document this operation, operational procedure | `skills/docs/runbook-workflow.md` | Runbook workflow — operation to docs/runbooks/ file |
| init project, new project setup, join project, set up doc structure | `skills/docs/init-project.md` | Project initialization via construct init-docs |

## Routing Rules

1. Match on intent, not exact string. "How do I prevent SQL injection" triggers `pentest.md`.
2. When a request spans two domains, read both skill files.
3. Detect programming language from file extensions or context and read the corresponding development skill.
4. Read each skill file once per conversation.
5. Skill file content is authoritative over training data when they conflict.
