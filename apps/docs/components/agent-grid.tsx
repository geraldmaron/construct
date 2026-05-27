/**
 * agent-grid.tsx — Specialist roster visualization.
 *
 * Renders the 28 cx-specialist agents grouped by domain. Each group
 * gets a colored header and a responsive grid of compact agent cards.
 *
 * Usage in MDX (no import needed — registered globally):
 *   <AgentGrid groups={[
 *     { label: 'R&D', accent: 'emerald', agents: [{ name: 'Orchestrator', tag: 'assembles the chain' }] },
 *   ]} />
 */

export interface AgentCard {
  name: string;
  tag: string;
}

export interface AgentGroup {
  label: string;
  accent: 'emerald' | 'sky' | 'violet' | 'amber' | 'rose';
  agents: AgentCard[];
}

interface AgentGridProps {
  groups: AgentGroup[];
}

const ACCENTS: Record<AgentGroup['accent'], { section: string; badge: string; border: string }> = {
  emerald: {
    section: 'text-emerald-700 dark:text-emerald-400',
    badge: 'bg-emerald-500/10 border-emerald-500/30 text-emerald-700 dark:text-emerald-400',
    border: 'border-l-emerald-500/50',
  },
  sky: {
    section: 'text-sky-700 dark:text-sky-400',
    badge: 'bg-sky-500/10 border-sky-500/30 text-sky-700 dark:text-sky-400',
    border: 'border-l-sky-500/50',
  },
  violet: {
    section: 'text-violet-700 dark:text-violet-400',
    badge: 'bg-violet-500/10 border-violet-500/30 text-violet-700 dark:text-violet-400',
    border: 'border-l-violet-500/50',
  },
  amber: {
    section: 'text-amber-700 dark:text-amber-400',
    badge: 'bg-amber-500/10 border-amber-500/30 text-amber-700 dark:text-amber-400',
    border: 'border-l-amber-500/50',
  },
  rose: {
    section: 'text-rose-700 dark:text-rose-400',
    badge: 'bg-rose-500/10 border-rose-500/30 text-rose-700 dark:text-rose-400',
    border: 'border-l-rose-500/50',
  },
};

export function AgentGrid({ groups }: AgentGridProps) {
  return (
    <div className="not-prose my-8 flex flex-col gap-6">
      {groups.map((group) => {
        const accent = ACCENTS[group.accent];
        return (
          <div key={group.label}>
            {/* Domain label */}
            <div className="mb-3 flex items-center gap-2">
              <span
                className={`rounded-full border px-2.5 py-0.5 font-mono text-[10px] uppercase tracking-widest ${accent.badge}`}
              >
                {group.label}
              </span>
              <div className="h-px flex-1 bg-fd-border/40" />
            </div>

            {/* Agent cards */}
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4">
              {group.agents.map((agent) => (
                <div
                  key={agent.name}
                  className={`flex flex-col gap-0.5 rounded-lg border border-l-2 border-fd-border bg-fd-card px-3 py-2.5 transition-colors hover:bg-fd-muted/30 ${accent.border}`}
                >
                  <span className="text-xs font-semibold text-fd-foreground">{agent.name}</span>
                  <span className="text-[10px] leading-relaxed text-fd-muted-foreground">{agent.tag}</span>
                </div>
              ))}
            </div>
          </div>
        );
      })}
    </div>
  );
}
