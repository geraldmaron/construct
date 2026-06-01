---
name: exploration-tracer-bullet-method
description: Use when beginning implementation in a new system, new integration, or new architectural layer. A tracer bullet is not a prototype; it is the thinnest possible complete path through the real system.
---
# Tracer Bullet Method

Use when beginning implementation in a new system, new integration, or new architectural layer. A tracer bullet is not a prototype; it is the thinnest possible complete path through the real system.

## What a tracer bullet is

A tracer bullet hits every layer of the architecture, UI, API, business logic, data store, external service, with real code and real infrastructure. It is not a mock; it is a thin vertical slice.

**The goal:** prove that the end-to-end path works before committing to the full implementation.

**What it is not:**
- A prototype (a prototype tests a concept; a tracer bullet tests the infrastructure).
- A spike (a spike is time-boxed exploration; a tracer bullet produces code you keep).
- A stub (stubs replace real behavior; the tracer bullet uses real behavior).

## When to use it

Use a tracer bullet when:
- You're integrating two systems for the first time and don't know where the friction is.
- You're adding a new capability to a system with unfamiliar internals.
- The architecture requires multiple components to cooperate, and you need to verify the cooperation works before building each component out.
- You're prototyping a new data model that touches multiple layers.

## How to fire one

**Step 1: Define the thinnest path**

What is the simplest possible user action (or API call) that touches every layer you need to implement? This is your target path.

Example: for a new feature "user uploads an image":
- Thinnest path: user sends a single 1KB image, it is stored, and the storage URL is returned.

**Step 2: Identify every seam**

Map the layers the path crosses:
- Presentation: what receives the request?
- Transport: what format does the request take?
- Validation: what checks the input?
- Business logic: what transforms or routes it?
- Persistence: what stores it?
- External services: what calls are made?

**Step 3: Implement one thin vertical slice**

Write just enough code to make the tracer path work end-to-end. No error handling, no edge cases, no optimization. The only question is: does the path close?

**Step 4: Verify closure**

Run it. Check each layer produced the expected artifact. A tracer bullet that doesn't reach the end is valuable, it tells you exactly where the friction is before you've invested in the full implementation.

**Step 5: Expand**

Once the path closes, add error handling, validation, edge cases, and tests. You are now implementing on a system you know works.

## Tracer bullet vs. walking skeleton

A walking skeleton (Cockburn) is similar but broader: the minimum architecture that demonstrates a complete feature. A tracer bullet is more specific, it is a single request path through an existing or new system. The terms are used interchangeably in practice; the distinction matters less than the principle.

## Anti-patterns

- **Mocking too much**: if the tracer bullet uses mocked services, you haven't proved the real path works. Mocks are fine for unit tests, not for the tracer.
- **Doing too much at once**: if the tracer path covers 5 new capabilities, you won't know which one caused the failure. Fire one bullet at a time.
- **Skipping the tracer for "simple" changes**: the changes most likely to surprise you are the ones that seem simple. Fire anyway.
- **Throwing the bullet away**: a tracer bullet is production-quality code on a thin path. It is not throwaway. The skeleton expands from it.
