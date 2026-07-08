/**
 * lib/knowledge/synthesis.mjs — cross-project synthesis (bead construct-760c.4→.3).
 *
 * Map-reduce over the B2 multi-root corpus so a user can ask one question across
 * several registered projects — "summarize each project's docs", "how do these
 * strategies converge" — and get an answer that names its sources (no
 * fabrication: every cross-project claim traces to an origin the reader can
 * re-verify).
 *
 *   MAP    — per project, retrieve the chunks most relevant to the ask from that
 *            project's content root only, and extract them as an attributed
 *            section. This pass is retrieval-only (no model call), so it is
 *            deterministic and free — the cheap-tier goal taken to its limit.
 *   REDUCE — one synthesis pass over the per-project sections that draws the
 *            convergence/divergence across projects, each claim carrying an
 *            origin citation. This is the single model call.
 *
 * `dryRun` stops after MAP and returns the fully assembled context (per-project
 * sections + a citation table + the reduce prompt) with zero model output — the
 * deterministic, CI-testable preview surface. An unknown project id is a hard
 * error before any model call (R3).
 */

import { spawnSync } from 'node:child_process';

import { loadProjectConfig } from '../config/project-config.mjs';
import { resolveEffectiveSourceTargetsFromConfig } from '../config/source-targets.mjs';
import { resolveContentRoots, expandProjectsFilter } from '../sources/content-roots.mjs';
import { getTemplate } from '../mcp/tools/skills.mjs';
import { buildCorpus, retrieve } from './rag.mjs';

const PER_PROJECT_TOPK = 6;
const SECTION_PREVIEW = 500;

function citationLabel(origin) {
  const rel = origin?.relPath || '(unknown)';
  return `${origin?.projectKey || origin?.targetId || 'project'}:${rel}`;
}

// Retrieval-only map: a single-root corpus filtered to this project's own
// chunks, then top-K for the ask. Sorting the roots and keying each corpus to a
// single origin keeps the assembly deterministic across runs (AC3).
async function mapProject(root, ask, { cwd, topK }) {
  const corpus = buildCorpus(cwd, { roots: [root] })
    .filter((c) => c.origin?.targetId === root.origin.targetId);
  const hits = await retrieve(ask, corpus, { topK });
  return { root, hits };
}

function renderProjectSection({ root, hits }) {
  const id = root.origin.targetId;
  if (!hits.length) {
    return `## Project: ${id}\n\n_No content matched the query in this project._`;
  }
  const blocks = hits.map((h) => {
    const preview = (h.body || '').slice(0, SECTION_PREVIEW).trim();
    return `- **${h.title}** — \`${citationLabel(h.origin)}\`\n\n  ${preview.replace(/\n+/g, ' ')}`;
  });
  return `## Project: ${id}\n\n${blocks.join('\n\n')}`;
}

function renderCitationTable(mapped) {
  const rows = [];
  for (const { root, hits } of mapped) {
    for (const h of hits) {
      rows.push(`| ${root.origin.targetId} | ${h.origin?.relPath || '(unknown)'} | ${h.title} |`);
    }
  }
  if (!rows.length) return '## Citations\n\n_No sources matched._';
  return `## Citations\n\n| Project | Path | Title |\n|---|---|---|\n${rows.join('\n')}`;
}

// Template shapes the convergence section only (AC2): when one resolves, its
// section headings scaffold the reduce; otherwise a default convergence shape.
function convergenceHeadings(template, rootDir) {
  if (!template) return ['Convergence', 'Divergence', 'Recommendation'];
  const resolved = getTemplate({ name: template }, { ROOT_DIR: rootDir });
  if (resolved?.error || !resolved?.content) return ['Convergence', 'Divergence', 'Recommendation'];
  const headings = [...resolved.content.matchAll(/^##\s+(.+)$/gm)].map((m) => m[1].trim());
  return headings.length ? headings : ['Convergence', 'Divergence', 'Recommendation'];
}

function buildReducePrompt({ ask, sections, headings }) {
  const headingBlock = headings.map((h) => `## ${h}`).join('\n');
  return `You are synthesizing across multiple projects. Answer the question using ONLY the per-project context below. Every cross-project claim MUST cite its source as \`project:path\` (the labels shown). If a project lacks relevant content, say so — do not invent.

Question: ${ask}

${sections}

Produce a synthesis with these sections (keep the per-project attribution above intact):
${headingBlock}`;
}

/**
 * Assemble the multi-project context and, unless dryRun, synthesize an answer.
 *
 * @param {object} opts
 * @param {string} opts.projects   CSV / array project filter (all | self | ids)
 * @param {string} opts.ask        the synthesis question
 * @param {string} [opts.cwd]
 * @param {object} [opts.env]
 * @param {string} [opts.template] optional template name shaping the reduce
 * @param {boolean} [opts.dryRun]  stop after MAP, return assembled context only
 * @param {number} [opts.topK]     per-project retrieval depth
 * @param {string} [opts.rootDir]  construct repo root (for template resolution)
 * @returns {Promise<{ok, ask, projects, context, citations, prompt, answer, sources}>}
 */
export async function synthesize({ projects, ask, cwd = process.cwd(), env = process.env, template = null, dryRun = false, topK = PER_PROJECT_TOPK, rootDir } = {}) {
  if (!ask || typeof ask !== 'string' || !ask.trim()) {
    return { ok: false, message: 'a synthesis question (--ask) is required' };
  }

  const { config } = loadProjectConfig(cwd, env);
  const targets = resolveEffectiveSourceTargetsFromConfig(config, env);
  const allRoots = resolveContentRoots(targets, { projectRoot: cwd });

  let selectedIds;
  try {
    const filter = expandProjectsFilter(projects ?? 'all', targets);
    selectedIds = filter.ids;
  } catch (err) {
    return { ok: false, message: err.message };
  }

  const roots = allRoots
    .filter((r) => selectedIds.has(r.origin.targetId))
    .sort((a, b) => a.origin.targetId.localeCompare(b.origin.targetId));

  if (!roots.length) {
    return { ok: false, message: `no content-capable projects resolved for "${projects ?? 'all'}" — register a directory or synced corpus target first` };
  }

  const mapped = [];
  for (const root of roots) {
    mapped.push(await mapProject(root, ask, { cwd, topK }));
  }

  const sections = mapped.map(renderProjectSection).join('\n\n');
  const citations = renderCitationTable(mapped);
  const headings = convergenceHeadings(template, rootDir || cwd);
  const prompt = buildReducePrompt({ ask, sections: `${sections}\n\n${citations}`, headings });

  const context = `# Cross-project synthesis: ${ask}\n\n${sections}\n\n${citations}`;
  const sourceList = mapped.flatMap(({ root, hits }) =>
    hits.map((h) => ({ project: root.origin.targetId, path: h.origin?.relPath || null, title: h.title })));

  if (dryRun) {
    return { ok: true, ask, projects: roots.map((r) => r.origin.targetId), context, citations, prompt, answer: null, sources: sourceList };
  }

  const result = spawnSync('claude', ['--print', prompt], { encoding: 'utf8', timeout: 120_000, env: { ...env } });
  if (result.error || result.status !== 0) {
    return { ok: true, ask, projects: roots.map((r) => r.origin.targetId), context, citations, prompt, answer: `[claude CLI unavailable — showing assembled context]\n\n${context}`, sources: sourceList, cliMissing: true };
  }
  return { ok: true, ask, projects: roots.map((r) => r.origin.targetId), context, citations, prompt, answer: (result.stdout || '').trim(), sources: sourceList };
}
