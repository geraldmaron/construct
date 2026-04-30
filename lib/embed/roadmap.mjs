/**
 * lib/embed/roadmap.mjs — roadmap generator for the embed daemon.
 *
 * Reads open issues from the last snapshot + relevant observations + decisions
 * from the observation store, then synthesises a prioritised roadmap markdown
 * file at <rootDir>/.cx/roadmap.md.
 *
 * Prioritisation is heuristic (no external LLM call required):
 *   - Issues/items scored by: open status weight, priority field, recency,
 *     observation signal (how many observations reference this item's key),
 *     and risk/anti-pattern observations that overlap by keyword.
 *
 * Output:
 *   <rootDir>/.cx/roadmap.md  — human-readable prioritised roadmap
 *   Returns { path, sections, updatedAt } for caller to post to Slack etc.
 */

import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { searchObservations } from '../observation-store.mjs';

const ROADMAP_PATH = '.cx/roadmap.md';

// Priority label → numeric weight (higher = more urgent)
const PRIORITY_WEIGHT = {
  urgent: 4, critical: 4, blocker: 4,
  high: 3,
  medium: 2, normal: 2,
  low: 1,
  none: 0,
};

function priorityScore(item) {
  const label = String(item.priority ?? item.priorityLabel ?? '').toLowerCase();
  for (const [key, w] of Object.entries(PRIORITY_WEIGHT)) {
    if (label.includes(key)) return w;
  }
  return 1; // default medium-low
}

function statusWeight(item) {
  const s = String(item.status ?? '').toLowerCase();
  if (/blocked|urgent|critical|overdue/.test(s)) return 3;
  if (/in.?progress|active|doing/.test(s)) return 2;
  if (/open|todo|backlog|new/.test(s)) return 1;
  return 0; // done / closed / cancelled
}

/**
 * Score a snapshot item. Higher = should appear earlier in roadmap.
 */
function scoreItem(item, observationSignal = 0, riskSignal = 0) {
  return (
    priorityScore(item) * 3 +
    statusWeight(item) * 2 +
    Math.min(observationSignal, 5) +   // cap at 5 to not dominate
    Math.min(riskSignal * 2, 6)        // risks/anti-patterns count double, cap 6
  );
}

/**
 * Build a keyword set from an item for observation cross-referencing.
 */
function itemKeywords(item) {
  const words = new Set();
  const add = (s) => {
    if (!s) return;
    String(s).toLowerCase().split(/\W+/).filter((w) => w.length > 3).forEach((w) => words.add(w));
  };
  add(item.key);
  add(item.summary);
  add(item.title);
  add(item.description);
  if (Array.isArray(item.labels)) item.labels.forEach(add);
  return words;
}

/**
 * Count how many observations mention any of the item's keywords.
 */
function observationSignalForItem(observations, item) {
  const keywords = itemKeywords(item);
  if (!keywords.size) return 0;
  let count = 0;
  for (const obs of observations) {
    const text = `${obs.summary ?? ''} ${obs.content ?? ''}`.toLowerCase();
    for (const kw of keywords) {
      if (text.includes(kw)) { count += 1; break; }
    }
  }
  return count;
}

/**
 * Extract open items from snapshot sections, skip closed/done.
 */
function extractOpenItems(sections) {
  const items = [];
  for (const section of sections ?? []) {
    for (const item of section.items ?? []) {
      const s = String(item.status ?? '').toLowerCase();
      if (/done|closed|merged|cancelled|resolved|completed/.test(s)) continue;
      items.push({ ...item, _provider: section.provider });
    }
  }
  return items;
}

/**
 * Format a single roadmap item line.
 */
function formatItem(item, rank) {
  const key = item.key ? `**${item.key}**` : '';
  const title = item.summary ?? item.title ?? item.subject ?? '(untitled)';
  const status = item.status ? ` \`${item.status}\`` : '';
  const priority = item.priority ?? item.priorityLabel;
  const pri = priority ? ` · ${priority}` : '';
  const assignee = item.assignee ? ` · @${item.assignee}` : '';
  const url = item.url ? ` — [link](${item.url})` : '';
  return `${rank}. ${key ? `${key} ` : ''}${title}${status}${pri}${assignee}${url}`;
}

/**
 * Render the full roadmap markdown.
 */
function renderRoadmap({ sections, observations, updatedAt }) {
  const lines = [
    `# Construct Roadmap`,
    `> Generated: ${updatedAt}`,
    `> Sources: ${sections.map((s) => s.provider).join(', ') || 'none'}`,
    '',
  ];

  // Risks section — anti-pattern observations surfaced first
  const risks = observations.filter((o) => o.category === 'anti-pattern').slice(0, 5);
  if (risks.length) {
    lines.push('## ⚠️ Active Risks', '');
    for (const r of risks) {
      lines.push(`- ${r.summary}`);
    }
    lines.push('');
  }

  // Decisions worth surfacing
  const decisions = observations.filter((o) => o.category === 'decision').slice(0, 5);
  if (decisions.length) {
    lines.push('## 📋 Recent Decisions', '');
    for (const d of decisions) {
      lines.push(`- ${d.summary}`);
    }
    lines.push('');
  }

  // Prioritised backlog per provider
  for (const section of sections) {
    if (!section.scored.length) continue;
    lines.push(`## ${section.provider} (${section.scored.length} open items)`, '');
    section.scored.forEach((item, i) => {
      lines.push(formatItem(item, i + 1));
    });
    lines.push('');
  }

  if (!sections.some((s) => s.scored.length)) {
    lines.push('_No open items found in last snapshot._', '');
  }

  return lines.join('\n');
}

function renderProfileSections(lines, snapshot) {
  const profile = snapshot.operatingProfile;
  if (!profile) return;

  lines.push('## Operating Profile', '');
  lines.push(`- Mission: ${profile.mission}`);
  lines.push(`- Autonomy: ${profile.strategy?.autonomy ?? 'read-first'}`);
  lines.push(`- Write policy: ${profile.strategy?.writePolicy ?? 'approval-required-for-high-risk'}`);
  lines.push('');

  const gaps = snapshot.operatingGaps ?? [];
  if (gaps.length) {
    lines.push('## Operating Gaps', '');
    for (const gap of gaps) lines.push(`- **${gap.severity}** ${gap.summary}`);
    lines.push('');
  }

  const artifacts = profile.responsibilities?.artifacts ?? {};
  const artifactNames = Object.entries(artifacts)
    .filter(([, state]) => state && state !== 'none')
    .map(([name, state]) => `${name} (${state})`);
  if (artifactNames.length) {
    lines.push('## Artifact Responsibilities', '');
    for (const name of artifactNames) lines.push(`- ${name}`);
    lines.push('');
  }
}

/**
 * Generate the roadmap from a snapshot + observation store.
 *
 * @param {object} opts
 * @param {string}   opts.rootDir   - Root for observation store + output file
 * @param {object}   opts.snapshot  - Last snapshot from EmbedDaemon
 * @returns {{ path: string, updatedAt: string, itemCount: number }}
 */
export async function generateRoadmap({ rootDir, snapshot }) {
  const updatedAt = new Date().toISOString();

  if (!snapshot) {
    return { path: null, updatedAt, itemCount: 0, skipped: true, reason: 'no snapshot available' };
  }

  // Pull recent observations for cross-referencing
  const recentObs = [
    ...(await searchObservations(rootDir, 'risk blocker critical urgent', { limit: 20 })),
    ...(await searchObservations(rootDir, 'decision architecture pattern', { limit: 20 })),
  ];
  // Deduplicate by id
  const obsById = new Map(recentObs.map((o) => [o.id, o]));
  const observations = [...obsById.values()];

  const riskObs = observations.filter((o) => o.category === 'anti-pattern');

  const sections = [];
  for (const section of snapshot.sections ?? []) {
    const openItems = extractOpenItems([section]);
    if (!openItems.length) continue;

    // Score each item
    const scored = openItems
      .map((item) => ({
        ...item,
        _score: scoreItem(
          item,
          observationSignalForItem(observations, item),
          observationSignalForItem(riskObs, item),
        ),
      }))
      .sort((a, b) => b._score - a._score);

    sections.push({ provider: section.provider, scored });
  }

  const itemCount = sections.reduce((n, s) => n + s.scored.length, 0);
  const lines = renderRoadmap({ sections, observations, updatedAt }).split('\n');
  renderProfileSections(lines, snapshot);
  const markdown = lines.join('\n');

  const outPath = join(rootDir, ROADMAP_PATH);
  mkdirSync(join(rootDir, '.cx'), { recursive: true });
  writeFileSync(outPath, markdown);

  return { path: outPath, updatedAt, itemCount };
}

/**
 * Produce a short Slack-friendly summary of the roadmap (≤3000 chars).
 */
export async function roadmapSlackSummary({ rootDir, snapshot }) {
  const result = await generateRoadmap({ rootDir, snapshot });
  if (result.skipped) return null;

  const lines = [`*Construct Roadmap* — ${result.updatedAt.slice(0, 10)} — ${result.itemCount} open items`];

  for (const section of snapshot?.sections ?? []) {
    const open = extractOpenItems([section]).slice(0, 5);
    if (!open.length) continue;
    lines.push(`\n*${section.provider}* top items:`);
    open.forEach((item, i) => {
      const title = item.summary ?? item.title ?? '(untitled)';
      const key = item.key ? `${item.key}: ` : '';
      lines.push(`${i + 1}. ${key}${title}`);
    });
  }

  lines.push(`\nFull roadmap: \`.cx/roadmap.md\``);
  return lines.join('\n').slice(0, 3000);
}
