/**
 * intake-integrations.test.mjs — Tests for the intake integrations module.
 *
 * Covers: integration registration, configuration, and webhook handling.
 */
import { describe, it, before, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync, readFileSync, unlinkSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const TEST_TAG_DIR = '/tmp/test-integration-tag';

describe('intake integrations', () => {
  let integ;

  before(async () => {
    integ = await import('../../lib/integrations/intake-integrations.mjs');
  });

  describe('detectIntegrationConfig', () => {
    it('returns false for jira and confluence when no env vars are set', () => {
      const config = integ.detectIntegrationConfig();
      assert.equal(config.jira, false);
      assert.equal(config.confluence, false);
      // GitHub may be 'gh' method if gh CLI is authenticated — that's correct
    });
  });

  describe('createGitHubIssue', () => {
    it('handles API errors gracefully (fallback from gh CLI to API)', async () => {
      // Mock fetch that returns 401
      const mockFetch = async () => ({
        ok: false,
        status: 401,
        text: async () => 'Bad credentials',
      });
      const packet = { id: 'test-1', triage: { intakeType: 'bug' }, excerpt: 'Test issue' };
      const result = await integ.createGitHubIssue(packet, {
        repo: 'test/repo',
        token: 'fake-token',
        fetchImpl: mockFetch,
      });
      assert.equal(result.ok, false);
      assert.ok(result.error.includes('401'));
    });
  });

  describe('createJiraTicket', () => {
    it('returns error when JIRA_HOST is not set', async () => {
      const packet = { id: 'test-1', triage: { intakeType: 'bug' } };
      const result = await integ.createJiraTicket(packet, {
        email: 'user@test.com',
        token: 'fake-token',
        project: 'PROJ',
      });
      assert.equal(result.ok, false);
      assert.ok(result.error.includes('JIRA_HOST'));
    });

    it('handles API errors gracefully', async () => {
      const mockFetch = async () => ({
        ok: false,
        status: 400,
        text: async () => 'Invalid project',
      });
      const packet = { id: 'test-1', triage: { intakeType: 'bug' } };
      const result = await integ.createJiraTicket(packet, {
        host: 'https://test.atlassian.net',
        email: 'user@test.com',
        token: 'fake-token',
        project: 'BAD',
        fetchImpl: mockFetch,
      });
      assert.equal(result.ok, false);
      assert.ok(result.error.includes('400'));
    });
  });

  describe('publishArtifactToConfluence', () => {
    it('returns error when CONFLUENCE_HOST is not set', async () => {
      const artifact = { type: 'prd', number: 1, title: 'Test', content: '# Test' };
      const result = await integ.publishArtifactToConfluence(artifact, {
        email: 'user@test.com',
        token: 'fake',
        space: 'PROD',
      });
      assert.equal(result.ok, false);
    });
  });

  describe('tagIntakeWithExternalRef', () => {
    const testDir = '/tmp/test-integration-tag';

    beforeEach(() => {
      mkdirSync(join(testDir, '.cx', 'intake', 'pending'), { recursive: true });
    });

    afterEach(() => {
      try {
        const files = readdirSync(join(testDir, '.cx', 'intake', 'pending'));
        files.forEach(f => unlinkSync(join(testDir, '.cx', 'intake', 'pending', f)));
      } catch {}
    });

    it('writes external ref to intake packet JSON', () => {
      const intakeId = 'tag-test-1';
      const entry = { id: intakeId, triage: { intakeType: 'bug' } };
      writeFileSync(join(testDir, '.cx', 'intake', 'pending', `${intakeId}.json`), JSON.stringify(entry));

      integ.tagIntakeWithExternalRef(testDir, intakeId, 'github', 'https://github.com/test/repo/1', '1');

      const updated = JSON.parse(readFileSync(join(testDir, '.cx', 'intake', 'pending', `${intakeId}.json`), 'utf8'));
      assert.ok(updated.externalRefs);
      assert.equal(updated.externalRefs.github.url, 'https://github.com/test/repo/1');
    });

    it('does nothing for missing intake file', () => {
      // Should not throw
      integ.tagIntakeWithExternalRef(testDir, 'nonexistent', 'github', 'url', '1');
    });
  });
});
