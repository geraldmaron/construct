/**
 * lib/reflect/salience.mjs — deterministic "is this worth remembering" score.
 *
 * The transcript extractor produces one observation per session and stamped every
 * one with a flat confidence, so a session that changed the codebase and a trivial
 * read-only exchange were remembered with equal weight (the mem0/Letta "salience"
 * gap). This scores a session's durable value from signals already collected — what
 * tools ran, whether files were mutated, how substantive the exchange was — with no
 * LLM, matching Construct's offline-first posture.
 *
 * The score feeds the observation's `confidence`, so the existing consolidation pass
 * carries retention on its own — no second mechanism. Consolidation archives a session
 * only once both older than `archiveAfterDays` and below `archiveBelowConfidence` (0.5),
 * so a low-salience session ages out of the live set while a high-salience one survives.
 * `shouldStore` is the extraction decision: a session with no durable signal at all is
 * not worth an observation.
 */

// Tools that change durable state are the strongest salience signal; a session
// that edits the tree is worth more than one that only reads it.
const MUTATING_TOOLS = new Set(['Write', 'Edit', 'MultiEdit', 'NotebookEdit']);
const READ_TOOLS = new Set(['Read', 'Grep', 'Glob', 'LS']);

function countByPredicate(toolTypes, pred) {
  let n = 0;
  for (const [name, count] of toolTypes ?? new Map()) if (pred(name)) n += count;
  return n;
}

/**
 * Score a session's salience in [0.05, 0.95] from its collected stats.
 * @param {{toolTypes?: Map<string,number>, toolCallCount?: number, assistantTurns?: number, filesTouched?: Set<any>}} stats
 * @returns {{salience: number, signals: string[]}}
 */
export function scoreSalience(stats = {}) {
  const toolTypes = stats.toolTypes ?? new Map();
  const mutations = countByPredicate(toolTypes, (t) => MUTATING_TOOLS.has(t));
  const reads = countByPredicate(toolTypes, (t) => READ_TOOLS.has(t));
  const bash = countByPredicate(toolTypes, (t) => t === 'Bash');
  const assistantTurns = stats.assistantTurns ?? 0;
  const filesTouched = stats.filesTouched?.size ?? 0;

  const signals = [];
  let score = 0.25;
  if (mutations > 0) { score += 0.45; signals.push(`mutated ${mutations}× (durable change)`); }
  else if (bash > 0) { score += 0.15; signals.push(`ran ${bash} bash command(s)`); }
  else if (reads > 0) { signals.push('read-only/exploratory'); }
  if (assistantTurns >= 5) { score += 0.1; signals.push(`${assistantTurns} assistant turns (substantive)`); }
  if (filesTouched >= 3) { score += 0.05; signals.push(`${filesTouched} files in scope`); }

  const salience = Math.max(0.05, Math.min(0.95, Number(score.toFixed(2))));
  return { salience, signals };
}

/**
 * The extraction decision: a session carrying no durable signal — no mutations, no
 * bash, and barely any exchange — is noise, not memory, and is not stored.
 */
export function shouldStore(stats = {}) {
  const toolTypes = stats.toolTypes ?? new Map();
  const mutations = countByPredicate(toolTypes, (t) => MUTATING_TOOLS.has(t));
  const bash = countByPredicate(toolTypes, (t) => t === 'Bash');
  const assistantTurns = stats.assistantTurns ?? 0;
  return mutations > 0 || bash > 0 || assistantTurns >= 2;
}
