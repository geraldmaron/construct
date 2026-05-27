/**
 * deploy-modes.tsx — Side-by-side deployment mode comparison.
 *
 * Renders solo / team / enterprise as styled cards with a capability
 * breakdown table in each. Color accent is keyed to the mode name.
 *
 * Usage in MDX (no import needed — registered globally):
 *   <DeployModes modes={[{ name, tag, description, rows }]} />
 */

export interface DeployMode {
  name: string;
  tag: string;
  description: string;
  rows: { label: string; value: string }[];
}

interface DeployModesProps {
  modes: DeployMode[];
}

const ACCENTS: Record<string, { card: string; badge: string; title: string }> = {
  solo: {
    card: 'border-sky-500/30 bg-sky-500/5',
    badge: 'border-sky-500/30 bg-sky-500/10 text-sky-700 dark:text-sky-400',
    title: 'text-sky-700 dark:text-sky-400',
  },
  team: {
    card: 'border-violet-500/30 bg-violet-500/5',
    badge: 'border-violet-500/30 bg-violet-500/10 text-violet-700 dark:text-violet-400',
    title: 'text-violet-700 dark:text-violet-400',
  },
  enterprise: {
    card: 'border-amber-500/30 bg-amber-500/5',
    badge: 'border-amber-500/30 bg-amber-500/10 text-amber-700 dark:text-amber-400',
    title: 'text-amber-700 dark:text-amber-400',
  },
};

const FALLBACK = {
  card: 'border-fd-border bg-fd-card',
  badge: 'border-fd-border bg-fd-muted text-fd-muted-foreground',
  title: 'text-fd-foreground',
};

export function DeployModes({ modes }: DeployModesProps) {
  return (
    <div className="not-prose my-8 grid gap-4 sm:grid-cols-3">
      {modes.map((mode) => {
        const key = mode.name.toLowerCase();
        const accent = ACCENTS[key] ?? FALLBACK;
        return (
          <div key={mode.name} className={`flex flex-col gap-4 rounded-xl border p-5 ${accent.card}`}>
            {/* Header */}
            <div className="flex items-start justify-between gap-2">
              <div>
                <p className={`text-lg font-bold ${accent.title}`}>{mode.name}</p>
                <span
                  className={`mt-1 inline-block rounded-full border px-2 py-0.5 font-mono text-[10px] uppercase tracking-wider ${accent.badge}`}
                >
                  {mode.tag}
                </span>
              </div>
            </div>

            {/* Description */}
            <p className="text-xs leading-relaxed text-fd-muted-foreground">{mode.description}</p>

            {/* Capability rows */}
            <div className="flex flex-col gap-2 border-t border-fd-border/40 pt-3">
              {mode.rows.map((row) => (
                <div key={row.label} className="flex flex-col gap-0.5">
                  <span className="font-mono text-[10px] uppercase tracking-wide text-fd-muted-foreground">
                    {row.label}
                  </span>
                  <span className="text-xs font-medium text-fd-foreground">{row.value}</span>
                </div>
              ))}
            </div>
          </div>
        );
      })}
    </div>
  );
}
