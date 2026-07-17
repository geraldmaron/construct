/**
 * tests/writes/jira.functional.test.mjs — Jira writes routed through the
 * governed write envelope (LMCP-J3).
 *
 * Uses tests/fakes/fake-jira-transport.mjs (no real network) to validate:
 * createmeta pre-validation (unknown project, missing required field,
 * transport failure), ADF body construction for issue description and
 * comment body, project/permission error mapping, and dry-run rendering of
 * the ADF payload for human review before submit.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { writeWithEnvelope } from '../../lib/writes/envelope.mjs';
import { WriteSentLog } from '../../lib/writes/sent-log.mjs';
import { createGovernedJiraProvider } from '../../lib/providers/contract/adapters/jira/governed-write.mjs';
import { createFakeJiraTransport } from '../fakes/fake-jira-transport.mjs';
import { isAdfDocument } from '../../lib/providers/contract/adapters/jira/adf.mjs';

describe('Jira issue create through the governed envelope', () => {
  it('creates an issue with an ADF description after createmeta validation passes', async () => {
    const transport = createFakeJiraTransport({
      projects: { PROJ: { issueTypes: { Task: { requiredFields: ['summary'] } } } },
    });
    const provider = createGovernedJiraProvider({ jiraTransport: transport });
    const sentLog = new WriteSentLog();

    const result = await writeWithEnvelope({
      provider, config: {}, sentLog,
      payload: {
        type: 'issue',
        project: 'PROJ',
        issueType: 'Task',
        summary: 'Investigate flaky test',
        description: 'Line one.\n\n- step one\n- step two',
      },
    });

    assert.equal(result.status, 'sent');
    assert.equal(transport.createmetaCallCount(), 1, 'createmeta must be consulted before submit');
    assert.equal(transport.getCreatedIssues().length, 1);

    const [created] = transport.getCreatedIssues();
    assert.ok(isAdfDocument(created.description), 'description sent to transport must be ADF, not plain text');
    assert.equal(created.description.type, 'doc');
    assert.match(result.envelope.externalUrl, /^https:\/\/jira\.example\.com\/browse\/PROJ-/);
  });

  it('createmeta rejects an unknown project before any create call is made', async () => {
    const transport = createFakeJiraTransport({ projects: { PROJ: { issueTypes: { Task: {} } } } });
    transport.setMode('createmeta-unknown-project');
    const provider = createGovernedJiraProvider({ jiraTransport: transport });

    const result = await writeWithEnvelope({
      provider, config: {},
      payload: { type: 'issue', project: 'NOPE', issueType: 'Task', summary: 'X' },
    });

    assert.equal(result.status, 'error');
    assert.match(result.envelope.error, /not found|permission/i);
    assert.equal(transport.createIssueCallCount(), 0, 'create must never be attempted after createmeta rejects');
  });

  it('createmeta rejects a payload missing a project-required field', async () => {
    const transport = createFakeJiraTransport({
      projects: { PROJ: { issueTypes: { Task: { requiredFields: ['labels'] } } } },
    });
    const provider = createGovernedJiraProvider({ jiraTransport: transport });

    const result = await writeWithEnvelope({
      provider, config: {},
      payload: { type: 'issue', project: 'PROJ', issueType: 'Task', summary: 'Missing labels' },
    });

    assert.equal(result.status, 'error');
    assert.match(result.envelope.error, /"labels" is required/i);
    assert.equal(transport.createIssueCallCount(), 0);
  });

  it('createmeta rejects a doc-typed field submitted as plain text (ADF shape mismatch)', async () => {
    const transport = createFakeJiraTransport({
      projects: {
        PROJ: {
          issueTypes: {
            Task: { fieldOverrides: { summary: { schema: { type: 'doc' } } } },
          },
        },
      },
    });
    const provider = createGovernedJiraProvider({ jiraTransport: transport });

    const result = await writeWithEnvelope({
      provider, config: {},
      payload: { type: 'issue', project: 'PROJ', issueType: 'Task', summary: 'plain text, not ADF' },
    });

    assert.equal(result.status, 'error');
    assert.match(result.envelope.error, /Atlassian Document Format/i);
    assert.equal(transport.createIssueCallCount(), 0);
  });

  it('createmeta transport failure (5xx) surfaces an actionable error, no create attempted', async () => {
    const transport = createFakeJiraTransport();
    transport.setMode('createmeta-transport-error');
    const provider = createGovernedJiraProvider({ jiraTransport: transport });

    const result = await writeWithEnvelope({
      provider, config: {},
      payload: { type: 'issue', project: 'PROJ', issueType: 'Task', summary: 'X' },
    });

    assert.equal(result.status, 'error');
    assert.match(result.envelope.error, /server error/i);
    assert.equal(transport.createIssueCallCount(), 0);
  });

  it('permission-denied on the create call maps to an actionable Forbidden message', async () => {
    const transport = createFakeJiraTransport();
    transport.setMode('permission-denied');
    const provider = createGovernedJiraProvider({ jiraTransport: transport });

    const result = await writeWithEnvelope({
      provider, config: {},
      payload: { type: 'issue', project: 'PROJ', issueType: 'Task', summary: 'X' },
    });

    assert.equal(result.status, 'error');
    assert.match(result.envelope.error, /Forbidden.*permission to write to project "PROJ"/i);
  });

  it('unknown issue type is rejected by createmeta with an actionable message', async () => {
    const transport = createFakeJiraTransport({ projects: { PROJ: { issueTypes: { Task: {} } } } });
    const provider = createGovernedJiraProvider({ jiraTransport: transport });

    const result = await writeWithEnvelope({
      provider, config: {},
      payload: { type: 'issue', project: 'PROJ', issueType: 'Epic', summary: 'X' },
    });

    assert.equal(result.status, 'error');
    assert.match(result.envelope.error, /issue type "Epic" is not available/i);
    assert.equal(transport.createIssueCallCount(), 0);
  });
});

describe('Jira issue update through the governed envelope', () => {
  it('updates summary and description on an existing issue, no createmeta call', async () => {
    const transport = createFakeJiraTransport();
    const provider = createGovernedJiraProvider({ jiraTransport: transport });
    await writeWithEnvelope({
      provider, config: {},
      payload: { type: 'issue', project: 'PROJ', issueType: 'Task', summary: 'original' },
    });
    const createmetaCallsBeforeUpdate = transport.createmetaCallCount();

    const result = await writeWithEnvelope({
      provider, config: {},
      payload: { type: 'issue-update', issueKey: 'PROJ-1', summary: 'updated summary', description: 'more detail' },
    });

    assert.equal(result.status, 'sent');
    assert.equal(result.envelope.result.type, 'issue-updated');
    assert.equal(transport.updateIssueCallCount(), 1);
    assert.equal(transport.createmetaCallCount(), createmetaCallsBeforeUpdate, 'issue-update must not re-run createmeta validation');
  });

  it('requires issueKey', async () => {
    const transport = createFakeJiraTransport();
    const provider = createGovernedJiraProvider({ jiraTransport: transport });
    const result = await writeWithEnvelope({
      provider, config: {},
      payload: { type: 'issue-update', summary: 'no issue key' },
    });
    assert.equal(result.status, 'error');
    assert.match(result.envelope.error, /issueKey is required/);
  });

  it('requires at least one updatable field', async () => {
    const transport = createFakeJiraTransport();
    const provider = createGovernedJiraProvider({ jiraTransport: transport });
    const result = await writeWithEnvelope({
      provider, config: {},
      payload: { type: 'issue-update', issueKey: 'PROJ-1' },
    });
    assert.equal(result.status, 'error');
    assert.match(result.envelope.error, /at least one of summary\/description\/labels\/assignee/);
  });

  it('permission-denied on update maps to an actionable message naming the issue', async () => {
    const transport = createFakeJiraTransport();
    transport.setMode('permission-denied');
    const provider = createGovernedJiraProvider({ jiraTransport: transport });

    const result = await writeWithEnvelope({
      provider, config: {},
      payload: { type: 'issue-update', issueKey: 'PROJ-1', summary: 'x' },
    });

    assert.equal(result.status, 'error');
    assert.match(result.envelope.error, /Forbidden.*permission to write to issue "PROJ-1"/i);
  });

  it('renderDryRun renders an ADF preview without calling the transport', () => {
    const transport = createFakeJiraTransport();
    const provider = createGovernedJiraProvider({ jiraTransport: transport });
    const diff = provider.renderDryRun({ type: 'issue-update', issueKey: 'PROJ-1', description: 'preview text' });
    assert.equal(diff.fields.issueKey, 'PROJ-1');
    assert.ok(diff.adfPreview.description);
    assert.equal(transport.updateIssueCallCount(), 0);
  });
});

describe('Jira comment create through the governed envelope', () => {
  it('creates a comment with an ADF body', async () => {
    const transport = createFakeJiraTransport();
    const provider = createGovernedJiraProvider({ jiraTransport: transport });

    const result = await writeWithEnvelope({
      provider, config: {},
      payload: { type: 'comment', issueKey: 'PROJ-1', body: 'Looked into this, needs repro steps.' },
    });

    assert.equal(result.status, 'sent');
    const [comment] = transport.getCreatedComments();
    assert.ok(isAdfDocument(comment.body));
    assert.equal(comment.body.content[0].type, 'paragraph');
  });

  it('permission-denied on comment create maps to an actionable message naming the issue', async () => {
    const transport = createFakeJiraTransport();
    transport.setMode('permission-denied');
    const provider = createGovernedJiraProvider({ jiraTransport: transport });

    const result = await writeWithEnvelope({
      provider, config: {},
      payload: { type: 'comment', issueKey: 'PROJ-9', body: 'x' },
    });

    assert.equal(result.status, 'error');
    assert.match(result.envelope.error, /Forbidden.*issue "PROJ-9"/i);
  });
});

describe('Jira writes: envelope-only exposure', () => {
  it('unsupported write types are rejected rather than silently forwarded', async () => {
    const transport = createFakeJiraTransport();
    const provider = createGovernedJiraProvider({ jiraTransport: transport });

    const result = await writeWithEnvelope({
      provider, config: {},
      payload: { type: 'transition', issueKey: 'PROJ-1', transitionId: '31' },
    });

    assert.equal(result.status, 'error');
    assert.match(result.envelope.error, /unsupported type "transition"/i);
  });

  it('audit trail: sent-log records the linkback for a successful issue write', async () => {
    const transport = createFakeJiraTransport();
    const provider = createGovernedJiraProvider({ jiraTransport: transport });
    const sentLog = new WriteSentLog();

    await writeWithEnvelope({
      provider, config: {}, sentLog,
      payload: { type: 'issue', project: 'PROJ', issueType: 'Task', summary: 'Audited issue' },
      idempotencyKey: 'jira-audit-1',
    });

    const record = sentLog.findByIdempotencyKey('jira-audit-1');
    assert.equal(record.status, 'sent');
    assert.match(record.externalUrl, /^https:\/\/jira\.example\.com\/browse\//);
  });
});

describe('Jira dry-run: ADF payload rendered for human review', () => {
  it('dry-run through the envelope returns the raw payload without calling createmeta or the transport', async () => {
    const transport = createFakeJiraTransport();
    const provider = createGovernedJiraProvider({ jiraTransport: transport });

    const result = await writeWithEnvelope({
      provider, config: {},
      dryRun: true,
      payload: {
        type: 'issue',
        project: 'PROJ',
        issueType: 'Task',
        summary: 'Dry run me',
        description: 'Body text.\n\n- item a\n- item b',
      },
    });

    assert.equal(result.status, 'dry-run');
    assert.equal(transport.createmetaCallCount(), 0, 'dry-run must not touch createmeta');
    assert.equal(transport.createIssueCallCount(), 0, 'dry-run must not touch the transport');
    assert.equal(result.envelope.payload.type, 'issue');
  });

  it('renderDryRun produces the exact ADF document plus a readable preview for issue description', () => {
    const transport = createFakeJiraTransport();
    const provider = createGovernedJiraProvider({ jiraTransport: transport });

    const rendered = provider.renderDryRun({
      type: 'issue',
      project: 'PROJ',
      issueType: 'Task',
      summary: 'Human-reviewable dry run',
      description: 'Intro paragraph.\n\n- first step\n- second step',
    });

    assert.equal(rendered.fields.project.key, 'PROJ');
    assert.ok(isAdfDocument(rendered.fields.description));
    assert.equal(rendered.fields.description.content[0].type, 'paragraph');
    assert.equal(rendered.fields.description.content[1].type, 'bulletList');
    assert.match(rendered.adfPreview.description, /Intro paragraph\./);
    assert.match(rendered.adfPreview.description, /- first step/);
    assert.match(rendered.adfPreview.description, /- second step/);
  });

  it('renderDryRun produces the ADF document for a comment body', () => {
    const transport = createFakeJiraTransport();
    const provider = createGovernedJiraProvider({ jiraTransport: transport });

    const rendered = provider.renderDryRun({
      type: 'comment',
      issueKey: 'PROJ-3',
      body: 'Reviewed, looks correct.',
    });

    assert.equal(rendered.type, 'comment');
    assert.ok(isAdfDocument(rendered.fields.body));
    assert.equal(rendered.adfPreview.body, 'Reviewed, looks correct.');
  });
});
