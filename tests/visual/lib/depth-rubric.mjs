/**
 * tests/visual/lib/depth-rubric.mjs — output-depth scoring for role/skill tuning.
 *
 * Scores chat transcripts and terminal output against per-role depth contracts.
 * The visual live harness nitpicks whether specialists and skills
 * produce sufficiently deep, role-appropriate answers — not just surface UX.
 */

const SENTENCE_END = /[.!?](\s|$)/g;

export function stripAnsi(text) {
  return String(text ?? '').replace(/\x1b\[[0-9;]*[A-Za-z]/g, '').replace(/\x1b\]8;;[^\x07]*\x07/g, '');
}

export function countWords(text) {
  return stripAnsi(text).split(/\s+/).filter(Boolean).length;
}

export function countHeadings(text) {
  const plain = stripAnsi(text);
  return (plain.match(/^#{1,6}\s+/gm) || []).length
    + (plain.match(/^\s{0,3}[A-Z][A-Za-z0-9 /&-]{2,40}:?\s*$/gm) || []).filter((l) => !l.includes('http')).length;
}

export function countProseParagraphs(text) {
  const plain = stripAnsi(text);
  const blocks = plain.split(/\n\s*\n/).map((b) => b.trim()).filter(Boolean);
  let prose = 0;
  for (const b of blocks) {
    const lines = b.split('\n');
    const bodyLines = lines.filter((line) => !/^#{1,6}\s/.test(line.trimStart()));
    const body = bodyLines.join('\n').trim();
    if (!body) continue;
    const first = bodyLines[0]?.trimStart() || '';
    if (/^([-*+]\s|\d+[.)]\s|>\s|\|)/.test(first)) continue;
    if (first.startsWith('```')) continue;
    const sentences = (body.match(SENTENCE_END) || []).length;
    if (sentences >= 2 || body.length >= 180) prose++;
  }
  return prose;
}

export function countRepoPaths(text) {
  const plain = stripAnsi(text);
  const hits = new Set();
  const re = /(?:^|[\s(,])(`?)(?:(?:\.cx\/|docs\/|lib\/|skills\/|specialists\/|tests\/|rules\/)[\w./-]+\.(?:md|mdx|json|mjs)|construct\.config\.json)(`?)/g;
  for (const m of plain.matchAll(re)) hits.add(m[0].trim());
  return hits.size;
}

export function countCitations(text) {
  const plain = stripAnsi(text);
  const hits = new Set();
  for (const re of [
    /\bhttps?:\/\/[^\s)]+/g,
    /\[source:[^\]]+\]/gi,
    /\(accessed\s+\d{4}-\d{2}-\d{2}\)/gi,
    /\[unverified\]/gi,
  ]) {
    for (const m of plain.matchAll(re)) hits.add(m[0].toLowerCase());
  }
  return hits.size;
}

export function countCodeFences(text) {
  return (stripAnsi(text).match(/```[\s\S]*?```/g) || []).length;
}

export function countNumberedSteps(text) {
  return (stripAnsi(text).match(/^\d+\.\s+/gm) || []).length;
}

export function countBullets(text) {
  return (stripAnsi(text).match(/^[-*+]\s+/gm) || []).length;
}

export function hasPattern(text, re) {
  return re.test(stripAnsi(text));
}

export function countSkillSignals(text, skills = []) {
  const plain = stripAnsi(text).toLowerCase();
  let n = 0;
  for (const skill of skills) {
    const slug = skill.replace(/^docs\//, '').replace(/-workflow$/, '').replace(/\//g, ' ');
    if (plain.includes(skill.toLowerCase()) || plain.includes(slug)) n++;
  }
  if (/construct artifact validate/i.test(plain)) n++;
  if (/verification bar|acceptance criteria|success metric/i.test(plain)) n++;
  return n;
}

export function countSpecialistMentions(text, specialists = []) {
  const plain = stripAnsi(text).toLowerCase();
  let n = 0;
  for (const id of specialists) {
    if (plain.includes(id.toLowerCase())) n++;
  }
  return n;
}

export function measureDepth(text, rubric = {}) {
  const metrics = {
    words: countWords(text),
    headings: countHeadings(text),
    proseParagraphs: countProseParagraphs(text),
    bullets: countBullets(text),
    numberedSteps: countNumberedSteps(text),
    repoPaths: countRepoPaths(text),
    citations: countCitations(text),
    codeFences: countCodeFences(text),
    skillSignals: countSkillSignals(text, rubric.expectedSkills || []),
    specialistMentions: countSpecialistMentions(text, rubric.expectedSpecialists || []),
    hasMetrics: hasPattern(text, /\b(metric|baseline|target|KPI|success criteria|acceptance criteria)\b/i),
    hasRisks: hasPattern(text, /\b(risk|mitigation|rollback|blast radius|failure mode)\b/i),
    hasTradeoffs: hasPattern(text, /\b(trade-?off|alternative|option A|pros and cons|versus|vs\.)\b/i),
    hasTestCases: hasPattern(text, /\b(test case|edge case|regression|verify|assert)\b/i),
    hasA11y: hasPattern(text, /\b(WCAG|accessib|screen reader|keyboard|contrast|ARIA)\b/i),
    hasThreat: hasPattern(text, /\b(threat|STRIDE|attack surface|CVE|OWASP|vulnerabilit)\b/i),
    hasRunbook: hasPattern(text, /\b(runbook|on-?call|incident|SLO|alert|rollback|deploy)\b/i),
    hasMermaid: /```mermaid|flowchart|sequenceDiagram/i.test(stripAnsi(text)),
    hasOsc8Links: /\x1b\]8;;/.test(String(text)),
  };

  const failures = [];
  const warnings = [];

  const checkMin = (key, label, min) => {
    if (min == null) return;
    if (metrics[key] < min) failures.push(`${label}: got ${metrics[key]}, need ≥${min}`);
  };

  checkMin('words', 'word count', rubric.minWords);
  checkMin('headings', 'section headings', rubric.minHeadings);
  checkMin('proseParagraphs', 'prose paragraphs', rubric.minProseParagraphs);
  checkMin('bullets', 'bullet points', rubric.minBullets);
  checkMin('numberedSteps', 'numbered steps', rubric.minNumberedSteps);
  checkMin('repoPaths', 'repo path references', rubric.minRepoPaths);
  checkMin('citations', 'citations or [unverified] discipline', rubric.minCitations);
  checkMin('codeFences', 'code examples', rubric.minCodeFences);
  checkMin('skillSignals', 'skill/workflow signals', rubric.minSkillSignals);
  checkMin('specialistMentions', 'specialist routing visibility', rubric.minSpecialistMentions);

  const boolChecks = [
    ['requiresMetrics', 'hasMetrics', 'measurable success criteria'],
    ['requiresRisks', 'hasRisks', 'explicit risks or mitigations'],
    ['requiresTradeoffs', 'hasTradeoffs', 'trade-off or alternatives analysis'],
    ['requiresTestCases', 'hasTestCases', 'test or verification cases'],
    ['requiresA11y', 'hasA11y', 'accessibility criteria'],
    ['requiresThreat', 'hasThreat', 'threat or security framing'],
    ['requiresRunbook', 'hasRunbook', 'operational/runbook framing'],
    ['requiresMermaid', 'hasMermaid', 'diagram (mermaid or flowchart)'],
    ['requiresOsc8Links', 'hasOsc8Links', 'clickable OSC-8 terminal links'],
  ];

  for (const [rubricKey, metricKey, label] of boolChecks) {
    if (!rubric[rubricKey]) continue;
    if (!metrics[metricKey]) failures.push(`missing ${label}`);
  }

  if (rubric.warnShallow && metrics.words > 0 && metrics.words < (rubric.minWords || 120) * 0.6) {
    warnings.push(`answer feels shallow (${metrics.words} words) — specialist/skill depth may need tuning`);
  }
  if (rubric.warnBulletOnly && metrics.proseParagraphs === 0 && metrics.bullets >= 5) {
    warnings.push('bullet-only outline — role expects explanatory prose between lists');
  }
  if (rubric.warnUnsourced && metrics.citations === 0 && rubric.minCitations > 0) {
    warnings.push('no citations or [unverified] markers on load-bearing claims');
  }

  for (const re of rubric.mustMatch || []) {
    if (!hasPattern(text, re)) failures.push(`missing required pattern: ${re}`);
  }
  for (const re of rubric.mustNotMatch || []) {
    if (hasPattern(text, re)) failures.push(`forbidden pattern matched: ${re}`);
  }

  const score = Math.max(0, 100 - failures.length * 12 - warnings.length * 4);

  return {
    ok: failures.length === 0,
    score,
    metrics,
    failures,
    warnings,
    depthGrade: failures.length === 0
      ? (warnings.length === 0 ? 'deep' : 'adequate')
      : 'shallow',
  };
}

export function formatDepthReport(result, { roleLabel } = {}) {
  const lines = [];
  if (roleLabel) lines.push(`## Depth audit — ${roleLabel}`);
  lines.push(`Grade: ${result.depthGrade} (score ${result.score})`);
  if (result.failures.length) {
    lines.push('### Failures');
    for (const f of result.failures) lines.push(`- ${f}`);
  }
  if (result.warnings.length) {
    lines.push('### Warnings (tuning signals)');
    for (const w of result.warnings) lines.push(`- ${w}`);
  }
  lines.push('### Metrics');
  for (const [k, v] of Object.entries(result.metrics)) lines.push(`- ${k}: ${v}`);
  return lines.join('\n');
}
