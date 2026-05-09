<!--
skills/frontend-design/state-management.md — Frontend State Management — Use this skill when choosing state management tools, structuring application sta

Use this skill when choosing state management tools, structuring application state, or debugging state issues. ## State Categories
-->
# Frontend State Management

Use this skill when choosing state management tools, structuring application state, or debugging state issues.

## State Categories

| Category | Examples | Recommended Approach |
|---|---|---|
| Server state | API data, cached queries | TanStack Query, SWR, tRPC |
| Client state | Theme, sidebar open, wizard step | Zustand, Jotai, signals, context |
| URL state | Filters, sort, page, active tab | Router / URL search params |
| Form state | Input values, validation, dirty | React Hook Form, Formik, native |
| Transient state | Hover, focus, animation progress | Component-local useState/ref |

- Do not duplicate server state into client stores
- Do not store derived values; compute them

## Server State

### Stale-While-Revalidate
- Return cached data immediately; refetch in the background
- Configurable stale time and cache time
- Background refetch on window focus, reconnect, and intervals
- Optimistic updates for responsive UI

### Query Keys
- Structured keys that include all variables: `['users', { page, filter }]`
- Invalidate related queries after mutations
- Prefetch data for likely next actions (hover, pagination)

### Error and Loading States
- Distinguish: idle, loading, error, success
- Show skeleton or placeholder during initial load
- Show stale data with background indicator during refetch
- Retry failed requests with exponential backoff

## Client State

### Zustand
- Small, focused stores per domain
- Actions colocated with state in the store
- Selectors for derived data and render optimization
- Middleware: persist, devtools, immer for immutable updates

### Jotai / Signals
- Atomic state: each piece of state is an independent atom
- Derived atoms compute from other atoms
- Fine-grained reactivity: only re-renders components that use changed atoms
- Good for: settings, preferences, feature flags

### Context
- Use for low-frequency updates: theme, locale, user identity
- Avoid for high-frequency updates (causes re-renders of entire subtree)
- Split contexts by concern; do not put everything in one provider
- Combine with `useMemo` to prevent unnecessary re-renders

## URL State

### What Belongs in the URL
- Filters, search query, sort order, pagination
- Active tab, selected item, modal open state
- Anything a user should be able to share or bookmark

### Implementation
- Read from URL search params; write updates to the URL
- Treat the URL as the source of truth
- Validate URL params; fall back to defaults for invalid values
- Use `URLSearchParams` API or a routing library's hooks

## Form State

### Controlled vs Uncontrolled
- Controlled: React state drives the input value; use for complex validation
- Uncontrolled: DOM owns the value; access via ref on submit; simpler, faster
- Form libraries (React Hook Form) offer uncontrolled performance with controlled DX

### Validation
- Client-side for immediate feedback; server-side for security
- Validate on blur for individual fields; on submit for the full form
- Zod or Yup for schema-based validation shared with backend
- Show errors inline, next to the field, in context

## State Synchronization

### Optimistic Updates
1. Snapshot current state
2. Apply the expected change immediately
3. Send the mutation to the server
4. On success: confirm or refetch
5. On failure: rollback to snapshot and show error

### Pessimistic Updates
1. Send the mutation
2. Show loading indicator
3. Update UI with server response
- Use when: the operation is complex, the server may reject, or correctness is critical

## Debugging State

- React DevTools for component state and context
- Zustand/Jotai devtools middleware
- TanStack Query DevTools for server state
- `console.trace` to find where state changes originate
- Time-travel debugging with Redux DevTools protocol

## Anti-Patterns

- Global store for everything (mixing server, client, form, and URL state)
- Duplicating server data into client stores (stale data, sync bugs)
- Storing derived data instead of computing it
- Context for high-frequency state (causes unnecessary re-renders)
- Prop drilling through many levels instead of lifting state or using context
- Mutating state directly instead of creating new references
