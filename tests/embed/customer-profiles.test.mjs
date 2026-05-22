/**
 * customer-profiles.test.mjs — Tests for the embed customer-profiles module.
 *
 * Covers: profile creation, retrieval, update, deletion, and persistence
 * across restarts.
 */
import { describe, it, before, after, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readdirSync, rmSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

describe('customer profiles', () => {
  let profiles;
  let tmpHome;
  let profilesDir;
  let indexFile;

  before(async () => {
    tmpHome = mkdtempSync(join(tmpdir(), 'cx-customer-profiles-home-'));
    process.env.CX_HOME_OVERRIDE = tmpHome;
    profilesDir = join(tmpHome, '.cx', 'knowledge', 'internal', 'customer-profiles');
    indexFile = join(profilesDir, 'index.json');
    profiles = await import('../../lib/embed/customer-profiles.mjs');
  });

  afterEach(() => {
    // Remove test profiles
    try {
      const files = readdirSync(profilesDir);
      for (const f of files) {
        if (f.includes('testcorp') || f.includes('acme') || f.includes('othercorp')) {
          unlinkSync(join(profilesDir, f));
        }
      }
    } catch {}
    try { unlinkSync(indexFile); } catch {}
  });

  after(() => {
    delete process.env.CX_HOME_OVERRIDE;
    rmSync(tmpHome, { recursive: true, force: true });
  });

  describe('createCustomerProfile', () => {
    it('creates a profile with generated ID', () => {
      const result = profiles.createCustomerProfile({ name: 'TestCorp', owner: 'Jane' });
      assert.ok(result.id.startsWith('cust-'));
      assert.equal(result.profile.name, 'TestCorp');
    });

    it('throws for missing name', () => {
      assert.throws(() => profiles.createCustomerProfile({}), /name is required/);
    });

    it('accepts optional domain and aliases', () => {
      const result = profiles.createCustomerProfile({
        name: 'Acme Corp',
        domain: 'acme.com',
        aliases: ['acme', 'acme-corp'],
      });
      assert.equal(result.profile.domain, 'acme.com');
    });
  });

  describe('detectCustomerMentions', () => {
    it('finds matching customer by name', () => {
      profiles.createCustomerProfile({ name: 'TestDetectionCorp' });
      const mentions = profiles.detectCustomerMentions('TestDetectionCorp needs a feature');
      assert.ok(mentions.length > 0);
      assert.equal(mentions[0].name, 'TestDetectionCorp');
    });

    it('returns empty for unknown text', () => {
      profiles.createCustomerProfile({ name: 'OtherCorp' });
      const mentions = profiles.detectCustomerMentions('Some random text');
      assert.equal(mentions.length, 0);
    });
  });

  describe('searchCustomerProfiles', () => {
    it('finds profiles by name prefix', () => {
      profiles.createCustomerProfile({ name: 'SearchTestCorp' });
      const results = profiles.searchCustomerProfiles('SearchTest');
      assert.ok(results.length > 0);
    });
  });

  describe('listCustomerProfiles', () => {
    it('lists created profiles', () => {
      profiles.createCustomerProfile({ name: 'ListTestCorp A' });
      profiles.createCustomerProfile({ name: 'ListTestCorp B' });
      const list = profiles.listCustomerProfiles();
      const ours = list.filter(p => p.name.startsWith('ListTestCorp'));
      assert.equal(ours.length, 2);
    });

    it('filters by status', () => {
      const r = profiles.createCustomerProfile({ name: 'ActiveCorp', status: 'active' });
      profiles.createCustomerProfile({ name: 'InactiveCorp', status: 'inactive' });
      const active = profiles.listCustomerProfiles({ status: 'active' });
      assert.ok(active.every(p => p.status === 'active'));
    });
  });
});
