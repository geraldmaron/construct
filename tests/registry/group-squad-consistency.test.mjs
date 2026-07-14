/**
 * tests/registry/group-squad-consistency.test.mjs — construct-72gqn.29 (D9).
 *
 * The groups layer (specialists/org/groups/*.json) is a fourth registry layer that carries
 * its own owner/roles/escalationPath alongside the teams (squads) layer — and because groups
 * are NOT part of the assembled unified registry, the validator never checked them, so the
 * two layers drifted (ADR-0065 §8 records the live team-decision-violation / escalation-path
 * gaps that caused). This pins the dedup as an enforced invariant: a group's roles must be
 * exactly the de-overlayed union of its squads' roles, its owner must be one of those roles,
 * and its squads must reference real teams — so the squads layer is the single source of
 * truth for membership and the redundant group copy can never silently diverge again.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const GROUPS_DIR = path.join(REPO, 'specialists', 'org', 'groups');
const TEAMS_DIR = path.join(REPO, 'specialists', 'org', 'teams');

function loadDir(dir) {
  const out = {};
  for (const f of fs.readdirSync(dir)) {
    if (!f.endsWith('.json')) continue;
    const j = JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8'));
    out[j.id] = j;
  }
  return out;
}

// A squad's roles list includes flavor-overlay entries (e.g. product-manager.growth); those
// are not real roster members, so the group's membership is the base roles only.

function deOverlayedUnion(squadIds, teams) {
  const roles = new Set();
  for (const sid of squadIds) {
    for (const role of teams[sid]?.roles ?? []) {
      if (!role.includes('.')) roles.add(role);
    }
  }
  return [...roles].sort();
}

const groups = loadDir(GROUPS_DIR);
const teams = loadDir(TEAMS_DIR);

test('every group references real squads (teams)', () => {
  for (const [gid, group] of Object.entries(groups)) {
    const squads = group.squads ?? [];
    assert.ok(squads.length > 0, `${gid} declares at least one squad`);
    for (const sid of squads) {
      assert.ok(teams[sid], `${gid} squad ${sid} is a real team`);
    }
  }
});

test("a group's roles are exactly the de-overlayed union of its squads' roles (squads are the source of truth)", () => {
  for (const [gid, group] of Object.entries(groups)) {
    const derived = deOverlayedUnion(group.squads ?? [], teams);
    const declared = [...(group.roles ?? [])].sort();
    assert.deepEqual(declared, derived, `${gid} roles must equal its squads' de-overlayed union — the groups layer drifted from the teams layer`);
  }
});

test("a group's owner is one of its squad-derived roles", () => {
  for (const [gid, group] of Object.entries(groups)) {
    if (!group.owner) continue;
    const derived = deOverlayedUnion(group.squads ?? [], teams);
    assert.ok(derived.includes(group.owner), `${gid} owner ${group.owner} must be a role in one of its squads`);
  }
});
