/**
 * lib/reconcile/legacy-doctrine-strip.mjs — collapse a legacy un-fenced doctrine
 * body in an existing AGENTS.md / CLAUDE.md down to the project header plus the
 * marker blocks (ADR-0027 §2 backward-repair).
 *
 * An earlier `construct init` pre-wrote ~120 lines of generic Construct operating
 * doctrine ABOVE the marker blocks, so a host repo carries Construct-the-tool
 * content outside any fence — content `construct sync` cannot reconcile because
 * the marker-only injector preserves everything outside its markers. This task
 * removes the known doctrine sections while preserving: the project H1, any
 * non-doctrine section the user added, and every marker block (BEADS, CONSTRUCT).
 *
 * Safety: `ask` — it edits a user-owned tracked file, so it never runs from the
 * auto sync path and only applies on explicit `construct sync --reconcile=<id>`.
 * detect() reads only; apply() is idempotent: a stripped file lacks the doctrine
 * fingerprint, so a second detect() reports clean.
 */

import fs from 'node:fs';
import path from 'node:path';

const AGENT_FILES = ['AGENTS.md', 'CLAUDE.md'];
const CONSTRUCT_MARKER = '<!-- BEGIN CONSTRUCT INTEGRATION';
const BEADS_MARKER = '<!-- BEGIN BEADS INTEGRATION';

// The H2 sections the retired buildAgentsGuide() authored. The five core
// headings form the fingerprint; the rest are stripped too when the head is
// confirmed as that doctrine.

const CORE_DOCTRINE_HEADINGS = [
  'Operating hierarchy',
  'Start-of-session rules',
  'Maintenance rules',
  'End-of-session rules',
  'Verification rules',
];

const ALL_DOCTRINE_HEADINGS = new Set([
  ...CORE_DOCTRINE_HEADINGS,
  'Parallel agent coordination',
  'Documentation System',
  'CI Enforcement',
]);

function firstMarkerIndex(content) {
  const idxs = [content.indexOf(BEADS_MARKER), content.indexOf(CONSTRUCT_MARKER)].filter((i) => i >= 0);
  return idxs.length ? Math.min(...idxs) : -1;
}

function splitHeadTail(content) {
  const idx = firstMarkerIndex(content);
  if (idx < 0) return { head: content, tail: '' };
  return { head: content.slice(0, idx), tail: content.slice(idx) };
}

function hasDoctrine(head) {
  return CORE_DOCTRINE_HEADINGS.every((h) => head.includes(`## ${h}`));
}

function deriveProjectName(head) {
  const guide = head.match(/^#\s+(.+?)\s+Agent Guide\s*$/m);
  if (guide) return guide[1].trim();
  const h1 = head.match(/^#\s+(.+?)\s*$/m);
  if (h1) return h1[1].trim();
  return path.basename(process.cwd());
}

// The rebuilt head is a plain project H1 followed by only the user-authored
// sections: any section whose heading is in the doctrine set is excluded, as are
// the generator comment and the "X Agent Guide" title.

function stripDoctrineFromHead(head, projectName) {
  const withoutFrontmatter = head.replace(/^---\n[\s\S]*?\n---\s*\n/, '');
  const withoutComment = withoutFrontmatter.replace(/^\s*<!--[\s\S]*?-->\s*/, '');
  const afterH1 = withoutComment.replace(/^#\s+.+?\n+/, '');
  const sections = afterH1.split(/\n(?=## )/).map((s) => s.trim()).filter(Boolean);
  const kept = sections.filter((section) => {
    const title = section.match(/^##\s+(.+?)\s*$/m)?.[1]?.trim();
    return title ? !ALL_DOCTRINE_HEADINGS.has(title) : true;
  });
  const body = kept.length ? `${kept.join('\n\n')}\n\n` : '';
  return `# ${projectName}\n\n${body}`;
}

function candidateFiles() {
  const dir = process.cwd();
  const out = [];
  for (const name of AGENT_FILES) {
    const full = path.join(dir, name);
    if (!fs.existsSync(full)) continue;
    let content = '';
    try {
      content = fs.readFileSync(full, 'utf8');
    } catch {
      continue;
    }
    if (!content.includes(CONSTRUCT_MARKER)) continue;
    const { head } = splitHeadTail(content);
    if (!hasDoctrine(head)) continue;
    out.push({ name, full, content });
  }
  return out;
}

async function detect() {
  const candidates = candidateFiles();
  if (candidates.length === 0) {
    return { needsRepair: false, summary: 'No agent file carries a legacy un-fenced doctrine body.' };
  }
  const names = candidates.map((c) => c.name);
  return {
    needsRepair: true,
    summary: `Legacy un-fenced Construct doctrine in ${names.join(', ')}; collapse to the project header plus marker blocks.`,
    details: { files: names },
  };
}

async function apply() {
  const candidates = candidateFiles();
  const stripped = [];
  for (const c of candidates) {
    const { head, tail } = splitHeadTail(c.content);
    const projectName = deriveProjectName(head);
    const next = stripDoctrineFromHead(head, projectName) + tail;
    if (next === c.content) continue;
    fs.writeFileSync(c.full, next, 'utf8');
    stripped.push(c.name);
  }
  if (stripped.length === 0) return { summary: 'No legacy doctrine to strip.' };
  return { summary: `Stripped legacy doctrine from ${stripped.join(', ')}; user content and marker blocks preserved.` };
}

export default {
  id: 'legacy-doctrine-strip',
  description: 'Collapse a legacy un-fenced Construct doctrine body in AGENTS.md / CLAUDE.md to the project header plus marker blocks.',
  safety: 'ask',
  detect,
  apply,
};
