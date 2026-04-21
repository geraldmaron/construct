<!--
skills/frontend-design/engineering.md — Frontend Engineering — Use this skill when working on build tooling, bundling, rendering strategies, or

Use this skill when working on build tooling, bundling, rendering strategies, or frontend infrastructure. ## Build Tools
-->
# Frontend Engineering

Use this skill when working on build tooling, bundling, rendering strategies, or frontend infrastructure.

## Build Tools

| Tool | Strength |
|---|---|
| Vite | Fast dev server, ESM-native, good for most projects |
| Turbopack | Next.js integrated, incremental compilation |
| esbuild | Extremely fast bundling for libraries and tools |
| Webpack | Mature ecosystem, complex configuration |
| Rollup | Clean ESM output for libraries |
| Rspack | Webpack-compatible with Rust-based speed |

### Configuration Principles
- Start with framework defaults; customize only when needed
- Enable tree-shaking for unused code elimination
- Code-split by route and by heavy dependency
- Source maps in development; conditional in production (security vs debugging trade-off)
- Hashed filenames for cache busting

## Rendering Strategies

### Static Site Generation (SSG)
- Pre-render pages at build time
- Best for: marketing pages, blogs, documentation
- Fastest TTFB; cacheable at CDN edge
- Rebuild on content change or use incremental regeneration

### Server-Side Rendering (SSR)
- Render on each request
- Best for: dynamic content, personalized pages, SEO-critical content
- Higher TTFB than SSG; requires server infrastructure
- Hydration on the client for interactivity

### Client-Side Rendering (CSR)
- Render entirely in the browser
- Best for: authenticated apps, dashboards, tools behind login
- Fast after initial load; poor SEO without prerendering
- Show skeleton during initial data fetch

### Streaming SSR
- Send HTML progressively as components resolve
- Reduces TTFB by starting the response before all data is ready
- Suspense boundaries define streaming chunks
- Best for: pages with mixed fast and slow data sources

### Islands Architecture
- Static HTML with isolated interactive components (islands)
- Minimal JavaScript shipped; only interactive parts hydrate
- Best for: content-heavy sites with sparse interactivity
- Frameworks: Astro, Fresh

## Performance Budget

| Page Type | JS (gzipped) | CSS (gzipped) | LCP |
|---|---|---|---|
| Landing | <150KB | <30KB | <2.5s |
| App page | <300KB | <50KB | <3s |
| Microsite | <80KB | <15KB | <2s |

### Optimization Techniques
- Dynamic imports for below-the-fold and conditional features
- Preload critical resources: hero image, primary font
- Defer non-critical CSS and JavaScript
- Compress with Brotli (or gzip fallback)
- Image optimization: AVIF/WebP, explicit dimensions, lazy loading

## Module Federation

- Share dependencies across independently deployed micro-frontends
- Define clear ownership: one team per module
- Version shared dependencies carefully
- Fallback when a remote module is unavailable
- Use for: large organizations with multiple teams on one product

## Monorepo Patterns

- Nx, Turborepo, or PNPM workspaces for multi-package management
- Share configuration (ESLint, TypeScript, test setup) from root
- Affected-based CI: only build/test changed packages and dependents
- Consistent dependency versions across packages
- Publish internal packages with workspace protocol

## Developer Experience

- Hot module replacement for fast iteration
- TypeScript for type safety across the codebase
- Storybook for isolated component development
- Automated formatting and linting on save (Prettier, ESLint)
- Preview deployments on pull requests

## Testing Infrastructure

- Unit: Vitest or Jest for logic and utilities
- Component: Testing Library for interaction tests
- Visual regression: Playwright screenshots at key breakpoints
- E2E: Playwright or Cypress for critical user flows
- Accessibility: axe-core in CI, manual keyboard testing
- Run the full suite in CI; fast subset on pre-commit

## Deployment

- CDN for static assets with long-lived cache and content hashing
- Edge functions for dynamic personalization at the CDN layer
- Preview environments per pull request
- Feature flags for progressive rollout
- Rollback strategy: revert deploy or disable feature flag

## Anti-Patterns

- Bundling everything into one chunk (no code splitting)
- Importing entire libraries when only a function is needed
- Client-side rendering for SEO-critical pages
- No performance budget (unconstrained growth)
- Polyfilling for browsers no longer in the support matrix
