import Link from 'next/link';

const SECTION_CARDS = [
  {
    title: 'Get started',
    href: '/start',
    eyebrow: '5 min',
    description: 'Install, initialize a project, dispatch a task. Zero to first agent response.',
  },
  {
    title: 'Concepts',
    href: '/concepts',
    eyebrow: 'WHY',
    description: 'Architecture, the persona-and-specialists model, gates, durable state, deployment model.',
  },
  {
    title: 'Cookbook',
    href: '/cookbook',
    eyebrow: 'HOW',
    description: 'Task-oriented recipes for adding agents, fixing policy violations, plugging in your own LLM.',
  },
  {
    title: 'Reference',
    href: '/reference',
    eyebrow: 'LOOK UP',
    description: 'Every CLI command, hook, MCP tool, config option, provider.',
  },
];

const FEATURES = [
  {
    title: 'One interface, 28 specialists',
    body: 'Address @construct. It routes work to a team of typed specialists — architect, engineer, reviewer, QA, security, designer — under contract handoffs you can audit.',
  },
  {
    title: 'Hard gates, not vibes',
    body: 'Every code mutation runs through enforcement: no secrets, tests green, docs current, comments clean. Three layers — write-time, commit/push, CI safety net. Each bypass leaves an audit trail.',
  },
  {
    title: 'Solo, team, or enterprise',
    body: "Three deployment modes select the topology: solo runs everything locally with filesystem queue and optional Postgres/Docker; team promotes intake to a Postgres queue with row-locked workers, shared memory, brokered MCP, and central telemetry; enterprise adds tenant isolation, signed allowlists, and audit. Same agent loop across all three.",
  },
  {
    title: 'Plug-shaped',
    body: 'Six-layer retrieval pipeline (embedder, chunker, indexer, fuser, reranker, compressor) — swap any layer. Three LLM tiers — swap providers per tier or override per specialist. Stable contracts, opinionated defaults.',
  },
];

export default function HomePage() {
  return (
    <main className="flex flex-col">
      <section className="relative overflow-hidden border-b border-fd-border">
        <div
          aria-hidden
          className="pointer-events-none absolute inset-0 -z-10"
          style={{
            backgroundImage:
              'radial-gradient(ellipse 80% 50% at 50% -20%, hsl(222 88% 56% / 0.18), transparent 60%), radial-gradient(ellipse 60% 50% at 80% 0%, hsl(280 88% 60% / 0.10), transparent 60%)',
          }}
        />
        <div className="mx-auto flex w-full max-w-5xl flex-col items-start gap-8 px-6 py-32 sm:py-40">
          <span className="inline-flex items-center gap-2 rounded-full border border-fd-border bg-fd-card/60 px-3 py-1 font-mono text-xs uppercase tracking-widest text-fd-muted-foreground backdrop-blur">
            <span className="size-1.5 rounded-full bg-fd-primary" />
            Deployable AI R&D operating system
          </span>
          <h1 className="max-w-4xl text-balance text-5xl font-semibold leading-[1.05] tracking-tight sm:text-6xl lg:text-7xl">
            One AI interface.
            <br />
            <span className="text-fd-muted-foreground">28 specialists.</span>
            <br />
            Hard gates.
          </h1>
          <p className="max-w-2xl text-balance text-lg leading-relaxed text-fd-muted-foreground sm:text-xl">
            Construct is the orchestration layer behind an agentic software organization. Plans, builds,
            reviews, ships — without leaving your editor.
          </p>
          <div className="mt-2 flex flex-wrap items-center gap-3">
            <Link
              href="/start"
              className="inline-flex items-center justify-center rounded-md bg-fd-foreground px-5 py-2.5 text-sm font-medium text-fd-background transition-colors hover:bg-fd-foreground/90"
            >
              Get started
              <span aria-hidden className="ml-1.5">
                →
              </span>
            </Link>
            <Link
              href="/concepts/architecture"
              className="inline-flex items-center justify-center rounded-md border border-fd-border bg-fd-card px-5 py-2.5 text-sm font-medium text-fd-foreground transition-colors hover:bg-fd-accent"
            >
              How it works
            </Link>
            <a
              href="https://github.com/geraldmaron/construct"
              className="inline-flex items-center justify-center rounded-md px-3 py-2.5 text-sm font-medium text-fd-muted-foreground transition-colors hover:text-fd-foreground"
            >
              View on GitHub
            </a>
          </div>
          <pre className="mt-8 w-full max-w-2xl overflow-x-auto rounded-lg border border-fd-border bg-fd-card/40 p-4 font-mono text-sm leading-relaxed backdrop-blur">
            <code>
              <span className="text-fd-muted-foreground">$ </span>
              npm install -g @geraldmaron/construct
              {'\n'}
              <span className="text-fd-muted-foreground">$ </span>
              construct init --yes
              {'\n'}
              <span className="text-fd-muted-foreground">$ </span>
              construct init && construct sync
              {'\n'}
              <span className="text-fd-muted-foreground">$ </span>
              construct up
              {'\n'}
              <span className="text-fd-muted-foreground"># Open your editor; address @construct</span>
            </code>
          </pre>
        </div>
      </section>

      <section className="border-b border-fd-border">
        <div className="mx-auto grid w-full max-w-5xl gap-px bg-fd-border px-px sm:grid-cols-2 lg:grid-cols-4">
          {SECTION_CARDS.map((card) => (
            <Link
              key={card.href}
              href={card.href}
              className="group flex flex-col gap-3 bg-fd-background p-6 transition-colors hover:bg-fd-muted/50"
            >
              <span className="font-mono text-[10px] uppercase tracking-[0.2em] text-fd-muted-foreground">
                {card.eyebrow}
              </span>
              <h3 className="text-lg font-semibold tracking-tight">
                {card.title}
                <span
                  aria-hidden
                  className="ml-1 inline-block translate-x-0 transition-transform group-hover:translate-x-0.5"
                >
                  →
                </span>
              </h3>
              <p className="text-sm leading-relaxed text-fd-muted-foreground">{card.description}</p>
            </Link>
          ))}
        </div>
      </section>

      <section className="mx-auto w-full max-w-5xl px-6 py-24">
        <div className="mb-12 max-w-2xl">
          <h2 className="text-3xl font-semibold tracking-tight sm:text-4xl">
            Built for shipping, not for demos.
          </h2>
          <p className="mt-3 text-base leading-relaxed text-fd-muted-foreground">
            Construct's defaults are opinionated. Every default is replaceable.
          </p>
        </div>
        <div className="grid gap-8 sm:grid-cols-2 lg:gap-12">
          {FEATURES.map((feature) => (
            <div key={feature.title} className="flex flex-col gap-2">
              <h3 className="text-lg font-semibold tracking-tight">{feature.title}</h3>
              <p className="text-sm leading-relaxed text-fd-muted-foreground">{feature.body}</p>
            </div>
          ))}
        </div>
      </section>

      <section className="border-t border-fd-border bg-fd-muted/30">
        <div className="mx-auto flex w-full max-w-5xl flex-col items-start gap-6 px-6 py-20 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h2 className="text-2xl font-semibold tracking-tight">Ready to try it?</h2>
            <p className="mt-1 text-sm text-fd-muted-foreground">
              Five minutes from npm install to your first agent dispatch.
            </p>
          </div>
          <div className="flex gap-3">
            <Link
              href="/start"
              className="inline-flex items-center justify-center rounded-md bg-fd-foreground px-5 py-2.5 text-sm font-medium text-fd-background transition-colors hover:bg-fd-foreground/90"
            >
              Get started →
            </Link>
            <a
              href="https://github.com/geraldmaron/construct"
              className="inline-flex items-center justify-center rounded-md border border-fd-border bg-fd-background px-5 py-2.5 text-sm font-medium transition-colors hover:bg-fd-accent"
            >
              GitHub
            </a>
          </div>
        </div>
      </section>

      <footer className="border-t border-fd-border">
        <div className="mx-auto flex w-full max-w-5xl flex-wrap items-center justify-between gap-4 px-6 py-8">
          <div className="font-mono text-xs uppercase tracking-widest text-fd-muted-foreground">
            Construct · Elastic License 2.0
          </div>
          <div className="flex gap-6 text-sm text-fd-muted-foreground">
            <Link href="/start" className="hover:text-fd-foreground">
              Docs
            </Link>
            <Link href="/changelog" className="hover:text-fd-foreground">
              Changelog
            </Link>
            <a
              href="https://github.com/geraldmaron/construct"
              className="hover:text-fd-foreground"
            >
              GitHub
            </a>
          </div>
        </div>
      </footer>
    </main>
  );
}
