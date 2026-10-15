/**
 * tests/kernel/project/urls.test.ts — one reading of a web address: the same
 * page written different ways reads the same, anything that is not http(s)
 * is not an address, and an address carrying credentials is not kept.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normalizeUrl, urlCarriesCredentials, urlProblem } from '../../../src/kernel/project/urls.ts';

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

test('provider normalization is bounded by host, permalink path and identity fields', () => {
  const slack='https://acme.slack.com/archives/C123/p1729000000000100';
  const jira='https://acme.atlassian.net/browse/APP-42';
  assert.equal(normalizeUrl(`${slack}?thread_ts=1728999000.000100&cid=C123`),slack);
  assert.equal(normalizeUrl(`${jira}?atlOrigin=copy`),jira);
  assert.equal(normalizeUrl(`<${slack}|a label>`),slack);
  assert.equal(normalizeUrl(`[a label](${jira})`),jira);
  assert.equal(normalizeUrl(`<${jira}>`),jira);
  for(const url of [jira,slack,'https://github.com/acme/repo/issues/42']) {
    assert.notEqual(normalizeUrl(`${url}#comment-99`),normalizeUrl(url));
    assert.notEqual(normalizeUrl(`${url}?focusedCommentId=99`),normalizeUrl(url));
  }
  for(const url of ['https://slack.com.evil.example/archives/C123/p1729000000000100','https://acme.slack.com/search','https://custom-jira.example/browse/APP-42','https://acme.atlassian.net/wiki/pages/42']) {
    assert.notEqual(normalizeUrl(`${url}?thread_ts=1&atlOrigin=copy`),normalizeUrl(url));
  }
  for(const url of [`${jira}?atlOrigin=ghp_${'a1B2c3D4e5F6g7H8i9J0'.repeat(2)}`,`${slack}?access_token=ghp_${'a1B2c3D4e5F6g7H8i9J0'.repeat(2)}`,`https://user:password@acme.slack.com/archives/C123/p1729000000000100`]) assert.equal(normalizeUrl(url),null);
  assert.equal(urlProblem(`<${jira}>`),'is not an http(s) address','stored URLs remain plain addresses');
});

test('URL credential policy follows parsed userinfo and encoded ASCII signatures', () => {
  const body = 'a1B2c3D4e5F6g7H8i9J0'.repeat(2);
  const base = 'https://wiki.example/page';
  for (const ref of [
    'https://user:fake\tpassword@wiki.example/page',
    'https://user:fake\npassword@wiki.example/page',
    'https://user@wiki.example/page',
    'https://:password@wiki.example/page',
    `${base}#%67hp_${body}`,
    `${base}#token=%67%68%70%5f${body}`,
    `${base}#%67hp_${body}%`,
    `${base}#%FF%67hp_${body}`,
    `${base}?token=%67hp_${body}%`,
    `${base}?%67hp_${body}=value`,
    `https://acme.atlassian.net/browse/APP-42?atlOrigin=%67hp_${body}`,
  ]) {
    assert.match(urlProblem(ref)!, /carries credentials/, ref);
    assert.equal(normalizeUrl(ref), null, ref);
  }
  for (const ref of [
    `${base}#ordinary%20heading`, `${base}#ordinary%`, `${base}#ordinary%FF`,
    `${base}?filter=ordinary%20value`, `${base}?filter=ordinary%`, `${base}?filter=ordinary%FF`,
    `https://wiki.example/Risk-Assessment-sk-${'a'.repeat(25)}`,
  ]) {
    assert.equal(urlProblem(ref), null, ref);
    assert.notEqual(normalizeUrl(ref), null, ref);
  }
});

test('credential inspection shares complete URL presentation parsing without reading labels or opaque refs', () => {
  const unsafe = `https://wiki.example/page#%67hp_${'a1B2c3D4e5F6g7H8i9J0'.repeat(2)}`;
  for (const ref of [unsafe, `<${unsafe}>`, `<${unsafe}|policy>`, `[policy](${unsafe})`, 'https://user:fake\tpassword@wiki.example/page']) {
    assert.equal(urlCarriesCredentials(ref), true, ref);
  }
  for (const ref of ['APP-42', 'docs/Review Notes.md', 'chat:message', `opaque:${unsafe}`, `[${unsafe}](https://wiki.example/page)`, `<https://wiki.example/page|${unsafe}>`, `https://wiki.example/page#%2567hp_${'a1B2c3D4e5F6g7H8i9J0'.repeat(2)}`, `https://wiki.example/page?token=%2567hp_${'a1B2c3D4e5F6g7H8i9J0'.repeat(2)}`]) {
    assert.equal(urlCarriesCredentials(ref), false, ref);
  }
});
