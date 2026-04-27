/**
 * tests/headhunt.test.mjs — <one-line purpose>
 *
 * <2–6 line summary: what it does, who calls it, key side effects.>
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { runHeadhunt, getActiveOverlays, promoteHeadhunt, cleanupHeadhunt, updatePromotionChallenge } from '../lib/headhunt.mjs';

function tempDir(prefix) {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

test('headhunt creates a temporary domain overlay by default', async () => {
  const cwd = tempDir('construct-headhunt-');
  fs.mkdirSync(path.join(cwd, '.cx'), { recursive: true });

  const result = await runHeadhunt({
    args: ['terraform', '--for=design our infra repo strategy', '--scope=aws platform', '--temp'],
    cwd,
    homeDir: tempDir('construct-headhunt-home-'),
  });

  assert.equal(result.overlay.domain, 'terraform');
  assert.equal(result.overlay.permanence, 'temporary');
  assert.equal(fs.existsSync(result.overlayJsonPath), true);
  const overlay = JSON.parse(fs.readFileSync(result.overlayJsonPath, 'utf8'));
  assert.equal(overlay.scope, 'aws platform');
  assert.ok(Array.isArray(overlay.attachTo));
  assert.equal(result.promotionPath, null);
});

test('headhunt save mode creates a promotion request', async () => {
  const cwd = tempDir('construct-headhunt-save-');
  fs.mkdirSync(path.join(cwd, '.cx'), { recursive: true });

  const result = await runHeadhunt({
    args: ['terraform', '--for=own reusable terraform architecture guidance', '--save'],
    cwd,
    homeDir: tempDir('construct-headhunt-home-'),
  });

  assert.equal(result.overlay.permanence, 'permanent_request');
  assert.ok(result.promotionPath);
  const request = JSON.parse(fs.readFileSync(result.promotionPath, 'utf8'));
  assert.equal(request.status, 'pending_review');
  assert.equal(request.domain, 'terraform');
  assert.equal(request.challenge.required, true);
  assert.equal(request.challenge.owner, 'cx-devil-advocate');
});

test('headhunt overlays are visible through active overlay helper and can be promoted', async () => {
  const cwd = tempDir('construct-headhunt-promote-');
  fs.mkdirSync(path.join(cwd, '.cx'), { recursive: true });

  const created = await runHeadhunt({
    args: ['terraform', '--for=design account structure', '--temp'],
    cwd,
    homeDir: tempDir('construct-headhunt-home-'),
  });

  const overlays = getActiveOverlays(cwd);
  assert.equal(overlays.length, 1);
  assert.equal(overlays[0].id, created.overlay.id);

  const promoted = promoteHeadhunt(created.overlay.id, { cwd, owner: 'platform-team' });
  assert.equal(promoted.owner, 'platform-team');
  assert.equal(promoted.status, 'pending_review');
  assert.equal(promoted.challenge.owner, 'cx-devil-advocate');
});

test('headhunt cleanup removes expired overlays', async () => {
  const cwd = tempDir('construct-headhunt-cleanup-');
  const overlayDir = path.join(cwd, '.cx', 'domain-overlays');
  fs.mkdirSync(overlayDir, { recursive: true });
  const expiredId = 'terraform-expired';
  fs.writeFileSync(path.join(overlayDir, `${expiredId}.json`), `${JSON.stringify({
    id: expiredId,
    type: 'domain-overlay',
    domain: 'terraform',
    objective: 'expired',
    attachTo: ['cx-architect'],
    focus: 'architecture',
    permanence: 'temporary',
    status: 'active',
    expiresAt: '2000-01-01T00:00:00.000Z',
  }, null, 2)}\n`);
  fs.writeFileSync(path.join(overlayDir, `${expiredId}.md`), '# expired\n');

  const removed = cleanupHeadhunt({ cwd, now: new Date('2026-01-01T00:00:00.000Z') });
  assert.equal(removed, 1);
  assert.equal(fs.existsSync(path.join(overlayDir, `${expiredId}.json`)), false);
});

test('headhunt challenge updates promotion request state', async () => {
  const cwd = tempDir('construct-headhunt-challenge-');
  fs.mkdirSync(path.join(cwd, '.cx'), { recursive: true });

  const created = await runHeadhunt({
    args: ['terraform', '--for=own reusable terraform guidance', '--save'],
    cwd,
    homeDir: tempDir('construct-headhunt-home-'),
  });

  const updated = updatePromotionChallenge(created.overlay.id, {
    cwd,
    status: 'approved',
    note: 'Challenge passed after adversarial review.',
  });

  assert.equal(updated.challenge.status, 'approved');
  assert.equal(updated.challenge.note, 'Challenge passed after adversarial review.');
});

test('headhunt persists overlays and promotion challenge state without workflow mutation', async () => {
  const cwd = tempDir('construct-headhunt-overlay-');
  fs.mkdirSync(path.join(cwd, '.cx'), { recursive: true });

  const created = await runHeadhunt({
    args: ['terraform', '--for=design account structure', '--save'],
    cwd,
    homeDir: tempDir('construct-headhunt-home-'),
  });

  const overlay = JSON.parse(fs.readFileSync(created.overlayJsonPath, 'utf8'));
  const promotion = JSON.parse(fs.readFileSync(created.promotionPath, 'utf8'));
  assert.equal(overlay.taskKey, null);
  assert.equal(overlay.workflowId, null);
  assert.equal(promotion.challenge.status, 'pending');

  updatePromotionChallenge(created.overlay.id, { cwd, status: 'approved' });
  const updatedPromotion = JSON.parse(fs.readFileSync(created.promotionPath, 'utf8'));
  assert.equal(updatedPromotion.challenge.status, 'approved');
});
