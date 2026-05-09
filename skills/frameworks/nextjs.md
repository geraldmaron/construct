<!--
skills/frameworks/nextjs.md — Next.js (App Router) — ```

## App Router Mental Model ```
-->
# Next.js (App Router)

## App Router Mental Model

```
app/
├── layout.tsx          ← Root layout — wraps every page
├── page.tsx            ← / route
├── (auth)/             ← Route group (no URL segment)
│   ├── login/page.tsx  ← /login
│   └── register/page.tsx
├── dashboard/
│   ├── layout.tsx      ← Nested layout for /dashboard/*
│   └── page.tsx        ← /dashboard
└── api/
    └── items/route.ts  ← /api/items (Route Handler)
```

Key rules:
- `page.tsx` = publicly accessible route segment
- `layout.tsx` = persistent shell across sibling pages
- `loading.tsx` = automatic Suspense boundary while segment loads
- `error.tsx` = error boundary for the segment
- `not-found.tsx` = 404 for the segment

## Data Fetching

### Server Components fetch directly

```tsx
// app/items/page.tsx
async function ItemsPage() {
  const items = await fetch('https://api.example.com/items', {
    next: { revalidate: 60 }   // ISR: revalidate every 60s
  }).then(r => r.json());
  return <ItemList items={items} />;
}
```

Caching behaviors:

| Option | Behavior |
|---|---|
| `cache: 'force-cache'` | Static — cache forever (default) |
| `next: { revalidate: N }` | ISR — revalidate after N seconds |
| `cache: 'no-store'` | Dynamic — always fresh |
| `next: { tags: ['items'] }` | Tag for on-demand revalidation |

### On-demand revalidation

```ts
// Server Action or API Route
import { revalidateTag } from 'next/cache';
revalidateTag('items');   // invalidates all fetches tagged 'items'
```

### Route Handlers (API Routes replacement)

```ts
// app/api/items/route.ts
import { NextRequest, NextResponse } from 'next/server';

export async function GET(req: NextRequest) {
  const items = await db.items.findMany();
  return NextResponse.json(items);
}
```

## Server Actions

Mutate data from Client Components without a separate API route:

```tsx
// app/actions.ts
'use server';
export async function createItem(formData: FormData) {
  const title = formData.get('title') as string;
  await db.items.create({ data: { title } });
  revalidatePath('/items');
}

// Client Component
<form action={createItem}>
  <input name="title" />
  <button>Create</button>
</form>
```

Validate Server Action inputs — they are network endpoints.

## Rendering Strategies

| Strategy | When |
|---|---|
| Static (SSG) | Marketing pages, docs — no user-specific data |
| ISR | Listings, product pages — stale-ok, periodic refresh |
| Dynamic (SSR) | Dashboards, auth-gated pages — always fresh |
| Client | Highly interactive UIs, real-time, after-hydration only |

Prefer static/ISR by default; reach for dynamic only when the data must be per-request.

## Metadata & SEO

```tsx
// Static
export const metadata: Metadata = { title: 'Items', description: '...' };

// Dynamic
export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const item = await fetchItem(params.id);
  return { title: item.title };
}
```

## Middleware

```ts
// middleware.ts (runs at the edge before the request)
export function middleware(req: NextRequest) {
  if (!req.cookies.get('session')) {
    return NextResponse.redirect(new URL('/login', req.url));
  }
}
export const config = { matcher: ['/dashboard/:path*'] };
```

Middleware runs on the Edge Runtime — no Node.js APIs. Keep it fast; no DB calls.

## Performance

- Enable Partial Prerendering (PPR) in Next.js 15 for shell + streaming content
- Use `next/image` for all images — automatic WebP, lazy loading, CLS prevention
- Use `next/font` for self-hosted fonts — eliminates FOUT and external requests
- Bundle analysis: `ANALYZE=true next build`
- Streaming: wrap slow data-dependent sections in `<Suspense>`

## Common Pitfalls

- Importing client-only code (browser APIs, hooks) in Server Components — add `'use client'`
- Large `layout.tsx` re-renders — use `memo` on stable child subtrees
- Fetching the same data in multiple components — hoist to the nearest shared ancestor Server Component (fetch is deduplicated within a request)
- Dynamic routes missing `generateStaticParams` for static builds — causes runtime 404
- Server Actions called without input validation — treat as untrusted user input
