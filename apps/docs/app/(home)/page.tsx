import Link from 'next/link';

export default function HomePage() {
  return (
    <main className="flex min-h-screen flex-col">
      <section className="mx-auto flex w-full max-w-4xl flex-col items-center gap-6 px-6 py-24 text-center">
        <p className="text-sm font-medium uppercase tracking-widest text-fd-muted-foreground">
          Construct
        </p>
        <h1 className="max-w-3xl text-balance text-4xl font-semibold tracking-tight sm:text-5xl">
          One AI interface. 28 specialists. Hard gates.
        </h1>
        <p className="max-w-2xl text-balance text-lg text-fd-muted-foreground">
          The orchestration layer behind an agentic software organization. Plans, builds,
          reviews, ships — without leaving your editor. Local-first. Offline-safe.
        </p>
        <div className="mt-4 flex flex-wrap items-center justify-center gap-3">
          <Link
            href="/start"
            className="inline-flex items-center justify-center rounded-md bg-fd-primary px-6 py-3 text-sm font-medium text-fd-primary-foreground transition-colors hover:bg-fd-primary/90"
          >
            Get started in 5 minutes
          </Link>
          <Link
            href="/concepts"
            className="inline-flex items-center justify-center rounded-md border border-fd-border bg-fd-background px-6 py-3 text-sm font-medium transition-colors hover:bg-fd-accent"
          >
            How it works
          </Link>
        </div>
      </section>

      <section className="mx-auto grid w-full max-w-5xl gap-4 px-6 pb-24 sm:grid-cols-2 lg:grid-cols-4">
        {SECTION_CARDS.map((card) => (
          <Link
            key={card.href}
            href={card.href}
            className="group rounded-lg border border-fd-border bg-fd-card p-5 transition-all hover:border-fd-primary/50 hover:shadow-md"
          >
            <h3 className="mb-2 font-semibold">{card.title}</h3>
            <p className="text-sm text-fd-muted-foreground">{card.description}</p>
          </Link>
        ))}
      </section>
    </main>
  );
}

const SECTION_CARDS = [
  {
    title: 'Concepts',
    href: '/concepts',
    description: 'How Construct thinks — architecture, agents, gates, durable state.',
  },
  {
    title: 'Cookbook',
    href: '/cookbook',
    description: 'Task-oriented recipes for the work you actually want to do.',
  },
  {
    title: 'Reference',
    href: '/reference',
    description: 'CLI commands, hooks, MCP tools, config, providers.',
  },
  {
    title: 'Operations',
    href: '/operations',
    description: 'Day-2: backup, monitoring, troubleshooting, runbooks.',
  },
];
