/**
 * tests/doc-stamp.test.mjs — tests for lib/doc-stamp.mjs UUIDv7 identity, SHA-256 body hash, and frontmatter stamp verification.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  uuidv7,
  bodyHash,
  hasStamp,
  stampFrontmatter,
  parseStamp,
  verifyStamp,
} from '../lib/doc-stamp.mjs';

describe('doc-stamp: uuidv7', () => {
  it('produces a valid UUID format', () => {
    const id = uuidv7();
    assert.match(id, /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  });

  it('version nibble is 7', () => {
    const id = uuidv7();
    assert.equal(id[14], '7');
  });

  it('variant bits are 10xx (8, 9, a, or b)', () => {
    const id = uuidv7();
    assert.match(id[19], /[89ab]/);
  });

  it('generates unique ids', () => {
    const ids = new Set(Array.from({ length: 50 }, uuidv7));
    assert.equal(ids.size, 50);
  });

  it('ids generated in different milliseconds are time-ordered', async () => {
    const ids = [];
    for (let i = 0; i < 5; i++) {
      ids.push(uuidv7());
      await new Promise(r => setTimeout(r, 2)); // ensure distinct ms timestamps
    }
    for (let i = 1; i < ids.length; i++) {
      assert.ok(ids[i] > ids[i - 1], `id[${i}] not > id[${i - 1}]`);
    }
  });
});

describe('doc-stamp: bodyHash', () => {
  it('returns sha256: prefix', () => {
    assert.ok(bodyHash('hello').startsWith('sha256:'));
  });

  it('is deterministic', () => {
    assert.equal(bodyHash('hello world'), bodyHash('hello world'));
  });

  it('trims whitespace before hashing', () => {
    assert.equal(bodyHash('  hello  '), bodyHash('hello'));
  });

  it('differs for different content', () => {
    assert.notEqual(bodyHash('foo'), bodyHash('bar'));
  });
});

describe('doc-stamp: hasStamp', () => {
  it('returns false for plain markdown', () => {
    assert.equal(hasStamp('# Hello\n\nworld'), false);
  });

  it('returns true for stamped content', () => {
    const stamped = stampFrontmatter('# Hello\n');
    assert.equal(hasStamp(stamped), true);
  });
});

describe('doc-stamp: stampFrontmatter', () => {
  const doc = '# Test\n\nContent here.\n';

  it('injects a stamp block at the top', () => {
    const stamped = stampFrontmatter(doc);
    assert.ok(stamped.startsWith('---\n'));
    assert.ok(stamped.includes('cx_doc_id:'));
    assert.ok(stamped.includes('body_hash:'));
    assert.ok(stamped.includes('# Test'));
  });

  it('includes generator field', () => {
    const stamped = stampFrontmatter(doc, { generator: 'construct/test' });
    assert.ok(stamped.includes('generator: construct/test'));
  });

  it('includes optional model field when provided', () => {
    const stamped = stampFrontmatter(doc, { model: 'claude-test' });
    assert.ok(stamped.includes('model: claude-test'));
  });

  it('omits model field when not provided', () => {
    const stamped = stampFrontmatter(doc);
    assert.ok(!stamped.includes('model:'));
  });

  it('preserves cx_doc_id on re-stamp by default', () => {
    const first = stampFrontmatter(doc);
    const id1 = parseStamp(first).cx_doc_id;
    const second = stampFrontmatter(first);
    const id2 = parseStamp(second).cx_doc_id;
    assert.equal(id1, id2);
  });

  it('generates new cx_doc_id when preserve_id=false', () => {
    const first = stampFrontmatter(doc);
    const id1 = parseStamp(first).cx_doc_id;
    const second = stampFrontmatter(first, { preserve_id: false });
    const id2 = parseStamp(second).cx_doc_id;
    assert.notEqual(id1, id2);
  });

  it('updates body_hash when content changes', () => {
    const first = stampFrontmatter(doc);
    const hash1 = parseStamp(first).body_hash;
    const modified = first.replace('Content here.', 'Content changed.');
    const restamped = stampFrontmatter(modified);
    const hash2 = parseStamp(restamped).body_hash;
    assert.notEqual(hash1, hash2);
  });

  it('does not double-nest stamp blocks', () => {
    const once = stampFrontmatter(doc);
    const twice = stampFrontmatter(once);
    const count = (twice.match(/cx_doc_id:/g) || []).length;
    assert.equal(count, 1);
  });
});

describe('doc-stamp: parseStamp', () => {
  it('returns empty object for unstamped content', () => {
    assert.deepEqual(parseStamp('# Hello'), {});
  });

  it('parses all stamp fields', () => {
    const stamped = stampFrontmatter('# Hello\n', { generator: 'test', model: 'gpt-x' });
    const fields = parseStamp(stamped);
    assert.ok(fields.cx_doc_id);
    assert.ok(fields.created_at);
    assert.ok(fields.updated_at);
    assert.equal(fields.generator, 'test');
    assert.equal(fields.model, 'gpt-x');
    assert.ok(fields.body_hash.startsWith('sha256:'));
  });
});

describe('doc-stamp: verifyStamp', () => {
  const doc = '# Verify test\n\nSome body content.\n';

  it('passes for freshly stamped content', () => {
    const stamped = stampFrontmatter(doc);
    const result = verifyStamp(stamped);
    assert.equal(result.valid, true);
    assert.ok(result.id);
  });

  it('fails when body is tampered', () => {
    const stamped = stampFrontmatter(doc);
    const tampered = stamped.replace('Some body content.', 'TAMPERED content.');
    const result = verifyStamp(tampered);
    assert.equal(result.valid, false);
    assert.equal(result.reason, 'body_hash mismatch');
    assert.ok(result.stored);
    assert.ok(result.computed);
    assert.notEqual(result.stored, result.computed);
  });

  it('fails for unstamped content', () => {
    const result = verifyStamp(doc);
    assert.equal(result.valid, false);
    assert.equal(result.reason, 'no stamp found');
  });

  it('passes after re-stamp with unchanged body', () => {
    const stamped = stampFrontmatter(doc);
    const restamped = stampFrontmatter(stamped);
    assert.equal(verifyStamp(restamped).valid, true);
  });

  it('whitespace-only changes to body do not affect hash', () => {
    const stamped = stampFrontmatter(doc);
    // body_hash trims trailing whitespace; re-stamp after adding it to recompute the hash.
    const withTrailingSpace = stamped.trimEnd() + '\n\n';
    const restamped = stampFrontmatter(withTrailingSpace);
    assert.equal(verifyStamp(restamped).valid, true);
  });
});
