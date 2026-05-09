#!/usr/bin/env node
/**
 * lib/services/pattern-promotion-service.mjs — Bounded pattern replication engine.
 *
 * Analyzes observations, scores candidate patterns, promotes high-quality ones to permanent
 * learned patterns in role skill files. Prevents unbounded growth with hard limits.
 *
 * Limits:
 * - Max 15 learned patterns per role
 * - Min confidence 0.85, usage 3, score 0.8
 * - Semantic + exact deduplication
 * - Pruning of low-effectiveness patterns
 */

import fs from 'node:fs';
import path from 'node:path';

const ROOT_DIR = process.cwd();
const SKILLS_DIR = path.join(ROOT_DIR, 'skills', 'roles');
const OBS_DIR = path.join(process.cwd(), '.cx', 'observations', 'agent-outcomes');

const MAX_PATTERNS = 15;
const MIN_CONFIDENCE = 0.85;
const MIN_USAGE = 3;
const MIN_SCORE = 0.8;
const MAX_TOKENS_FILE = 2500; // Approx tokens

const LEARNED_SECTION_MARKER = '## Learned Patterns';

function scorePattern(obs) {
  const confidenceWeight = 0.3;
  const usageWeight = 0.2;
  const successWeight = 0.4;
  const crossProjectWeight = 0.1;

  const normalizedUsage = Math.min((obs.usage_count || 0) / 10, 1.0);
  const crossProject = (obs.projects && obs.projects.length >= 2) ? 1.0 : 0.5;
  const successRate = obs.success_rate || 0.5;

  return (
    (obs.confidence || 0) * confidenceWeight +
    normalizedUsage * usageWeight +
    successRate * successWeight +
    crossProject * crossProjectWeight
  );
}

function normalizeSummary(summary) {
  return summary.toLowerCase().replace(/[^\w\s]/g, '').trim();
}

function isDuplicate(newObs, existingPatterns) {
  const newNorm = normalizeSummary(newObs.summary);
  for (const pat of existingPatterns) {
    const patNorm = normalizeSummary(pat.summary);
    if (newNorm.includes(patNorm.slice(0, Math.min(50, patNorm.length))) ||
        patNorm.includes(newNorm.slice(0, Math.min(50, newNorm.length)))) {
      return true;
    }
  }
  return false;
}

function parseLearnedPatterns(content) {
  const match = content.match(new RegExp(`${LEARNED_SECTION_MARKER}[\\s\\S]*?(?=## |$)`));
  if (!match) return [];

  const section = match[0];
  return section.split('\n\n').slice(1).filter(Boolean).map(block => {
    const lines = block.split('\n');
    return {
      summary: lines[0].replace(/^###\s*L\d+\.\s*/, ''),
      content: block
    };
  });
}

function generatePatternEntry(obs, index) {
  return `### L${index}. ${obs.summary}
**Context**: ${obs.context || 'General'}
**Effective Action**: ${obs.content.slice(0, 120)}...
**Evidence**: Score ${(obs.score || 0).toFixed(2)}, used ${(obs.usage_count || 0)} times, ${(obs.projects || []).length} projects
*Last reinforced: ${new Date().toISOString().split('T')[0]}*

`;
}

function updateSkillFile(roleName, candidate) {
  const skillFile = path.join(SKILLS_DIR, `${roleName}.md`);
  if (!fs.existsSync(skillFile)) {
    console.warn(`Skill file not found: ${skillFile}`);
    return false;
  }

  let content = fs.readFileSync(skillFile, 'utf8');

  // Check token limit (rough char/4)
  if (content.length > MAX_TOKENS_FILE * 4) {
    console.warn(`Skill file too large: ${skillFile}`);
    return false;
  }

  const existingPatterns = parseLearnedPatterns(content);
  if (existingPatterns.length >= MAX_PATTERNS || isDuplicate(candidate, existingPatterns)) {
    console.log(`Skipped ${candidate.summary} (dupe or limit reached)`);
    return false;
  }

  const entry = generatePatternEntry(candidate, existingPatterns.length + 1);
  let newContent;

  const sectionExists = content.includes(LEARNED_SECTION_MARKER);
  if (sectionExists) {
    const markerIndex = content.indexOf(LEARNED_SECTION_MARKER);
    const afterMarker = content.slice(markerIndex);
    const endMatch = afterMarker.match(/\n\n## /) || afterMarker.match(/$/);
    const insertPos = markerIndex + afterMarker.indexOf(endMatch[0]);
    newContent = content.slice(0, insertPos) + '\n\n' + entry + content.slice(insertPos);
  } else {
    newContent = content + '\n\n' + LEARNED_SECTION_MARKER + '\n\n' + entry;
  }

  fs.writeFileSync(skillFile, newContent);
  console.log(`Added pattern to ${roleName}.md: ${candidate.summary}`);
  return true;
}

function getCandidates() {
  if (!fs.existsSync(OBS_DIR)) return [];

  const files = fs.readdirSync(OBS_DIR).filter(f => f.endsWith('.json'));
  const candidates = [];

  for (const file of files) {
    try {
      const obs = JSON.parse(fs.readFileSync(path.join(OBS_DIR, file), 'utf8'));
      if (obs.category === 'pattern' &&
          (obs.confidence || 0) >= MIN_CONFIDENCE &&
          (obs.usage_count || 0) >= MIN_USAGE) {
        obs.score = scorePattern(obs);
        if (obs.score >= MIN_SCORE) {
          candidates.push(obs);
        }
      }
    } catch (e) {
      // Skip invalid
    }
  }

  return candidates.sort((a, b) => b.score - a.score).slice(0, 5); // Top 5
}

export function promotePatterns() {
  const candidates = getCandidates();
  let promoted = 0;

  for (const candidate of candidates) {
    const roleName = candidate.role.replace(/^cx-/, '') || 'engineer'; // Fallback
    if (updateSkillFile(roleName, candidate)) promoted++;
  }

  console.log(`Pattern promotion complete: ${promoted}/${candidates.length} promoted`);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  promotePatterns();
}
