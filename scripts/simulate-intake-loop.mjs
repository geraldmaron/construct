#!/usr/bin/env node
/**
 * Simulate intake classification and knowledge ingestion
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT_DIR = path.resolve(__dirname, '..');

// Import classification modules
const { classifyRdIntake } = await import('../lib/intake/classify.mjs');
const { prepareIntakeForIngestedFile } = await import('../lib/intake/prepare.mjs');
const { buildHybridSearchResultsAsync } = await import('../lib/storage/hybrid-query.mjs');

console.log('╔═══════════════════════════════════════════════════════════╗');
console.log('║     Construct R&D Intake Loop Simulation                  ║');
console.log('╚═══════════════════════════════════════════════════════════╝\n');

// Step 1: Process inbox files
console.log('📥 STEP 1: Processing Inbox Files\n');

const inboxDir = path.join(ROOT_DIR, 'inbox');
const inboxFiles = fs.readdirSync(inboxDir).filter(f => f.endsWith('.md'));

for (const file of inboxFiles) {
  const filePath = path.join(inboxDir, file);
  const content = fs.readFileSync(filePath, 'utf8');
  
  console.log(`\n┌─────────────────────────────────────────────────────────┐`);
  console.log(`│ File: ${file}`);
  console.log(`└─────────────────────────────────────────────────────────┘`);
  
  // Run classification
  const triage = classifyRdIntake({
    sourcePath: filePath,
    extractedText: content,
    related: [],
  });
  
  console.log('\n🏷️  Classification Result:');
  console.log(`   intakeType:      ${triage.intakeType}`);
  console.log(`   rdStage:         ${triage.rdStage}`);
  console.log(`   primaryOwner:    ${triage.primaryOwner}`);
  console.log(`   recommendedChain: ${triage.recommendedChain.join(' → ')}`);
  console.log(`   recommendedAction: ${triage.recommendedAction}`);
  console.log(`   risk:            ${triage.risk}`);
  console.log(`   requiresApproval: ${triage.requiresApproval}`);
  console.log(`   confidence:      ${(triage.confidence * 100).toFixed(0)}%`);
  console.log(`   rationale:       ${triage.rationale}`);
  
  // Create intake packet
  const intakeId = `intake-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
  const intakePacket = {
    id: intakeId,
    sourceFile: file,
    ingestedAt: new Date().toISOString(),
    triage,
    excerpt: content.slice(0, 500) + '...',
    status: 'pending',
  };
  
  // Write to intake queue
  const intakePath = path.join(ROOT_DIR, '.construct/intake/pending', `${intakeId}.json`);
  fs.writeFileSync(intakePath, JSON.stringify(intakePacket, null, 2));
  console.log(`\n✅ Intake packet created: .construct/intake/pending/${intakeId}.json`);
}

// Step 2: Knowledge Retrieval
console.log('\n\n STEP 2: Cross-Document Knowledge Retrieval\n');

console.log('Simulating hybrid search for related documents...\n');

// Simulate what happens when a new intake arrives
const queryText = 'session timeout login authentication user friction';
console.log(`Query: "${queryText}"`);

// In real system this would query vector + BM25
// For simulation, we'll show what documents would be retrieved
const relatedDocs = [
  {
    path: '.construct/knowledge/internal/adr-session-management.md',
    title: 'Architecture Decision: Session Management Strategy',
    score: 0.89,
    relevance: 'Directly addresses session timeout architecture',
  },
  {
    path: 'docs/specs/prd/0003-authentication-improvements.md',
    title: 'PRD: Authentication Improvements',
    score: 0.72,
    relevance: 'Related product requirements for auth flow',
  },
  {
    path: '.construct/observations/obs-pattern-login-friction.json',
    title: 'Pattern: Login friction correlates with support volume',
    score: 0.65,
    relevance: 'Historical pattern from past incidents',
  },
];

console.log('\n📚 Related Documents Retrieved:\n');
for (const doc of relatedDocs) {
  console.log(`   ┌─────────────────────────────────────────────────────`);
  console.log(`   │ ${doc.title}`);
  console.log(`   │ Score: ${(doc.score * 100).toFixed(0)}%`);
  console.log(`   │ Relevance: ${doc.relevance}`);
  console.log(`   └─────────────────────────────────────────────────────\n`);
}

// Step 3: Specialist Dispatch
console.log('\n🎯 STEP 3: Specialist Dispatch\n');

const intakePackets = [
  {
    file: 'login-feedback-20260518.md',
    triage: {
      intakeType: 'user-signal',
      primaryOwner: 'product-manager',
      recommendedChain: ['product-manager', 'ux-researcher', 'researcher'],
    }
  },
  {
    file: 'session-timeout-bug-20260517.md',
    triage: {
      intakeType: 'bug',
      primaryOwner: 'debugger',
      recommendedChain: ['debugger', 'engineer', 'qa', 'reviewer'],
    }
  }
];

for (const packet of intakePackets) {
  console.log(`\n📋 Intake: ${packet.file}`);
  console.log(`   Owner: cx-${packet.triage.primaryOwner}`);
  console.log(`   Dispatch Chain:`);
  
  for (let i = 0; i < packet.triage.recommendedChain.length; i++) {
    const specialist = packet.triage.recommendedChain[i];
    const isParallel = i > 0 && Math.random() > 0.5;
    const parallelMarker = isParallel ? ' (parallel)' : '';
    console.log(`      ${i + 1}. cx-${specialist}${parallelMarker}`);
  }
}

// Step 4: Knowledge Storage
console.log('\n💾 STEP 4: Knowledge Storage & Learning\n');

console.log('After specialists complete their work, observations are stored:\n');

const observations = [
  {
    id: 'obs-1',
    role: 'product-manager',
    category: 'pattern',
    summary: 'Login friction increases support volume by 40% when session timeout < 20 min',
    tags: ['authentication', 'support', 'session-management'],
    confidence: 0.85,
  },
  {
    id: 'obs-2',
    role: 'engineer',
    category: 'decision',
    summary: 'Implement sliding session with 5-min warning + auto-save hook',
    tags: ['session', 'implementation', 'user-experience'],
    confidence: 0.9,
  },
  {
    id: 'obs-3',
    role: 'qa',
    category: 'anti-pattern',
    summary: 'Fixed TTL sessions without warning cause data loss',
    tags: ['testing', 'session', 'data-loss'],
    confidence: 0.95,
  },
];

for (const obs of observations) {
  console.log(`   ┌─────────────────────────────────────────────────────`);
  console.log(`   │ ${obs.id}: ${obs.category}`);
  console.log(`   │ Role: ${obs.role}`);
  console.log(`   │ ${obs.summary}`);
  console.log(`   │ Tags: ${obs.tags.join(', ')}`);
  console.log(`   │ Confidence: ${(obs.confidence * 100).toFixed(0)}%`);
  console.log(`   └─────────────────────────────────────────────────────\n`);
}

// Step 5: Learning Feedback Loop
console.log('\n🔄 STEP 5: Learning Feedback Loop\n');

console.log('Classification accuracy tracking:\n');

const accuracyStats = {
  overall: {
    total: 150,
    corrected: 12,
    accuracy: 92.0,
  },
  byType: {
    'user-signal': { total: 45, corrected: 3, accuracy: 93.3 },
    'bug': { total: 52, corrected: 4, accuracy: 92.3 },
    'architecture': { total: 23, corrected: 2, accuracy: 91.3 },
    'feature-request': { total: 30, corrected: 3, accuracy: 90.0 },
  },
};

console.log(`   Overall Accuracy: ${accuracyStats.overall.accuracy}%`);
console.log(`   Total Classified: ${accuracyStats.overall.total}`);
console.log(`   Corrections: ${accuracyStats.overall.corrected}\n`);

console.log('   By Intake Type:');
for (const [type, stats] of Object.entries(accuracyStats.byType)) {
  const bar = '█'.repeat(Math.round(stats.accuracy / 5));
  console.log(`      ${type.padEnd(20)} ${bar} ${stats.accuracy.toFixed(1)}%`);
}

// Step 6: Cross-Document Connections
console.log('\n🔗 STEP 6: Cross-Document Knowledge Graph\n');

console.log('Entity relationships discovered:\n');

const entities = [
  {
    name: 'session-management',
    type: 'component',
    connectedDocs: [
      '.construct/knowledge/internal/adr-session-management.md',
      'inbox/session-timeout-bug-20260517.md',
      'inbox/login-feedback-20260518.md',
    ],
    observations: ['obs-1', 'obs-2', 'obs-3'],
  },
  {
    name: 'authentication',
    type: 'service',
    connectedDocs: [
      'inbox/login-feedback-20260518.md',
      'docs/specs/prd/0003-authentication-improvements.md',
    ],
    observations: ['obs-1'],
  },
];

for (const entity of entities) {
  console.log(`\n   ┌─────────────────────────────────────────────────────`);
  console.log(`   │ Entity: ${entity.name}`);
  console.log(`   │ Type: ${entity.type}`);
  console.log(`   │`);
  console.log(`   │ Connected Documents (${entity.connectedDocs.length}):`);
  for (const doc of entity.connectedDocs) {
    console.log(`   │   - ${doc}`);
  }
  console.log(`   │`);
  console.log(`   │ Related Observations (${entity.observations.length}):`);
  for (const obsId of entity.observations) {
    console.log(`   │   - ${obsId}`);
  }
  console.log(`   └─────────────────────────────────────────────────────`);
}

console.log('\n\n╔═══════════════════════════════════════════════════════════╗');
console.log('║     Simulation Complete                                       ║');
console.log('╚═══════════════════════════════════════════════════════════╝\n');

console.log('Key Takeaways:');
console.log('  1. Intake classification is deterministic (keyword-based, no LLM)');
console.log('  2. Related documents retrieved via hybrid search (BM25 + vector)');
console.log('  3. Specialists dispatched based on intake type and risk');
console.log('  4. Observations stored with role, category, tags, confidence');
console.log('  5. Classification accuracy tracked and improves over time');
console.log('  6. Cross-document entities enable knowledge graph queries\n');
