/**
 * tests/kernel/project/urls.test.ts — one reading of a web address: the same
 * page written different ways reads the same, anything that is not http(s)
 * is not an address, and an address carrying credentials is not kept.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normalizeUrl, urlProblem } from '../../../src/kernel/project/urls.ts';

test('the same page written different ways reads the same', () => {
  const page = 'https://wiki.example/pages/98765';
  for (const variant of ['https://wiki.example/pages/98765', 'http://wiki.example/pages/98765', 'HTTPS://Wiki.Example/pages/98765/', 'https://wiki.example:443/pages/98765#heading', '  https://wiki.example/pages/98765  ', 'http://wiki.example:80/pages/98765']) {
    assert.equal(normalizeUrl(variant), page, variant);
  }
  assert.equal(normalizeUrl('https://wiki.example'), 'https://wiki.example/', 'the root keeps its slash');
  assert.equal(normalizeUrl('https://wiki.example/view?pageId=98765#x'), 'https://wiki.example/view?pageId=98765', 'the query names the page and stays');
  assert.notEqual(normalizeUrl('https://wiki.example/Pages/98765'), page, 'a path keeps its case');
  assert.notEqual(normalizeUrl('https://wiki.example:8443/pages/98765'), page, 'a port that is not the default is part of the address');
});

test('anything that is not an http(s) address is not one', () => {
  for (const ref of ['', 'PLAT-101', 'jira:PLAT-101', 'docs/a.md', 'localhost:3000', 'ftp://files.example/a', 'file:///etc/passwd', 'mailto:a@b.example', 'javascript:alert(1)', 'https://']) {
    assert.equal(normalizeUrl(ref), null, ref);
    assert.equal(urlProblem(ref), 'is not an http(s) address', ref);
  }
  assert.equal(normalizeUrl(42 as unknown as string), null);
});

test('an address carrying credentials is not kept', () => {
  const BODY = 'a1B2c3D4e5F6g7H8i9J0';
  assert.equal(urlProblem('https://wiki.example/pages/98765'), null);
  assert.match(urlProblem('https://me:hunter2@wiki.example/p')!, /carries credentials/);
  assert.match(urlProblem(`https://wiki.example/p?access_token=ghp_${BODY}${BODY.slice(0, 4)}`)!, /carries credentials/);
  assert.equal(urlProblem('https://docs.example/document/d/1aB2cD3eF4gH5iJ6kL7mN8oP9qR0sT1uV2wX3yZ4/edit'), null, 'a long document id is an address, not a credential');
  assert.match(urlProblem(`https://wiki.example/p#access_token=ghp_${BODY}${BODY.slice(0, 4)}`)!, /carries credentials/, 'a token in the fragment');
  assert.match(urlProblem(`https://wiki.example/p?token=ghp%5F${BODY}${BODY.slice(0, 4)}`)!, /carries credentials/, 'a token percent-encoded in the query');
  for (const page of ['https://www.notion.so/acme/Risk-Assessment-for-Q3-Launch-1a2b3c4d5e6f7a8b9c0d1e2f3a4b5c6d', 'https://www.notion.so/acme/Task-Board-Platform-Migration-0f9e8d7c6b5a49382716a5b4c3d2e1f0', 'https://github.com/acme/task-management-service-backend/pull/12']) {
    assert.equal(urlProblem(page), null, `a page slug is a title, not a key: ${page}`);
  }
});
