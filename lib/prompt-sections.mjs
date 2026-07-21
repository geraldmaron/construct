/**
 * lib/prompt-sections.mjs — capability-tiered prompt section rendering.
 *
 * A prompt is authored once. Each `## ` section may carry `<!-- construct:prio=N -->`
 * marker on its heading; the preamble before the first heading is always prio 1
 * (identity + anti-fabrication). Small local models follow large multi-instruction
 * prompts poorly — instruction-following degrades well before the context window fills —
 * so a weak model receives only the sections it can actually comply with. Tiers:
 * floor (prio 1, must-keep), mid (prio <= 2), full (all). The marker is stripped from the
 * emitted text. Untagged `## ` sections default to prio 2 so authoring omissions degrade
 * gracefully rather than vanishing or forcing a floor model to read everything.
 */

const TIER_MAX_PRIO = Object.freeze({ floor: 1, mid: 2, full: 3 });
const PRIO_MARKER = /<!--\s*construct:prio=(\d+)\s*-->/;
const PRIO_MARKER_GLOBAL = /[ \t]*<!--\s*construct:prio=\d+\s*-->/g;

// The markers are authoring metadata; no emitted prompt (full or tiered) may carry them.
// Tiered render strips them via section parsing; full render (composePrompt) calls this.

export function stripSectionMarkers(text) {
  return String(text || "").replace(PRIO_MARKER_GLOBAL, "");
}

// `## ` (exactly two hashes) is the only section boundary; `### ` subheadings stay with
// their parent section. The preamble (before the first `## `) is implicit prio 1.

export function parsePromptSections(body) {
  const lines = String(body || "").split("\n");
  const sections = [];
  let current = { heading: null, prio: 1, lines: [] };

  const flush = () => {
    const content = current.lines.join("\n").trim();
    if (content || current.heading) {
      sections.push({ heading: current.heading, prio: current.prio, content });
    }
  };

  for (const line of lines) {
    if (line.startsWith("## ")) {
      flush();
      const marker = line.match(PRIO_MARKER);
      const prio = marker ? Number(marker[1]) : 2;
      const heading = line.replace(PRIO_MARKER, "").trimEnd();
      current = { heading, prio, lines: [heading] };
    } else {
      current.lines.push(line);
    }
  }
  flush();
  return sections;
}

export function renderPromptForTier(body, tier = "full") {
  const maxPrio = TIER_MAX_PRIO[tier] ?? TIER_MAX_PRIO.full;
  return parsePromptSections(body)
    .filter((section) => section.prio <= maxPrio)
    .map((section) => stripSectionMarkers(section.content))
    .filter(Boolean)
    .join("\n\n");
}

export function promptTierMaxPrio(tier) {
  return TIER_MAX_PRIO[tier] ?? TIER_MAX_PRIO.full;
}
