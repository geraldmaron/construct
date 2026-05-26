/**
 * lib/hooks/proactive-activation.mjs — Event-driven specialist activation.
 *
 * Instead of waiting for user input, specialists can activate proactively
 * based on:
 * - File changes (security on auth code, docs-keeper on README changes)
 * - CI failures (debugger on test fails, qa on coverage drops)
 * - Schedule (docs-keeper on stale READMEs, sre on SLO reviews)
 * - Intake signals (automatic classification → assignment)
 *
 * Each specialist defines triggers in agents/role-manifests.json:
 *   {
 *     "events": ["test.fail", "secrets.detected"],
 *     "severityImmediate": ["secrets.detected"],
 *     "fence": { ... },
 *     ...
 *   }
 *
 * The gateway routes events to owning specialists with rate limiting.
 *
 * @p95ms 5
 * @maxBlockingScope none
 */

import { EVENT_OWNERSHIP } from '../orchestration-policy.mjs';
import { loadProjectConfig } from '../config/project-config.mjs';

// Rate limiting: max activations per specialist per hour
const DEFAULT_RATE_LIMIT = 5;
const RATE_WINDOW_MS = 60 * 60 * 1000; // 1 hour

// Cooldown: minimum time between activations for same specialist
const DEFAULT_COOLDOWN_MS = 5 * 60 * 1000; // 5 minutes

// Activation state tracking
const activationState = new Map();

function getActivationState(specialist) {
  if (!activationState.has(specialist)) {
    activationState.set(specialist, {
      activations: [],
      lastActivation: null,
      totalActivations: 0,
    });
  }
  return activationState.get(specialist);
}

function pruneOldActivations(state, windowMs) {
  const now = Date.now();
  state.activations = state.activations.filter(ts => now - ts < windowMs);
}

/**
 * Check if a specialist can be activated (rate limit + cooldown).
 */
export function canActivate(specialist, options = {}) {
  const {
    rateLimit = DEFAULT_RATE_LIMIT,
    cooldownMs = DEFAULT_COOLDOWN_MS,
    windowMs = RATE_WINDOW_MS,
  } = options;
  
  const state = getActivationState(specialist);
  const now = Date.now();
  
  // Check cooldown
  if (state.lastActivation && now - state.lastActivation < cooldownMs) {
    return {
      allowed: false,
      reason: 'cooldown',
      retryAfter: cooldownMs - (now - state.lastActivation),
    };
  }
  
  // Check rate limit
  pruneOldActivations(state, windowMs);
  if (state.activations.length >= rateLimit) {
    return {
      allowed: false,
      reason: 'rate-limit',
      retryAfter: windowMs - (now - state.activations[0]),
    };
  }
  
  return { allowed: true };
}

/**
 * Record an activation for rate limiting.
 */
export function recordActivation(specialist) {
  const state = getActivationState(specialist);
  state.activations.push(Date.now());
  state.lastActivation = Date.now();
  state.totalActivations++;
}

/**
 * Get activation stats for a specialist.
 */
export function getActivationStats(specialist) {
  const state = getActivationState(specialist);
  pruneOldActivations(state, RATE_WINDOW_MS);
  
  return {
    recentActivations: state.activations.length,
    lastActivation: state.lastActivation,
    totalActivations: state.totalActivations,
    rateLimit: DEFAULT_RATE_LIMIT,
    rateWindowMs: RATE_WINDOW_MS,
  };
}

/**
 * Route an event to the owning specialist.
 */
export function routeEvent(eventType, eventData = {}) {
  const owner = EVENT_OWNERSHIP[eventType];
  
  if (!owner) {
    return {
      routed: false,
      reason: 'no-owner',
      eventType,
      message: `No specialist owns event type: ${eventType}`,
    };
  }
  
  // Check if specialist can activate
  const canActivateResult = canActivate(owner);
  
  if (!canActivateResult.allowed) {
    return {
      routed: false,
      reason: canActivateResult.reason,
      eventType,
      owner,
      retryAfter: canActivateResult.retryAfter,
      queued: true,
    };
  }
  
  // Record activation
  recordActivation(owner);
  
  return {
    routed: true,
    owner,
    eventType,
    eventData,
    activationNumber: getActivationState(owner).totalActivations,
  };
}

/**
 * File change watcher callback.
 * Triggers specialists based on file paths and content patterns.
 */
export function onFileChange(filePath, changeType, content = '') {
  const events = [];
  
  // Security: auth-related files
  if (filePath.includes('auth') || filePath.includes('security') || filePath.includes('permission')) {
    events.push({ type: 'file.change.auth', data: { filePath, changeType } });
  }
  
  // Docs-keeper: README, docs changes
  if (filePath.includes('README') || filePath.startsWith('docs/')) {
    events.push({ type: 'file.change.docs', data: { filePath, changeType } });
  }
  
  // SRE: infra, config, deployment files
  if (filePath.includes('infra') || filePath.includes('deploy') || filePath.endsWith('.yaml') || filePath.endsWith('.yml')) {
    events.push({ type: 'file.change.infra', data: { filePath, changeType } });
  }
  
  // Debugger: test files
  if (filePath.includes('.test.') || filePath.includes('.spec.') || filePath.startsWith('tests/')) {
    events.push({ type: 'file.change.tests', data: { filePath, changeType } });
  }
  
  return events;
}

/**
 * CI failure watcher callback.
 * Triggers specialists based on failure type.
 */
export function onCIFailure(failureType, details = {}) {
  const events = [];
  
  if (failureType === 'test.fail') {
    events.push({ type: 'test.fail', data: details });
  }
  
  if (failureType === 'test.flake') {
    events.push({ type: 'test.flake', data: details });
  }
  
  if (failureType === 'coverage.drop') {
    events.push({ type: 'coverage.drop', data: details });
  }
  
  if (failureType === 'build.fail') {
    events.push({ type: 'build.fail', data: details });
  }
  
  if (failureType === 'lint.fail') {
    events.push({ type: 'lint.fail', data: details });
  }
  
  return events;
}

/**
 * Scheduled activation check.
 * Runs periodically to trigger time-based activations.
 */
export function onScheduleCheck() {
  const events = [];
  const now = new Date();
  
  // Monday 9am: SRE SLO review
  if (now.getDay() === 1 && now.getHours() === 9) {
    events.push({ type: 'schedule.slo-review', data: { day: 'monday' } });
  }
  
  // Daily 6pm: Docs-keeper stale doc check
  if (now.getHours() === 18) {
    events.push({ type: 'schedule.stale-docs', data: { time: 'daily' } });
  }
  
  // First of month: Security CVE review
  if (now.getDate() === 1) {
    events.push({ type: 'schedule.cve-review', data: { frequency: 'monthly' } });
  }
  
  return events;
}

/**
 * Clear activation state (for testing or manual reset).
 */
export function clearActivationState(specialist) {
  if (specialist) {
    activationState.delete(specialist);
  } else {
    activationState.clear();
  }
}

/**
 * Get activation summary for dashboard.
 */
export function getActivationSummary() {
  const summary = {};
  
  for (const [specialist, state] of activationState.entries()) {
    pruneOldActivations(state, RATE_WINDOW_MS);
    summary[specialist] = {
      recentActivations: state.activations.length,
      totalActivations: state.totalActivations,
      lastActivation: state.lastActivation,
      rateLimitRemaining: DEFAULT_RATE_LIMIT - state.activations.length,
    };
  }
  
  return summary;
}
