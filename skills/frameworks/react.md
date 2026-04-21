<!--
skills/frameworks/react.md — React — By default, components are **Server Components** — they run on the server, have

## Component Design ### Server vs Client Components (React 19 / Next.js App Router)
-->
# React

## Component Design

### Server vs Client Components (React 19 / Next.js App Router)

By default, components are **Server Components** — they run on the server, have no state, and can fetch data directly. Add `'use client'` only when you need interactivity, browser APIs, or hooks.

```tsx
// Server Component — no directive needed
async function ItemList() {
  const items = await db.items.findMany();   // direct DB access fine here
  return <ul>{items.map(i => <Item key={i.id} {...i} />)}</ul>;
}

// Client Component — needs browser or state
'use client';
export function SearchBar({ onSearch }: { onSearch: (q: string) => void }) {
  const [query, setQuery] = useState('');
  ...
}
```

Push the `'use client'` boundary as far down the tree as possible.

### Composition over configuration

Prefer children and render props over proliferating boolean props:

```tsx
// Avoid: <Modal showHeader closeButton title="..." />
// Prefer:
<Modal>
  <Modal.Header onClose={close}>Title</Modal.Header>
  <Modal.Body>...</Modal.Body>
</Modal>
```

## State Management

See decision matrix:

| Concern | Tool |
|---|---|
| Server state (fetching, caching) | TanStack Query / SWR |
| Global UI state | Zustand / Jotai |
| Form state | React Hook Form + Zod |
| URL state | `useSearchParams` / router |
| Component-local state | `useState` / `useReducer` |

Do not put server data in a client store — TanStack Query is the cache. Derive don't duplicate.

## Performance

### Memoization discipline

`useMemo` and `useCallback` add overhead if misapplied. Measure first:

```tsx
// Justified: expensive computation, stable deps
const sorted = useMemo(() => expensiveSort(items), [items]);

// Unjustified: not expensive, adds indirection for nothing
const label = useMemo(() => `Hello ${name}`, [name]);
```

### Concurrent features

- `useTransition` for non-urgent state updates (e.g., search filter)
- `useDeferredValue` to deprioritize expensive re-renders while keeping input responsive
- `<Suspense>` boundaries for async data; pair with streaming in App Router

### Code splitting

```tsx
const HeavyChart = lazy(() => import('./HeavyChart'));
<Suspense fallback={<Spinner />}><HeavyChart /></Suspense>
```

## Patterns

### Custom hooks extract logic, not JSX

```ts
// Good: encapsulates fetch + error + loading
export function useItems() {
  return useQuery({ queryKey: ['items'], queryFn: fetchItems });
}
```

### Controlled vs uncontrolled

- Controlled: React owns value via `state` — use for forms with validation, derived fields
- Uncontrolled: DOM owns value via `ref` — use for file inputs and simple browser-owned fields

## Testing

```tsx
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

test('submits search query', async () => {
  const onSearch = vi.fn();
  render(<SearchBar onSearch={onSearch} />);
  await userEvent.type(screen.getByRole('searchbox'), 'react');
  await userEvent.keyboard('{Enter}');
  expect(onSearch).toHaveBeenCalledWith('react');
});
```

- Use `@testing-library/react` — test behavior, not implementation
- `userEvent` over `fireEvent` — simulates real user interactions
- Mock at the network boundary (`msw`) not the component boundary

## Tooling

- **Vite** for non-Next apps; fast HMR, native ESM
- **Biome** for lint + format in a single fast tool (replaces ESLint + Prettier)
- **TypeScript strict mode** — enables `noUncheckedIndexedAccess`, `strictNullChecks`, etc.
- React DevTools Profiler for recomposition analysis

## Common Pitfalls

- Stale closures in `useEffect` — include all reactive values in the dependency array or use `useEffectEvent` (React 19)
- `useEffect` for data fetching — use TanStack Query instead
- Direct DOM mutation inside render — causes tearing with concurrent mode
- Key prop as array index — breaks reconciliation on reorder/insert
