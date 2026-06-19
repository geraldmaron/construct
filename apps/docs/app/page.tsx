/**
 * Home — editorial hero + sections derived from README.md and the concepts
 * overview. Copy here mirrors the canonical Construct narrative; the rest of
 * the site is rendered from docs/*.mdx via app/[...slug]/page.tsx.
 */

'use client';

import Link from 'next/link';
import {
  Section, CodeBlock, Diagram, Callout, FeatureGrid,
  ArrowRight, GitHubIcon, useTheme,
} from '@cx/ui';

const homeChart = `
flowchart LR
    U["You"]:::u
    P["construct<br/>persona"]:::p
    R["routing<br/>+ gates"]:::r
    S["28 specialists<br/>arch · eng · review · qa · sec"]:::s
    V["verification"]:::v
    O["result"]:::u
    U --> P --> R --> S --> V
    V -- pass --> O
    V -- fail --> S
    classDef u fill:transparent,stroke-width:1.4px;
    classDef p fill:transparent,stroke-width:1.4px;
    classDef r fill:transparent,stroke-width:1.4px;
    classDef s fill:transparent,stroke-width:1.4px;
    classDef v fill:transparent,stroke-width:1.4px;
`;

export default function HomePage() {
  const theme = useTheme();

  return (
    <div className="page">
      <div className="hero">
        <div className="hero-grad" />
        <div className="hero-grain" />
        <div className="eyebrow">
          <span className="dot" />
          <span>orchestration layer</span>
          <span style={{ color: 'var(--faint)' }}>·</span>
          <span>Apache 2.0</span>
        </div>
        <h1>
          One <em>AI interface</em><span className="slash">.</span>
          <br />
          A <em>team</em> behind it.
        </h1>
        <p className="hero-sub">
          Construct sits on top of Claude Code, OpenCode, Codex, Cursor, and Copilot. You talk to one
          persona called <code>construct</code>. Behind it is a team of specialists shaped by your
          org profile. Hard gates. Runs locally — or deployed for teams.
        </p>
        <div className="hero-cta">
          <Link href="/start" className="btn primary">
            5-minute quickstart <ArrowRight />
          </Link>
          <Link href="/concepts/architecture" className="btn">
            See the architecture
          </Link>
          <a className="btn" href="https://github.com/geraldmaron/construct" target="_blank" rel="noreferrer">
            <GitHubIcon /> Repo
          </a>
        </div>
        <div className="hero-stats">
          <div className="hero-stat">
            <span className="k">Specialists</span>
            <span className="v"><em>28</em></span>
          </div>
          <div className="hero-stat">
            <span className="k">Surfaces</span>
            <span className="v">Claude · Codex · OpenCode · Cursor · Copilot</span>
          </div>
          <div className="hero-stat">
            <span className="k">Modes</span>
            <span className="v">solo · team · enterprise</span>
          </div>
          <div className="hero-stat">
            <span className="k">Storage</span>
            <span className="v">file · sql · vector</span>
          </div>
        </div>
      </div>

      <div className="personal" style={{ marginTop: 40 }}>
        <div className="personal-head">
          <div className="lhs">
            <div className="av" />
            <div className="lbl">
              Heads up — <b>from the maker</b>
            </div>
          </div>
        </div>
        <div className="personal-body">
          “I&apos;m not a developer. Construct is a side project I&apos;m vibe-coding to learn in
          public. There will be bugs, rough edges, and things that change without warning. The code
          is open source, the issues queue is real, and contributions are welcome. If you need
          production-grade tooling today, this isn&apos;t it yet.”
        </div>
      </div>

      <div style={{ height: 56 }} />

      <Section
        num="01"
        title={<>What Construct <em>is</em></>}
        tldr="One agent on the surface; an orchestration system underneath. You ask for an outcome — Construct routes specialists, keeps state aligned, and runs verification until something verifies or a real blocker surfaces."
        time="2 min"
        defaultOpen
      >
        <p>
          From the user side, Construct feels like one agent you can talk to. Under the hood,
          it&apos;s an orchestration system that routes work across 28 specialist roles shaped by
          your active <strong>org profile</strong> — software R&amp;D by default, with curated
          profiles for operations, creative, and research orgs, plus a schema-validated escape
          hatch for custom profiles.
        </p>
        <p>
          Sessions survive boundary changes via durable state in <code>.cx/</code>, Beads, and a
          local vector index. Solo by default. Can deploy centrally for teams that want shared
          memory, telemetry, queues, and policy.
        </p>
        <Diagram id="home-flow" theme={theme} title="Request, in flight" chart={homeChart} />
        <h4>Use it inside your editor</h4>
        <CodeBlock title="@construct">
{`@construct read the README and summarize what this project is
@construct review the auth flow in src/auth/ and flag risks
@construct fix the login redirect bug
@construct ship the customer portal when it's verified`}
        </CodeBlock>
      </Section>

      <Section
        num="02"
        title={<>The everyday <em>loop</em></>}
        tldr="Most days you check status, sync after registry changes, review the inbox, and run doctor when something feels off."
        time="1 min"
      >
        <CodeBlock>
{`construct status          # confirm services and editor adapters are healthy
construct sync            # refresh host adapters after registry or config changes
construct intake list     # review new signals, if your project uses the inbox
construct doctor          # diagnose install, service, MCP, and adapter drift`}
        </CodeBlock>
        <p>
          In your editor, start with <code>@construct</code>. Ask for the outcome, not the
          specialist. Construct routes to the right chain, keeps durable state in <code>.cx/</code>
          and Beads, and blocks risky mutations until the configured gates pass.
        </p>
      </Section>

      <Section
        num="03"
        title={<>What you <em>get</em></>}
        tldr="Outcome-driven routing · 28 specialists that argue with each other · durable state · hybrid retrieval · hard gates · explicit deployment modes."
        time="2 min"
      >
        <FeatureGrid cells={[
          { num: '01', title: 'One persona, many specialists', body: 'You address @construct. It dispatches to 28 specialists (architect, engineer, reviewer, QA, security, designer, …) under typed contracts.' },
          { num: '02', title: 'Specialists that argue', body: 'Reviewer, security, devil’s advocate, and QA are peers — not rubber stamps. Agreement at every step is treated as a smell.' },
          { num: '03', title: 'Durable project state', body: <>Beads for work items, <code>.cx/</code> for context + handoffs, git for code, Postgres + pgvector for embeddings. Nothing important lives in only one place.</> },
          { num: '04', title: 'Health you can see', body: <>A canonical <code>construct status</code> and <code>construct doctor</code> — runtime, providers, telemetry, storage modes, adapter drift.</> },
          { num: '05', title: 'Hybrid retrieval', body: 'File-state, SQL-ready records, and semantic search over a shared corpus. Falls back to a local JSON vector index when Postgres isn’t available.' },
          { num: '06', title: 'Hard gates, not vibes', body: 'Three layers — write-time hooks, commit/push gates, CI safety-net. Quality gates fire unconditionally; notice-only signals auto-suppress in CI and non-TTY contexts. If a gate fires wrong, repair the policy — do not bypass it.' },
        ]} />
      </Section>

      <Section
        num="04"
        title={<>Three <em>deployment modes</em></>}
        tldr="solo (default) runs everything locally. team promotes the queue and memory to shared Postgres with brokered MCP. enterprise adds tenant isolation, RBAC/ABAC, signed allowlists, mandatory audit."
        time="1 min"
      >
        <p>
          <code>solo</code> runs everything locally — filesystem queue, local repo state, optional
          Postgres via Docker, local JSONL traces. If every cloud service goes down, you still work
          from <code>plan.md</code>, <code>.cx/context.md</code>, beads, git, and the local vector
          index.
        </p>
        <p>
          <code>team</code> promotes the intake queue to Postgres with row-locked worker claims.
          Shared memory, Docker worker pool, centralized telemetry, MCP through a broker.
        </p>
        <p>
          <code>enterprise</code> adds tenant isolation, RBAC/ABAC scaffolding, isolated worker
          containers, signed MCP allowlists, and mandatory audit.
        </p>
        <CodeBlock>{`construct config mode [solo|team|enterprise]`}</CodeBlock>
        <Callout label="Same loop, different topology">
          The agent loop (persona, specialists, contracts, gates) is identical across all three
          modes. Only the backend topology changes — read <Link className="link" href="/concepts/deployment-model">deployment model</Link> for the trade-offs.
        </Callout>
      </Section>

      <Section
        num="05"
        title={<>Where to <em>go next</em></>}
        tldr="Install + first task → editor wiring → concepts and recipes. Reference is for when you know what you're looking up."
        time="1 min"
      >
        <ul>
          <li><Link className="link" href="/start">Get started</Link> — install, init, first task. ~5 minutes if Docker is running.</li>
          <li><Link className="link" href="/concepts/architecture">Architecture</Link> — diagrams, the request lifecycle, where things live.</li>
          <li><Link className="link" href="/concepts/deployment-model">Deployment model</Link> — pick solo, team, or enterprise.</li>
          <li><Link className="link" href="/concepts/intake-and-triage">Intake and triage</Link> — how signals become triaged R&amp;D work.</li>
          <li><Link className="link" href="/cookbook">Cookbook</Link> — task-oriented recipes (custom agents, providers, retrieval backend, your own LLM).</li>
          <li><Link className="link" href="/reference">Reference</Link> — every CLI command, hook, MCP tool, config option.</li>
        </ul>
      </Section>
    </div>
  );
}
