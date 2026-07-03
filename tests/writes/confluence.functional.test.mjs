/**
 * tests/writes/confluence.functional.test.mjs — Confluence writes routed
 * through the governed write envelope (LMCP-J4).
 *
 * Uses tests/fakes/fake-confluence-transport.mjs (no real network) to
 * validate: page create + update via the envelope, title+space duplicate
 * detection returning a dedup decision instead of a second page, the
 * version-conflict recovery flow (refetch + re-render + re-approve), the
 * linkback comment left on publish, and scope/permission error mapping.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { writeWithEnvelope } from '../../lib/writes/envelope.mjs';
import { WriteSentLog } from '../../lib/writes/sent-log.mjs';
import { createGovernedConfluenceProvider } from '../../lib/providers/contract/adapters/confluence/governed-write.mjs';
import { createFakeConfluenceTransport } from '../fakes/fake-confluence-transport.mjs';

describe('Confluence page create through the governed envelope', () => {
  it('creates a page and leaves a linkback comment recording the idempotency key', async () => {
    const transport = createFakeConfluenceTransport();
    const provider = createGovernedConfluenceProvider({ confluenceTransport: transport });
    const sentLog = new WriteSentLog();

    const result = await writeWithEnvelope({
      provider, config: {}, sentLog,
      payload: {
        type: 'page',
        spaceId: 'ENG',
        title: 'RFC-100: Governed writes',
        body: '<p>Body</p>',
        idempotencyKey: 'rfc-100',
      },
      idempotencyKey: 'rfc-100-envelope',
    });

    assert.equal(result.status, 'sent');
    assert.equal(transport.createCallCount(), 1);
    assert.match(result.envelope.externalUrl, /^https:\/\/confluence\.example\.com\/wiki\/spaces\/pages\//);

    const [comment] = transport.getComments();
    assert.ok(comment, 'a linkback comment must be posted after a successful create');
    assert.match(comment.body, /construct:write:rfc-100/);
  });

  it('creates distinct pages for distinct titles in the same space', async () => {
    const transport = createFakeConfluenceTransport();
    const provider = createGovernedConfluenceProvider({ confluenceTransport: transport });

    await writeWithEnvelope({
      provider, config: {},
      payload: { type: 'page', spaceId: 'ENG', title: 'Page A', body: '<p>a</p>' },
    });
    await writeWithEnvelope({
      provider, config: {},
      payload: { type: 'page', spaceId: 'ENG', title: 'Page B', body: '<p>b</p>' },
    });

    assert.equal(transport.getPages().length, 2);
  });
});

describe('Confluence duplicate detection: title+space search', () => {
  it('a duplicate title in the same space triggers a dedup decision, not a second page', async () => {
    const transport = createFakeConfluenceTransport();
    transport.seedPage({ spaceId: 'ENG', title: 'RFC-100: Governed writes', body: '<p>Existing</p>' });
    const provider = createGovernedConfluenceProvider({ confluenceTransport: transport });

    const result = await writeWithEnvelope({
      provider, config: {},
      payload: { type: 'page', spaceId: 'ENG', title: 'RFC-100: Governed writes', body: '<p>New attempt</p>' },
    });

    assert.equal(result.status, 'sent');
    assert.equal(result.envelope.result.type, 'page-duplicate');
    assert.equal(transport.createCallCount(), 0, 'no create call should be made once a duplicate is found');
    assert.equal(transport.getPages().length, 1, 'no second page should be created');
    assert.match(result.envelope.result.linkback, /confluence\.example\.com/);
    assert.equal(result.envelope.externalUrl, result.envelope.result.linkback);
  });

  it('same title in a different space is not treated as a duplicate', async () => {
    const transport = createFakeConfluenceTransport();
    transport.seedPage({ spaceId: 'ENG', title: 'Shared title' });
    const provider = createGovernedConfluenceProvider({ confluenceTransport: transport });

    const result = await writeWithEnvelope({
      provider, config: {},
      payload: { type: 'page', spaceId: 'DOCS', title: 'Shared title', body: '<p>x</p>' },
    });

    assert.equal(result.status, 'sent');
    assert.equal(result.envelope.result.type, 'page-created');
    assert.equal(transport.getPages().length, 2);
  });
});

describe('Confluence page update through the governed envelope', () => {
  it('updates a page at the current version', async () => {
    const transport = createFakeConfluenceTransport();
    const seeded = transport.seedPage({ spaceId: 'ENG', title: 'Living doc', body: '<p>v1</p>', version: 1 });
    const provider = createGovernedConfluenceProvider({ confluenceTransport: transport });

    const result = await writeWithEnvelope({
      provider, config: {},
      payload: { type: 'page-update', pageId: seeded.id, title: 'Living doc', body: '<p>v2</p>', version: 1 },
    });

    assert.equal(result.status, 'sent');
    assert.equal(result.envelope.result.type, 'page-updated');
    assert.equal(result.envelope.result.version, 2);
    assert.equal(transport.getPages()[0].body, '<p>v2</p>');
  });

  it('version-conflict recovery: refetches the live page and returns a retryPayload instead of overwriting', async () => {
    const transport = createFakeConfluenceTransport();
    const seeded = transport.seedPage({ spaceId: 'ENG', title: 'Living doc', body: '<p>v1</p>', version: 1 });
    const provider = createGovernedConfluenceProvider({ confluenceTransport: transport });

    // Simulate a concurrent external edit: the page moves to version 2
    // underneath the caller, who is still holding a stale version: 1.
    await transport.updatePage({ pageId: seeded.id, title: 'Living doc', body: '<p>concurrent edit</p>', version: 1 });

    const result = await writeWithEnvelope({
      provider, config: {},
      payload: { type: 'page-update', pageId: seeded.id, title: 'Living doc', body: '<p>stale rewrite</p>', version: 1 },
    });

    assert.equal(result.status, 'sent', 'the envelope surfaces the conflict as a structured result, not a thrown error');
    assert.equal(result.envelope.result.type, 'version-conflict');
    assert.equal(result.envelope.result.currentVersion, 2);
    assert.equal(result.envelope.result.currentBody, '<p>concurrent edit</p>');
    assert.equal(transport.getPages()[0].body, '<p>concurrent edit</p>', 'the live page must not be overwritten by the stale write');

    const retry = result.envelope.result.retryPayload;
    assert.equal(retry.type, 'page-update');
    assert.equal(retry.pageId, seeded.id);
    assert.equal(retry.version, 2, 're-render must target the fresh version for re-approval');

    // Re-approve: retrying with the refreshed payload now succeeds.
    const second = await writeWithEnvelope({
      provider, config: {},
      payload: { ...retry, body: '<p>re-rendered rewrite</p>' },
    });

    assert.equal(second.status, 'sent');
    assert.equal(second.envelope.result.type, 'page-updated');
    assert.equal(second.envelope.result.version, 3);
    assert.equal(transport.getPages()[0].body, '<p>re-rendered rewrite</p>');
  });
});

describe('Confluence writes: scope and permission error mapping', () => {
  it('scope-denied on page create maps to an actionable Forbidden message naming the space', async () => {
    const transport = createFakeConfluenceTransport();
    transport.setMode('scope-denied');
    const provider = createGovernedConfluenceProvider({ confluenceTransport: transport });

    const result = await writeWithEnvelope({
      provider, config: {},
      payload: { type: 'page', spaceId: 'ENG', title: 'Blocked page', body: '<p>x</p>' },
    });

    assert.equal(result.status, 'error');
    assert.match(result.envelope.error, /Forbidden.*space "ENG"/i);
    assert.match(result.envelope.error, /confluence-content:write/i);
  });

  it('scope-denied on page update maps to an actionable Forbidden message naming the page', async () => {
    const transport = createFakeConfluenceTransport();
    const seeded = transport.seedPage({ spaceId: 'ENG', title: 'Living doc', version: 1 });
    transport.setMode('scope-denied');
    const provider = createGovernedConfluenceProvider({ confluenceTransport: transport });

    const result = await writeWithEnvelope({
      provider, config: {},
      payload: { type: 'page-update', pageId: seeded.id, title: 'Living doc', body: '<p>x</p>', version: 1 },
    });

    assert.equal(result.status, 'error');
    assert.match(result.envelope.error, new RegExp(`Forbidden.*page "${seeded.id}"`, 'i'));
  });

  it('unsupported write types are rejected rather than silently forwarded', async () => {
    const transport = createFakeConfluenceTransport();
    const provider = createGovernedConfluenceProvider({ confluenceTransport: transport });

    const result = await writeWithEnvelope({
      provider, config: {},
      payload: { type: 'comment', pageId: '1', body: 'x' },
    });

    assert.equal(result.status, 'error');
    assert.match(result.envelope.error, /unsupported type "comment"/i);
  });
});

describe('Confluence writes: audit trail and dry-run', () => {
  it('audit trail: sent-log records the linkback for a successful page write', async () => {
    const transport = createFakeConfluenceTransport();
    const provider = createGovernedConfluenceProvider({ confluenceTransport: transport });
    const sentLog = new WriteSentLog();

    await writeWithEnvelope({
      provider, config: {}, sentLog,
      payload: { type: 'page', spaceId: 'ENG', title: 'Audited page', body: '<p>x</p>' },
      idempotencyKey: 'confluence-audit-1',
    });

    const record = sentLog.findByIdempotencyKey('confluence-audit-1');
    assert.equal(record.status, 'sent');
    assert.match(record.externalUrl, /^https:\/\/confluence\.example\.com\//);
  });

  it('dry-run through the envelope returns the rendered payload without touching search or the transport', async () => {
    const transport = createFakeConfluenceTransport();
    const provider = createGovernedConfluenceProvider({ confluenceTransport: transport });

    const result = await writeWithEnvelope({
      provider, config: {},
      dryRun: true,
      payload: { type: 'page', spaceId: 'ENG', title: 'Dry run me', body: '<p>preview</p>' },
    });

    assert.equal(result.status, 'dry-run');
    assert.equal(transport.searchCallCount(), 0, 'dry-run must not touch search');
    assert.equal(transport.createCallCount(), 0, 'dry-run must not touch the transport');
    assert.equal(result.envelope.payload.type, 'page');
  });

  it('renderDryRun produces the storage-format body for a page create', () => {
    const transport = createFakeConfluenceTransport();
    const provider = createGovernedConfluenceProvider({ confluenceTransport: transport });

    const rendered = provider.renderDryRun({
      type: 'page', spaceId: 'ENG', title: 'Reviewable page', body: '<p>content</p>',
    });

    assert.equal(rendered.fields.spaceId, 'ENG');
    assert.equal(rendered.fields.body.representation, 'storage');
    assert.equal(rendered.fields.body.value, '<p>content</p>');
  });

  it('renderDryRun produces the storage-format body and version for a page update', () => {
    const transport = createFakeConfluenceTransport();
    const provider = createGovernedConfluenceProvider({ confluenceTransport: transport });

    const rendered = provider.renderDryRun({
      type: 'page-update', pageId: '42', title: 'Reviewable update', body: '<p>new content</p>', version: 3,
    });

    assert.equal(rendered.fields.pageId, '42');
    assert.equal(rendered.fields.version.number, 3);
    assert.equal(rendered.fields.body.value, '<p>new content</p>');
  });
});
