<!--
skills/architecture/message-queue.md — Message Queues and Event-Driven Architecture — Use this skill when designing asynchronous communication, event-driven systems,

Use this skill when designing asynchronous communication, event-driven systems, or message-based integrations. ## When to Use Message Queues
-->
# Message Queues and Event-Driven Architecture

Use this skill when designing asynchronous communication, event-driven systems, or message-based integrations.

## When to Use Message Queues

- Decouple producers from consumers
- Buffer spikes in traffic or processing load
- Enable async processing of long-running tasks
- Fan out events to multiple consumers
- Guarantee delivery when consumers may be temporarily unavailable

## Messaging Patterns

### Point-to-Point (Queue)
- One producer, one consumer per message
- Work distribution across multiple consumer instances
- Use for: task queues, job processing, command dispatch

### Publish-Subscribe (Topic)
- One producer, many consumers per message
- Each subscriber gets a copy
- Use for: event notification, real-time updates, audit logging

### Request-Reply
- Producer sends a message with a reply-to address
- Consumer processes and responds
- Use for: async RPC, distributed computation
- Include correlation ID for matching responses

## Technology Selection

| System | Strength | Best For |
|---|---|---|
| Kafka | High throughput, replay, ordering | Event streaming, log aggregation, CDC |
| RabbitMQ | Flexible routing, low latency | Task queues, RPC, complex routing |
| SQS | Managed, simple, scales to zero | AWS-native task queues |
| NATS | Ultra-low latency, lightweight | Microservice communication |
| Pulsar | Multi-tenancy, tiered storage | Large-scale streaming |

## Message Design

- Include: event type, timestamp, correlation ID, source, schema version, payload
- Use a schema registry for payload evolution (Avro, Protobuf, JSON Schema)
- Keep messages self-contained; avoid requiring lookups to interpret
- Small messages (<1MB); use references for large blobs
- Version schemas; consumers must handle unknown fields gracefully

## Delivery Guarantees

### At-Most-Once
- Fire and forget; fastest but may lose messages
- Use for: metrics, non-critical notifications

### At-Least-Once
- Retry until acknowledged; may duplicate
- Consumers must be idempotent
- Use for: most business events

### Exactly-Once
- Requires idempotent consumers or transactional outbox
- Expensive; only when business rules demand it
- Use for: financial transactions, inventory updates

## Ordering

- Kafka: ordered within a partition; use partition key for related events
- RabbitMQ: ordered within a single queue with one consumer
- SQS FIFO: ordered by message group ID
- Design consumers to tolerate out-of-order delivery when possible

## Error Handling

- Dead letter queue (DLQ) for messages that fail after max retries
- Exponential backoff between retries
- Poison message detection: log and skip after threshold
- Monitor DLQ depth; alert when non-empty
- Provide tooling to replay or reprocess DLQ messages

## Transactional Outbox Pattern

1. Write business data and outbox event in a single database transaction
2. Background process polls outbox and publishes to message broker
3. Mark outbox entry as published after broker acknowledgment
- Guarantees event publication if database write succeeds
- Alternative: change data capture (CDC) from the database log

## Monitoring

- Queue depth and age of oldest message
- Consumer lag (Kafka: offset lag per partition)
- Message throughput: produced, consumed, failed per minute
- DLQ depth and growth rate
- Consumer processing latency percentiles
- Alert on: growing lag, DLQ growth, consumer crash loops
