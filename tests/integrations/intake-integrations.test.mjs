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

    it('refuses to publish a packet whose sourcePath is under tests/fixtures/', async () => {
      const mockFetch = async () => { throw new Error('fetch should not be called'); };
      const packet = {
        id: 'demo-1',
        intake: { sourcePath: '/Users/me/repo/tests/fixtures/intake/sample.md' },
        triage: { intakeType: 'bug' },
      };
      const result = await integ.createGitHubIssue(packet, { fetchImpl: mockFetch });
      assert.equal(result.ok, false);
      assert.equal(result.skipped, 'demo-source');
      assert.ok(result.error.includes('demo'));
    });

    it('refuses to publish when CONSTRUCT_DEMO=1 is set', async () => {
      const prev = process.env.CONSTRUCT_DEMO;
      process.env.CONSTRUCT_DEMO = '1';
      try {
        const mockFetch = async () => { throw new Error('fetch should not be called'); };
        const packet = { id: 'real-1', intake: { sourcePath: '/real/path.md' }, triage: { intakeType: 'bug' } };
        const result = await integ.createGitHubIssue(packet, { fetchImpl: mockFetch });
        assert.equal(result.ok, false);
        assert.equal(result.skipped, 'demo-source');
      } finally {
        if (prev === undefined) delete process.env.CONSTRUCT_DEMO;
        else process.env.CONSTRUCT_DEMO = prev;
      }
    });

    it('publishDemo:true overrides the demo-source gate', async () => {
      const mockFetch = async () => ({
        ok: true,
        json: async () => ({ html_url: 'https://github.com/test/repo/issues/1', number: 1 }),
      });
      const packet = {
        id: 'demo-2',
        intake: { sourcePath: '/repo/tests/fixtures/intake/sample.md' },
        triage: { intakeType: 'bug' },
      };
      const result = await integ.createGitHubIssue(packet, {
        repo: 'test/repo',
        token: 'fake-token',
        fetchImpl: mockFetch,
        publishDemo: true,
      });
      assert.equal(result.ok, true);
      assert.equal(result.externalUrl, 'https://github.com/test/repo/issues/1');
    });
  });

  describe('isDemoIntakePacket', () => {
    it('detects tests/fixtures/ in sourcePath', () => {
      assert.equal(integ.isDemoIntakePacket({ intake: { sourcePath: '/x/tests/fixtures/y.md' } }), true);
    });
    it('detects .construct/intake/demo/ in sourcePath', () => {
      assert.equal(integ.isDemoIntakePacket({ intake: { sourcePath: '/x/.construct/intake/demo/y.md' } }), true);
    });
    it('returns false for a real-looking sourcePath', () => {
      assert.equal(integ.isDemoIntakePacket({ intake: { sourcePath: '/work/inbox/feedback.md' } }), false);
    });
    it('returns false for a packet with no source', () => {
      assert.equal(integ.isDemoIntakePacket({}), false);
      assert.equal(integ.isDemoIntakePacket(null), false);
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

  describe('createLinearIssue', () => {
    let prevLinearWrites;

    beforeEach(() => {
      prevLinearWrites = process.env.CONSTRUCT_LINEAR_WRITES;
      process.env.CONSTRUCT_LINEAR_WRITES = '1';
    });

    afterEach(() => {
      if (prevLinearWrites === undefined) delete process.env.CONSTRUCT_LINEAR_WRITES;
      else process.env.CONSTRUCT_LINEAR_WRITES = prevLinearWrites;
    });

    it('returns skipped:disabled when CONSTRUCT_LINEAR_WRITES is not set', async () => {
      delete process.env.CONSTRUCT_LINEAR_WRITES;
      const mockFetch = async () => { throw new Error('fetch should not be called'); };
      const packet = { id: 'test-1', triage: { intakeType: 'bug' }, excerpt: 'Test issue' };
      const result = await integ.createLinearIssue(packet, {
        token: 'fake-token',
        teamId: 'team-123',
        fetchImpl: mockFetch,
      });
      assert.equal(result.ok, false);
      assert.equal(result.skipped, 'disabled');
      assert.ok(result.error.includes('CONSTRUCT_LINEAR_WRITES=1'));
    });

    it('refuses to publish a demo/fixture packet', async () => {
      const mockFetch = async () => { throw new Error('fetch should not be called'); };
      const packet = {
        id: 'demo-1',
        intake: { sourcePath: '/Users/me/repo/tests/fixtures/intake/sample.md' },
        triage: { intakeType: 'bug' },
      };
      const result = await integ.createLinearIssue(packet, {
        token: 'fake-token',
        teamId: 'team-123',
        fetchImpl: mockFetch,
      });
      assert.equal(result.ok, false);
      assert.equal(result.skipped, 'demo-source');
      assert.ok(result.error.includes('demo'));
    });

    it('publishDemo:true overrides the demo-source gate', async () => {
      const mockFetch = async () => ({
        ok: true,
        json: async () => ({
          data: { issueCreate: { issue: { id: 'i1', identifier: 'TEAM-1', url: 'https://linear.app/team/issue/TEAM-1' } } },
        }),
      });
      const packet = {
        id: 'demo-2',
        intake: { sourcePath: '/repo/tests/fixtures/intake/sample.md' },
        triage: { intakeType: 'bug' },
        excerpt: 'Demo issue',
      };
      const result = await integ.createLinearIssue(packet, {
        token: 'fake-token',
        teamId: 'team-123',
        fetchImpl: mockFetch,
        publishDemo: true,
      });
      assert.equal(result.ok, true);
    });

    it('returns error when LINEAR_API_TOKEN is not set', async () => {
      const packet = { id: 'test-1', triage: { intakeType: 'bug' }, excerpt: 'Test issue' };
      const result = await integ.createLinearIssue(packet, {
        teamId: 'team-123',
      });
      assert.equal(result.ok, false);
      assert.ok(result.error.includes('LINEAR_API_TOKEN'));
    });

    it('returns error when LINEAR_TEAM_ID is not set', async () => {
      const packet = { id: 'test-1', triage: { intakeType: 'bug' }, excerpt: 'Test issue' };
      const result = await integ.createLinearIssue(packet, {
        token: 'fake-token',
      });
      assert.equal(result.ok, false);
      assert.ok(result.error.includes('LINEAR_TEAM_ID'));
    });

    it('handles API errors gracefully', async () => {
      const mockFetch = async () => ({
        ok: false,
        status: 401,
        text: async () => 'Invalid token',
      });
      const packet = { id: 'test-1', triage: { intakeType: 'bug' }, excerpt: 'Test issue' };
      const result = await integ.createLinearIssue(packet, {
        token: 'fake-token',
        teamId: 'team-123',
        fetchImpl: mockFetch,
      });
      assert.equal(result.ok, false);
      assert.ok(result.error.includes('401'));
    });

    it('handles GraphQL errors gracefully', async () => {
      const mockFetch = async () => ({
        ok: true,
        json: async () => ({
          errors: [{ message: 'Invalid team ID' }],
        }),
      });
      const packet = { id: 'test-1', triage: { intakeType: 'bug' }, excerpt: 'Test issue' };
      const result = await integ.createLinearIssue(packet, {
        token: 'fake-token',
        teamId: 'invalid-team',
        fetchImpl: mockFetch,
      });
      assert.equal(result.ok, false);
      assert.ok(result.error.includes('Invalid team ID'));
    });

    it('creates a Linear issue and sends the expected GraphQL payload', async () => {
      let captured;
      const mockFetch = async (url, init) => {
        captured = { url, init };
        return {
          ok: true,
          json: async () => ({
            data: {
              issueCreate: {
                issue: {
                  id: 'issue-123',
                  identifier: 'TEAM-456',
                  url: 'https://linear.app/team/issue/TEAM-456',
                },
              },
            },
          }),
        };
      };
      const packet = {
        id: 'test-1',
        triage: { intakeType: 'bug' },
        excerpt: 'Test issue',
        intake: { sourcePath: '/work/signal.md' },
      };
      const result = await integ.createLinearIssue(packet, {
        token: 'fake-token',
        teamId: 'team-123',
        fetchImpl: mockFetch,
      });
      assert.equal(result.ok, true);
      assert.equal(result.externalId, 'TEAM-456');
      assert.equal(result.externalUrl, 'https://linear.app/team/issue/TEAM-456');

      assert.equal(captured.url, 'https://api.linear.app/graphql');
      const body = JSON.parse(captured.init.body);
      assert.ok(body.query.includes('issueCreate'));
      assert.equal(body.variables.input.teamId, 'team-123');
      assert.equal('labelIds' in body.variables.input, false);
      assert.equal(captured.init.headers.Authorization, 'Bearer fake-token');
    });

    it('sends a lin_api_ personal API key bare (no Bearer prefix)', async () => {
      let captured;
      const mockFetch = async (url, init) => {
        captured = { url, init };
        return {
          ok: true,
          json: async () => ({
            data: { issueCreate: { issue: { id: 'i1', identifier: 'TEAM-2', url: 'https://linear.app/team/issue/TEAM-2' } } },
          }),
        };
      };
      const packet = { id: 'test-1', triage: { intakeType: 'bug' }, excerpt: 'Test issue' };
      const result = await integ.createLinearIssue(packet, {
        token: 'lin_api_x',
        teamId: 'team-123',
        fetchImpl: mockFetch,
      });
      assert.equal(result.ok, true);
      assert.equal(captured.init.headers.Authorization, 'lin_api_x');
    });
  });

  describe('postSlackMessage', () => {
    let prevSlackWrites;

    beforeEach(() => {
      prevSlackWrites = process.env.CONSTRUCT_SLACK_WRITES;
      process.env.CONSTRUCT_SLACK_WRITES = '1';
    });

    afterEach(() => {
      if (prevSlackWrites === undefined) delete process.env.CONSTRUCT_SLACK_WRITES;
      else process.env.CONSTRUCT_SLACK_WRITES = prevSlackWrites;
    });

    it('returns skipped:disabled when CONSTRUCT_SLACK_WRITES is not set', async () => {
      delete process.env.CONSTRUCT_SLACK_WRITES;
      const mockFetch = async () => { throw new Error('fetch should not be called'); };
      const packet = { id: 'test-1', triage: { intakeType: 'bug' }, excerpt: 'Test message' };
      const result = await integ.postSlackMessage(packet, {
        token: 'xoxb-x',
        channel: 'C1234567',
        fetchImpl: mockFetch,
      });
      assert.equal(result.ok, false);
      assert.equal(result.skipped, 'disabled');
      assert.ok(result.error.includes('CONSTRUCT_SLACK_WRITES=1'));
    });

    it('refuses to publish a demo/fixture packet', async () => {
      const mockFetch = async () => { throw new Error('fetch should not be called'); };
      const packet = {
        id: 'demo-1',
        intake: { sourcePath: '/Users/me/repo/tests/fixtures/intake/sample.md' },
        triage: { intakeType: 'bug' },
      };
      const result = await integ.postSlackMessage(packet, {
        token: 'xoxb-x',
        channel: 'C1234567',
        fetchImpl: mockFetch,
      });
      assert.equal(result.ok, false);
      assert.equal(result.skipped, 'demo-source');
      assert.ok(result.error.includes('demo'));
    });

    it('publishDemo:true overrides the demo-source gate', async () => {
      const mockFetch = async () => ({
        ok: true,
        json: async () => ({ ok: true, channel: 'C1234567', ts: '1.2' }),
      });
      const packet = {
        id: 'demo-2',
        intake: { sourcePath: '/repo/tests/fixtures/intake/sample.md' },
        triage: { intakeType: 'bug' },
        excerpt: 'Demo message',
      };
      const result = await integ.postSlackMessage(packet, {
        token: 'xoxb-x',
        channel: 'C1234567',
        fetchImpl: mockFetch,
        publishDemo: true,
      });
      assert.equal(result.ok, true);
    });

    it('returns error when SLACK_BOT_TOKEN is not set', async () => {
      const packet = { id: 'test-1', triage: { intakeType: 'bug' }, excerpt: 'Test message' };
      const result = await integ.postSlackMessage(packet, {
        channel: 'C1234567',
      });
      assert.equal(result.ok, false);
      assert.ok(result.error.includes('SLACK_BOT_TOKEN'));
    });

    it('returns error when SLACK_CHANNEL is not set', async () => {
      const packet = { id: 'test-1', triage: { intakeType: 'bug' }, excerpt: 'Test message' };
      const result = await integ.postSlackMessage(packet, {
        token: 'xoxb-x',
      });
      assert.equal(result.ok, false);
      assert.ok(result.error.includes('SLACK_CHANNEL'));
    });

    it('handles API errors gracefully', async () => {
      const mockFetch = async () => ({
        ok: false,
        status: 401,
        text: async () => 'Invalid token',
      });
      const packet = { id: 'test-1', triage: { intakeType: 'bug' }, excerpt: 'Test message' };
      const result = await integ.postSlackMessage(packet, {
        token: 'xoxb-x',
        channel: 'C1234567',
        fetchImpl: mockFetch,
      });
      assert.equal(result.ok, false);
      assert.ok(result.error.includes('401'));
    });

    it('handles Slack API errors gracefully', async () => {
      const mockFetch = async () => ({
        ok: true,
        json: async () => ({
          ok: false,
          error: 'channel_not_found',
        }),
      });
      const packet = { id: 'test-1', triage: { intakeType: 'bug' }, excerpt: 'Test message' };
      const result = await integ.postSlackMessage(packet, {
        token: 'xoxb-x',
        channel: 'invalid-channel',
        fetchImpl: mockFetch,
      });
      assert.equal(result.ok, false);
      assert.ok(result.error.includes('channel_not_found'));
    });

    it('posts a Slack message with the expected request payload', async () => {
      let captured;
      const mockFetch = async (url, init) => {
        captured = { url, init };
        return {
          ok: true,
          json: async () => ({
            ok: true,
            channel: 'C1234567',
            ts: '1234567890.123456',
          }),
        };
      };
      const packet = {
        id: 'test-1',
        triage: { intakeType: 'bug', primaryOwner: 'alice' },
        excerpt: 'Test message',
        intake: { sourcePath: '/work/signal.md' },
      };
      const result = await integ.postSlackMessage(packet, {
        token: 'xoxb-x',
        channel: 'C1234567',
        fetchImpl: mockFetch,
      });
      assert.equal(result.ok, true);
      assert.ok(result.externalUrl.includes('C1234567'));
      assert.equal(result.externalId, '1234567890.123456');

      assert.equal(captured.url, 'https://slack.com/api/chat.postMessage');
      assert.equal(captured.init.headers.Authorization, 'Bearer xoxb-x');
      const body = JSON.parse(captured.init.body);
      assert.equal(body.channel, 'C1234567');
      assert.ok(body.text);
      assert.ok(Array.isArray(body.blocks));
    });
  });

  describe('tagIntakeWithExternalRef', () => {
    const testDir = '/tmp/test-integration-tag';

    beforeEach(() => {
      mkdirSync(join(testDir, '.construct', 'intake', 'pending'), { recursive: true });
    });

    afterEach(() => {
      try {
        const files = readdirSync(join(testDir, '.construct', 'intake', 'pending'));
        files.forEach(f => unlinkSync(join(testDir, '.construct', 'intake', 'pending', f)));
      } catch {}
    });

    it('writes external ref to intake packet JSON', () => {
      const intakeId = 'tag-test-1';
      const entry = { id: intakeId, triage: { intakeType: 'bug' } };
      writeFileSync(join(testDir, '.construct', 'intake', 'pending', `${intakeId}.json`), JSON.stringify(entry));

      integ.tagIntakeWithExternalRef(testDir, intakeId, 'github', 'https://github.com/test/repo/1', '1');

      const updated = JSON.parse(readFileSync(join(testDir, '.construct', 'intake', 'pending', `${intakeId}.json`), 'utf8'));
      assert.ok(updated.externalRefs);
      assert.equal(updated.externalRefs.github.url, 'https://github.com/test/repo/1');
    });

    it('does nothing for missing intake file', () => {
      // Should not throw
      integ.tagIntakeWithExternalRef(testDir, 'nonexistent', 'github', 'url', '1');
    });
  });
});
