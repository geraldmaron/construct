<!--
skills/devops/observability.md — Observability — Use this skill when designing logging, tracing, metrics, or alerting systems.

Use this skill when designing logging, tracing, metrics, or alerting systems. ## Three Pillars
-->
# Observability

Use this skill when designing logging, tracing, metrics, or alerting systems.

## Three Pillars

### Logs
- Structured format (JSON) with consistent field names
- Required fields: timestamp, level, service, request_id, message
- Levels: DEBUG (development only), INFO (normal operations), WARN (unexpected but handled), ERROR (failures requiring attention)
- Never log secrets, passwords, tokens, or full PII
- Correlate logs with trace IDs for request-level debugging
- Centralize logs: ELK, Loki, CloudWatch, Datadog

### Metrics
- USE method for resources: Utilization, Saturation, Errors
- RED method for services: Rate, Errors, Duration
- Four golden signals: latency, traffic, errors, saturation
- Use histograms for latency (not averages)
- Label dimensions: service, endpoint, status_code, environment
- Keep cardinality manageable; avoid high-cardinality labels

### Traces
- Distributed tracing across service boundaries
- Propagate trace context via headers (W3C Trace Context or B3)
- Instrument: HTTP clients/servers, database queries, message queue operations
- Sample in production: 1-10% for high-traffic services, 100% for low-traffic
- Record: span name, duration, status, attributes, parent span

## Instrumentation

### What to Instrument
- Every inbound request (HTTP, gRPC, message consumer)
- Every outbound call (database, cache, external API, queue publish)
- Business events: signup, purchase, error recovery
- Background jobs: start, complete, fail

### How to Instrument
- Use OpenTelemetry for vendor-neutral instrumentation
- Auto-instrumentation for frameworks and libraries when available
- Custom spans for business-critical code paths
- Baggage for cross-service context (tenant ID, feature flags)

## Alerting

### Alert Design
- Alert on symptoms (error rate, latency), not causes (CPU, memory)
- Use burn rate alerts for SLO-based monitoring
- Page for user-impacting issues; ticket for non-urgent
- Every alert must have a runbook link
- Test alerts regularly; unused alerts should be deleted

### Severity Levels

| Level | Response Time | Example |
|---|---|---|
| Critical (page) | <15 min | Service down, data loss risk |
| High (page) | <1 hour | Error rate >5%, SLO breach |
| Medium (ticket) | <24 hours | Elevated latency, disk >80% |
| Low (ticket) | <1 week | Dependency deprecation, minor anomaly |

### Anti-Patterns
- Alerting on every metric threshold (alert fatigue)
- Alerts without runbooks (responder does not know what to do)
- Alerts that always fire (desensitization)
- No owner assigned to an alert

## SLOs

- Define SLIs: the metric that represents user experience (availability, latency, correctness)
- Set SLO target: e.g., 99.9% of requests complete in <300ms
- Calculate error budget: 100% - SLO = acceptable failures per period
- Alert when error budget burn rate exceeds threshold
- Review SLOs quarterly; adjust based on business needs and reliability data

## Dashboards

### Principles
- One overview dashboard per service
- Top section: SLO status, error budget remaining
- Middle section: traffic, latency (p50, p95, p99), error rate
- Bottom section: resource utilization, dependency health
- Drill-down dashboards for specific subsystems
- Avoid vanity metrics; every panel should inform a decision

### Tools
- Grafana for open-source metric visualization
- Datadog, New Relic, or Honeycomb for managed observability
- PagerDuty or Opsgenie for alert routing and escalation

## Incident Investigation Flow

1. Check SLO dashboard for affected services
2. Inspect error rate and latency spikes for timing
3. Filter traces by error status in the time window
4. Read logs correlated with failing trace IDs
5. Identify the root service and operation
6. Check recent deployments and configuration changes
