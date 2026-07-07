/**
 * lib/intake/feedback.mjs — Classification feedback system.
 *
 * Allows users to flag incorrect intake classifications. Feedback adjusts
 * keyword weights, tracks accuracy per intake type, and surfaces patterns.
 *
 * Storage:
 *   .cx/intake/feedback.jsonl — Append-only log of all feedback
 *   .cx/intake/accuracy.json — Aggregated accuracy metrics by type
 *
 * Usage:
 *   const feedback = createClassificationFeedback({ intakeId, original, corrected, reason });
 *   await recordFeedback(rootDir, feedback);
 *   const stats = getAccuracyStats(rootDir);
 */

import fs from 'node:fs';
import path from 'node:path';
import { withFileLockSync } from '../storage/file-lock.mjs';
import { CONFIG_DIR_NAME } from '../config-dir.mjs';

const FEEDBACK_FILE = 'feedback.jsonl';
const ACCURACY_FILE = 'accuracy.json';
const FEEDBACK_DIR = `${CONFIG_DIR_NAME}/intake`;

const VALID_CORRECTION_TYPES = [
  'intakeType',
  'rdStage',
  'primaryOwner',
  'recommendedChain',
  'recommendedAction',
  'risk',
];

const VALID_REASONS = [
  'wrong-category',
  'wrong-stage',
  'wrong-owner',
  'wrong-chain',
  'wrong-action',
  'wrong-risk',
  'multiple-errors',
  'other',
];

export function createClassificationFeedback({
  intakeId,
  original,
  corrected,
  reason,
  userId = null,
  sessionId = null,
}) {
  if (!intakeId) throw new Error('intakeId is required');
  if (!original || typeof original !== 'object') throw new Error('original classification is required');
  if (!corrected || typeof corrected !== 'object') throw new Error('corrected classification is required');

  const feedback = {
    id: `fb-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    intakeId,
    timestamp: new Date().toISOString(),
    original,
    corrected,
    reason: VALID_REASONS.includes(reason) ? reason : 'other',
    userId,
    sessionId,
    applied: false,
  };

  // Validate that corrections are meaningful
  const changes = compareClassifications(original, corrected);
  if (changes.length === 0) {
    feedback.rejected = true;
    feedback.rejectionReason = 'No meaningful changes detected';
  }

  return feedback;
}

export function compareClassifications(original, corrected) {
  const changes = [];
  
  if (original.intakeType !== corrected.intakeType) {
    changes.push({ field: 'intakeType', from: original.intakeType, to: corrected.intakeType });
  }
  if (original.rdStage !== corrected.rdStage) {
    changes.push({ field: 'rdStage', from: original.rdStage, to: corrected.rdStage });
  }
  if (original.primaryOwner !== corrected.primaryOwner) {
    changes.push({ field: 'primaryOwner', from: original.primaryOwner, to: corrected.primaryOwner });
  }
  if (JSON.stringify(original.recommendedChain) !== JSON.stringify(corrected.recommendedChain)) {
    changes.push({ field: 'recommendedChain', from: original.recommendedChain, to: corrected.recommendedChain });
  }
  if (original.recommendedAction !== corrected.recommendedAction) {
    changes.push({ field: 'recommendedAction', from: original.recommendedAction, to: corrected.recommendedAction });
  }
  if (original.risk !== corrected.risk) {
    changes.push({ field: 'risk', from: original.risk, to: corrected.risk });
  }
  
  return changes;
}

export function recordFeedback(rootDir, feedback) {
  const feedbackPath = path.join(rootDir, FEEDBACK_DIR, FEEDBACK_FILE);
  
  // Ensure directory exists
  fs.mkdirSync(path.dirname(feedbackPath), { recursive: true });
  
  // Append to JSONL file
  const line = JSON.stringify(feedback) + '\n';
  fs.appendFileSync(feedbackPath, line);
  
  // Update accuracy metrics
  updateAccuracyMetrics(rootDir, feedback);
  
  return feedback;
}

export function updateAccuracyMetrics(rootDir, feedback) {
  if (feedback.rejected) return;
  
  const accuracyPath = path.join(rootDir, FEEDBACK_DIR, ACCURACY_FILE);
  
  withFileLockSync(accuracyPath, () => {
    let metrics = { lastUpdated: new Date().toISOString(), byType: {}, byOwner: {}, total: 0, corrected: 0 };
    
    if (fs.existsSync(accuracyPath)) {
      try {
        metrics = JSON.parse(fs.readFileSync(accuracyPath, 'utf8'));
      } catch {
        // Start fresh if corrupted
      }
    }
    
    // Update totals
    metrics.total++;
    if (!feedback.rejected) metrics.corrected++;
    
    // Update by intake type
    const originalType = feedback.original.intakeType || 'unknown';
    if (!metrics.byType[originalType]) {
      metrics.byType[originalType] = { total: 0, corrected: 0 };
    }
    metrics.byType[originalType].total++;
    if (!feedback.rejected) metrics.byType[originalType].corrected++;
    
    // Update by owner
    const originalOwner = feedback.original.primaryOwner || 'unknown';
    if (!metrics.byOwner[originalOwner]) {
      metrics.byOwner[originalOwner] = { total: 0, corrected: 0 };
    }
    metrics.byOwner[originalOwner].total++;
    if (!feedback.rejected) metrics.byOwner[originalOwner].corrected++;
    
    metrics.lastUpdated = new Date().toISOString();
    
    fs.writeFileSync(accuracyPath, JSON.stringify(metrics, null, 2) + '\n');
  });
}

export function getAccuracyStats(rootDir) {
  const accuracyPath = path.join(rootDir, FEEDBACK_DIR, ACCURACY_FILE);
  
  if (!fs.existsSync(accuracyPath)) {
    return {
      overall: { total: 0, corrected: 0, accuracy: 1.0 },
      byType: {},
      byOwner: {},
      message: 'No feedback recorded yet',
    };
  }
  
  try {
    const metrics = JSON.parse(fs.readFileSync(accuracyPath, 'utf8'));
    
    const overall = {
      total: metrics.total || 0,
      corrected: metrics.corrected || 0,
      accuracy: metrics.total > 0 ? 1 - (metrics.corrected / metrics.total) : 1.0,
    };
    
    const byType = {};
    for (const [type, data] of Object.entries(metrics.byType || {})) {
      byType[type] = {
        total: data.total,
        corrected: data.corrected,
        accuracy: data.total > 0 ? 1 - (data.corrected / data.total) : 1.0,
      };
    }
    
    const byOwner = {};
    for (const [owner, data] of Object.entries(metrics.byOwner || {})) {
      byOwner[owner] = {
        total: data.total,
        corrected: data.corrected,
        accuracy: data.total > 0 ? 1 - (data.corrected / data.total) : 1.0,
      };
    }
    
    return { overall, byType, byOwner };
  } catch (err) {
    return {
      overall: { total: 0, corrected: 0, accuracy: 1.0 },
      byType: {},
      byOwner: {},
      error: err.message,
    };
  }
}

export function getFeedbackHistory(rootDir, options = {}) {
  const { limit = 50, intakeId = null, offset = 0 } = options;
  const feedbackPath = path.join(rootDir, FEEDBACK_DIR, FEEDBACK_FILE);
  
  if (!fs.existsSync(feedbackPath)) {
    return [];
  }
  
  const lines = fs.readFileSync(feedbackPath, 'utf8').trim().split('\n').filter(Boolean);
  const feedback = [];
  
  for (let i = lines.length - 1; i >= 0 && feedback.length < limit + offset; i--) {
    try {
      const entry = JSON.parse(lines[i]);
      
      if (intakeId && entry.intakeId !== intakeId) continue;
      
      if (feedback.length >= offset) {
        feedback.push(entry);
      }
    } catch {
      // Skip malformed lines
    }
  }
  
  return feedback;
}

/**
 * Get keyword adjustment suggestions based on feedback patterns.
 * Analyzes which keywords led to misclassifications and suggests weight adjustments.
 */
export function getKeywordAdjustments(rootDir) {
  const feedback = getFeedbackHistory(rootDir, { limit: 200 });
  const adjustments = [];
  
  // Group by original vs corrected intake type
  const patterns = {};
  for (const fb of feedback) {
    if (fb.rejected) continue;
    
    const key = `${fb.original.intakeType}->${fb.corrected.intakeType}`;
    if (!patterns[key]) patterns[key] = [];
    patterns[key].push(fb);
  }
  
  // Find patterns where certain intake types are frequently confused
  for (const [pattern, cases] of Object.entries(patterns)) {
    if (cases.length >= 3) {
      const [from, to] = pattern.split('->');
      adjustments.push({
        pattern,
        fromType: from,
        toType: to,
        frequency: cases.length,
        suggestion: `Review keywords for ${from} — frequently confused with ${to}`,
      });
    }
  }
  
  return adjustments.sort((a, b) => b.frequency - a.frequency);
}
