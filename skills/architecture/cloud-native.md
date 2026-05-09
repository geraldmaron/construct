<!--
skills/architecture/cloud-native.md — Cloud-Native Architecture — Use this skill when designing containerized, orchestrated, or microservice-based

Use this skill when designing containerized, orchestrated, or microservice-based systems. ## Container Best Practices
-->
# Cloud-Native Architecture

Use this skill when designing containerized, orchestrated, or microservice-based systems.

## Container Best Practices

- One process per container
- Use multi-stage builds to minimize image size
- Pin base image versions with digest, not just tag
- Run as non-root user
- No secrets in image layers; use runtime injection
- Health check endpoint in every container
- Graceful shutdown: handle SIGTERM, drain connections, exit cleanly

## Kubernetes Patterns

### Resource Management
- Set CPU and memory requests and limits on every pod
- Use Horizontal Pod Autoscaler based on CPU, memory, or custom metrics
- Use PodDisruptionBudget to maintain availability during rollouts
- Namespace per environment or team

### Networking
- Use Services for internal communication
- Use Ingress or Gateway API for external traffic
- NetworkPolicy to restrict pod-to-pod communication
- DNS-based service discovery within the cluster

### Configuration
- ConfigMaps for non-sensitive configuration
- Secrets for sensitive values (encrypted at rest with KMS)
- Environment variables or volume mounts, not baked into images
- External config: Vault, AWS Secrets Manager, or equivalent

### Deployment Strategies
- Rolling update: default, zero-downtime with readiness probes
- Blue-green: instant switchover, requires double capacity
- Canary: gradual traffic shift, best for risk-sensitive changes
- Use readiness and liveness probes; do not conflate them

## Microservice Design

### Boundaries
- One service per bounded context
- Services own their data; no shared databases
- Communicate via APIs or events, never direct database access
- Keep services independently deployable

### Communication
- Synchronous: REST or gRPC for request-response
- Asynchronous: message queues for events and commands
- Use circuit breakers for synchronous calls (Hystrix pattern)
- Set timeouts and retries with exponential backoff and jitter
- Implement idempotency keys for retry-safe operations

### Data Management
- Database per service
- Saga pattern for distributed transactions
- Event sourcing when audit trail matters
- CQRS when read and write patterns diverge significantly
- Eventual consistency is acceptable for most cross-service data

## Service Mesh

- Sidecar proxy (Envoy, Linkerd) for mTLS, observability, traffic control
- Retry, timeout, and circuit breaker policies in mesh config
- Traffic splitting for canary deployments
- Distributed tracing via mesh-injected headers
- Evaluate mesh overhead; not every system needs one

## Twelve-Factor Compliance

1. Codebase: one repo per service
2. Dependencies: explicitly declared and isolated
3. Config: stored in environment, not code
4. Backing services: attached resources via config
5. Build/release/run: strict separation
6. Processes: stateless; persist state in backing services
7. Port binding: self-contained, export via port
8. Concurrency: scale via process model
9. Disposability: fast startup, graceful shutdown
10. Dev/prod parity: keep environments as similar as possible
11. Logs: emit to stdout, aggregate externally
12. Admin processes: run as one-off tasks

## Resilience Patterns

- Retry with exponential backoff and jitter
- Circuit breaker: open after N failures, half-open after cooldown
- Bulkhead: isolate failures to prevent cascade
- Timeout: every external call has a deadline
- Fallback: degrade gracefully when dependencies are unavailable
