/**
 * lib/diagram-quality.mjs — Diagram quality heuristics beyond syntax/render success.
 *
 * A diagram can render cleanly and still be unreadable: too many nodes to follow, labels too long
 * to fit, a flowchart decision with no branch labels (only the happy path drawn), or a sequence
 * diagram with too few participants to be worth a diagram. analyzeDiagramQuality parses mermaid and
 * d2 source and returns typed findings for each gap. It judges purpose and legibility, not syntax —
 * the render path already proves a diagram compiles. Consumed by the publish diagram preprocessor,
 * which surfaces findings as advisory warnings unless frontmatter opts into strict.
 */

export const MAX_NODES = 24;
export const MAX_LABEL_CHARS = 48;
export const MIN_SEQUENCE_PARTICIPANTS = 2;
export const MAX_UNLABELED_EDGE_RATIO = 0.6;

export const DIAGRAM_QUALITY_CODES = Object.freeze([
  'node_density_high',
  'label_too_long',
  'unlabeled_edges',
  'decision_without_branches',
  'sequence_too_few_participants',
]);

// mermaid declares its kind on the first non-directive line; d2 has no header, so anything that is
// neither a mermaid kind nor empty is treated as d2.

export function detectDiagramKind(code, lang) {
  const body = String(code || '').replace(/^%%\{[\s\S]*?\}%%/m, '');
  const first = body.split('\n').map((l) => l.trim()).find(Boolean) || '';
  if (/^sequenceDiagram\b/.test(first)) return 'sequence';
  if (/^(flowchart|graph)\b/.test(first)) return 'flowchart';
  if (lang === 'mermaid') return 'mermaid-other';
  return 'd2';
}

function stripDirectives(code) {
  return String(code || '').replace(/^%%\{[\s\S]*?\}%%/m, '').trim();
}

// Flowchart: node ids appear in `id[label]` / `id{decision}` definitions and on both sides of an
// edge. Decision nodes use {}; edge labels ride in `-->|label|` or `-- label -->`.

function analyzeFlowchart(code) {
  const findings = [];
  const lines = stripDirectives(code).split('\n').slice(1).map((l) => l.trim()).filter(Boolean);
  const nodes = new Set();
  const decisions = new Set();
  const outgoing = new Map();
  let edgeCount = 0;
  let unlabeledEdges = 0;

  const nodeDef = /([A-Za-z0-9_]+)\s*([[({])([^\])}]*)[\])}]/g;
  const edge = /([A-Za-z0-9_]+)\s*(?:[ox]?[-.=]+[->]*\|([^|]*)\||[-.=]+[->]+)\s*([A-Za-z0-9_]+)/;

  for (const line of lines) {
    let m;
    while ((m = nodeDef.exec(line))) {
      nodes.add(m[1]);
      if (m[2] === '{') decisions.add(m[1]);
      if ((m[3] || '').trim().length > MAX_LABEL_CHARS) {
        findings.push({ code: 'label_too_long', detail: `node ${m[1]} label is ${m[3].trim().length} chars (max ${MAX_LABEL_CHARS})` });
      }
    }
    const e = edge.exec(line);
    if (e) {
      nodes.add(e[1]);
      nodes.add(e[3]);
      edgeCount += 1;
      const label = (e[2] || '').trim();
      if (!label) unlabeledEdges += 1;
      else if (label.length > MAX_LABEL_CHARS) findings.push({ code: 'label_too_long', detail: `edge ${e[1]}->${e[3]} label is ${label.length} chars (max ${MAX_LABEL_CHARS})` });
      outgoing.set(e[1], (outgoing.get(e[1]) || 0) + 1);
    }
  }

  if (nodes.size > MAX_NODES) findings.push({ code: 'node_density_high', detail: `${nodes.size} nodes exceed the ${MAX_NODES}-node readability limit` });
  if (edgeCount > 0 && unlabeledEdges / edgeCount > MAX_UNLABELED_EDGE_RATIO) {
    findings.push({ code: 'unlabeled_edges', detail: `${unlabeledEdges}/${edgeCount} edges have no label` });
  }
  for (const d of decisions) {
    if ((outgoing.get(d) || 0) < 2) {
      findings.push({ code: 'decision_without_branches', detail: `decision ${d} has ${(outgoing.get(d) || 0)} outgoing branch(es); a decision needs at least the yes/no paths` });
    }
  }
  return findings;
}

// Sequence: `participant X` declarations plus actors on either side of a message arrow.

function analyzeSequence(code) {
  const findings = [];
  const lines = stripDirectives(code).split('\n').slice(1).map((l) => l.trim()).filter(Boolean);
  const participants = new Set();
  let messages = 0;
  let unlabeled = 0;

  for (const line of lines) {
    const decl = line.match(/^(?:participant|actor)\s+([A-Za-z0-9_]+)/);
    if (decl) { participants.add(decl[1]); continue; }
    const msg = line.match(/^([A-Za-z0-9_]+)\s*-[->x)]+\s*([A-Za-z0-9_]+)\s*:(.*)$/);
    if (msg) {
      participants.add(msg[1]);
      participants.add(msg[2]);
      messages += 1;
      if (!msg[3].trim()) unlabeled += 1;
      else if (msg[3].trim().length > MAX_LABEL_CHARS) findings.push({ code: 'label_too_long', detail: `message ${msg[1]}->${msg[2]} is ${msg[3].trim().length} chars (max ${MAX_LABEL_CHARS})` });
    }
  }

  if (participants.size < MIN_SEQUENCE_PARTICIPANTS) {
    findings.push({ code: 'sequence_too_few_participants', detail: `${participants.size} participant(s); a sequence needs at least ${MIN_SEQUENCE_PARTICIPANTS}` });
  }
  if (participants.size > MAX_NODES) findings.push({ code: 'node_density_high', detail: `${participants.size} participants exceed the ${MAX_NODES} limit` });
  if (messages > 0 && unlabeled / messages > MAX_UNLABELED_EDGE_RATIO) {
    findings.push({ code: 'unlabeled_edges', detail: `${unlabeled}/${messages} messages have no label` });
  }
  return findings;
}

// d2: connections `a -> b`, optional `: label`; standalone `id: label` names a node.

function analyzeD2(code) {
  const findings = [];
  const lines = stripDirectives(code).split('\n').map((l) => l.trim()).filter((l) => l && !l.startsWith('#'));
  const nodes = new Set();
  let edgeCount = 0;
  let unlabeled = 0;

  for (const line of lines) {
    const conn = line.match(/^([A-Za-z0-9_.]+)\s*(?:<->|->|<-|--)\s*([A-Za-z0-9_.]+)\s*(?::(.*))?$/);
    if (conn) {
      nodes.add(conn[1]);
      nodes.add(conn[2]);
      edgeCount += 1;
      const label = (conn[3] || '').trim();
      if (!label) unlabeled += 1;
      else if (label.length > MAX_LABEL_CHARS) findings.push({ code: 'label_too_long', detail: `edge ${conn[1]}->${conn[2]} label is ${label.length} chars (max ${MAX_LABEL_CHARS})` });
      continue;
    }
    const node = line.match(/^([A-Za-z0-9_.]+)\s*:\s*(.+)$/);
    if (node) {
      nodes.add(node[1]);
      if (node[2].trim().length > MAX_LABEL_CHARS) findings.push({ code: 'label_too_long', detail: `node ${node[1]} label is ${node[2].trim().length} chars (max ${MAX_LABEL_CHARS})` });
    }
  }

  if (nodes.size > MAX_NODES) findings.push({ code: 'node_density_high', detail: `${nodes.size} nodes exceed the ${MAX_NODES}-node readability limit` });
  if (edgeCount > 0 && unlabeled / edgeCount > MAX_UNLABELED_EDGE_RATIO) {
    findings.push({ code: 'unlabeled_edges', detail: `${unlabeled}/${edgeCount} edges have no label` });
  }
  return findings;
}

export function analyzeDiagramQuality(code, { lang } = {}) {
  const kind = detectDiagramKind(code, lang);
  let findings = [];
  if (kind === 'flowchart') findings = analyzeFlowchart(code);
  else if (kind === 'sequence') findings = analyzeSequence(code);
  else if (kind === 'd2') findings = analyzeD2(code);
  return { ok: findings.length === 0, kind, findings };
}

// Every fenced mermaid/d2 block in a document, analyzed and flattened into one advisory list so
// the publish path can surface legibility warnings. `cx_diagram_quality: strict` in frontmatter
// is honored by the caller to escalate these from warnings to gate failures.

export function lintDocumentDiagrams(markdown) {
  const src = String(markdown || '');
  const warnings = [];
  const fenceRe = /```(mermaid|d2)\n([\s\S]*?)```/g;
  let match;
  let index = 0;
  while ((match = fenceRe.exec(src))) {
    index += 1;
    const { kind, findings } = analyzeDiagramQuality(match[2], { lang: match[1] });
    for (const finding of findings) warnings.push({ diagram: index, kind, ...finding });
  }
  return { ok: warnings.length === 0, warnings };
}
