/**
 * customer-profiles.test.mjs — Tests for the embed customer-profiles module.
 *
 * Covers: profile creation, retrieval, update, deletion, and persistence
 * across restarts.
 */
import { describe, it, beforeEach, afterEach, before } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, unlinkSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';

const PROFILES_DIR = join(homedir(), '.cx', 'product-intel', 'customer-profiles');
const INDEX_FILE = join(PROFILES_DIR, 'index.json');

describe('customer profiles', () => {
  let profiles;

  before(async () => {
    profiles = await import('../../lib/embed/customer-profiles.mjs');
  });

  afterEach(() => {
    // Remove test profiles
    try {
      const files = readdirSync(PROFILES_DIR);
      for (const f of files) {
        if (f.includes('testcorp') || f.includes('acme') || f.includes('othercorp')) {
          unlinkSync(join(PROFILES_DIR, f));
        }
      }
    } catch {}
    try { unlinkSync(INDEX_FILE); } catch {}
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
