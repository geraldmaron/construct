import { test } from 'node:test';
import assert from 'node:assert/strict';
import { TOOLS } from '../../../src/kernel/broker/tools.ts';
import { record, ToolInputError } from '../../../src/kernel/broker/definition.ts';
import { currentManifest } from '../../../src/kernel/source/manifest.ts';
import { brokerFixture, type BrokerFixture } from './support.ts';

async function call(fx: BrokerFixture, name: string, args: Record<string, unknown>): Promise<any> {
  const tool = TOOLS.find(t => t.name === name)!;
  return tool.run(fx.broker, tool.validate(record(args)));
}
const message = 'https://acme.slack.com/archives/C123/p1729000000000100';
const issue = 'https://acme.atlassian.net/browse/APP-42';
const passage = 'The rollout is approved.';

for (const surface of ['interactive', 'headless'] as const) test(`${surface} source reports preserve readable evidence and reject malformed text atomically`, async () => {
  const fx = brokerFixture(surface);
  try {
    await call(fx, 'sources', {action:'declare', id:'tracker', kind:'jira', locator:'APP'});
    for (const text of [{type:'doc', content:[]}, [{type:'text',text:passage}], 42, false]) {
      await assert.rejects(call(fx, 'sources', {action:'report', id:'tracker', items:[{ref:'valid',text:passage},{ref:'bad',text}]}), (e: unknown) => e instanceof ToolInputError && e.field === 'items[1].text' && /readable.*string/i.test(e.message));
      assert.equal(currentManifest(fx.broker.store,'tracker'),null);
    }
    await call(fx, 'sources', {action:'report', id:'tracker', items:[{ref:'APP-42',url:issue,text:passage}]});
    assert.equal(currentManifest(fx.broker.store,'tracker')?.[0]?.text,passage);
  } finally { fx.cleanup(); }
});

test('reported Jira, Slack and document evidence accepts full link wrappers and safe navigation variants', async () => {
  const fx = brokerFixture();
  try {
    await call(fx,'sources',{action:'declare',id:'tracker',kind:'jira',locator:'APP'});
    await call(fx,'sources',{action:'declare',id:'chat',kind:'other'});
    await call(fx,'sources',{action:'declare',id:'wiki',kind:'docs'});
    await call(fx,'sources',{action:'report',id:'tracker',items:[{ref:'APP-42',url:issue,text:passage}]});
    await call(fx,'sources',{action:'report',id:'chat',items:[{ref:'C123:1729000000.000100',url:message,text:passage}]});
    await call(fx,'sources',{action:'report',id:'wiki',items:[{ref:'policy',url:'https://wiki.example/view?pageId=42',text:passage}]});
    for(const ref of [issue,`${issue}?atlOrigin=copy`,message,`${message}?thread_ts=1728999000.000100&cid=C123`,`<${message}|approval>`,`[approval](${message})`,`<${issue}>`,`chat:<${message}|approval>`,`[policy](https://wiki.example/view?pageId=42)`]) {
      const r=await call(fx,'check_answer',{answer:passage,citations:[{ref,excerpt:passage}]});
      assert.equal(r.ok,true,JSON.stringify({ref,problems:r.problems}));
      assert.equal(r.evidence.reported,1);
      assert.equal(r.evidence.unverified,0);
    }
    for(const ref of [`${issue}?focusedCommentId=99`,`${message}?unknown=other`,'https://wiki.example/view?pageId=43','[approval](https://elsewhere.example/message)',`<${message}|approval> trailing`]) {
      assert.equal((await call(fx,'check_answer',{answer:passage,citations:[{ref}]})).ok,false,ref);
    }
    const wrong=await call(fx,'check_answer',{answer:passage,citations:[{ref:`<${message}|approval>`,excerpt:'The rollout is rejected.'}]});
    assert.equal(wrong.ok,false);
    assert.ok(wrong.problems.some((p:any)=>p.check==='excerpts_match'));
  } finally { fx.cleanup(); }
});

test('malformed excerpts cannot silently bypass quote checks on either public citation surface', () => {
  for(const [name, key, args] of [
    ['check_answer','citations',{answer:passage}],
    ['submit_work','evidence',{stepRunId:'step',token:'token',output:{}}],
  ] as const) {
    const tool=TOOLS.find(t=>t.name===name)!;
    for(const excerpt of [{text:'invented'}, ['invented'], false, 42]) {
      assert.throws(()=>tool.validate(record({...args,[key]:[{ref:'APP-42',excerpt}]})), (e:unknown)=>e instanceof ToolInputError && e.field===`${key}[0].excerpt`);
    }
  }
});

test('equivalent URL collisions refuse bare links and keep source-qualified evidence distinct', async () => {
  const fx=brokerFixture();
  try {
    for(const [id,url,text] of [['chat',message,passage],['mirror',`${message}?cid=C123&thread_ts=1`,'The rollout is rejected.']]) {
      await call(fx,'sources',{action:'declare',id,kind:'other'});
      await call(fx,'sources',{action:'report',id,items:[{ref:'message',url,text}]});
    }
    const ambiguous=await call(fx,'check_answer',{answer:passage,citations:[{ref:`<${message}|approval>`}]});
    assert.equal(ambiguous.ok,false);
    const scoped=await call(fx,'check_answer',{answer:passage,citations:[{ref:`chat:<${message}|approval>`,excerpt:passage}]});
    assert.equal(scoped.ok,true);
    const wrong=await call(fx,'check_answer',{answer:passage,citations:[{ref:`mirror:${message}`,excerpt:passage}]});
    assert.equal(wrong.ok,false);
  } finally { fx.cleanup(); }
});

test('malformed provider metadata is rejected before changing the manifest', async () => {
  const fx = brokerFixture();
  try {
    await call(fx, 'sources', { action: 'declare', id: 'chat', kind: 'other' });
    for (const [field, value] of [['weak', 'true'], ['schema', []], ['schema', 'json'], ['updatedAt', 1729000000], ['title', {}]] as const) {
      await assert.rejects(call(fx, 'sources', { action: 'report', id: 'chat', items: [{ ref: 'message', text: passage, [field]: value }] }), (error: unknown) => error instanceof ToolInputError && error.field === `items[0].${field}`);
      assert.equal(currentManifest(fx.broker.store, 'chat'), null);
    }
  } finally { fx.cleanup(); }
});

test('source reports identify impossible ISO dates before storing them and preserve unknown formats explicitly', async () => {
  const fx = brokerFixture();
  try {
    await call(fx, 'sources', { action: 'declare', id: 'tracker', kind: 'jira', locator: 'APP' });
    await assert.rejects(call(fx, 'sources', { action: 'report', id: 'tracker', items: [{ ref: 'APP-1', text: passage, updatedAt: '2026-02-30T12:00:00Z' }] }), (error: unknown) => error instanceof ToolInputError && error.field === 'items[0].updatedAt');
    assert.equal(currentManifest(fx.broker.store, 'tracker'), null);
    await call(fx, 'sources', { action: 'report', id: 'tracker', items: [{ ref: 'APP-1', text: passage, updatedAt: 'provider revision unknown' }] });
    const checked = await call(fx, 'check_answer', { answer: passage, citations: [{ ref: 'APP-1' }], period: { semantics: 'as_of', to: '2026-10-15' } });
    assert.equal(checked.ok, true);
    assert.deepEqual(checked.period.coverage.undated, ['APP-1']);
  } finally { fx.cleanup(); }
});

test('credential URL refusals preserve admitted evidence and cannot match a clean page', async () => {
  const fx = brokerFixture();
  try {
    const base = 'https://wiki.example/page';
    const body = 'a1B2c3D4e5F6g7H8i9J0'.repeat(2);
    await call(fx, 'sources', { action: 'declare', id: 'wiki', kind: 'docs' });
    await call(fx, 'sources', { action: 'report', id: 'wiki', items: [{ ref: 'policy', url: base, text: passage }] });
    const before = currentManifest(fx.broker.store, 'wiki');
    for (const url of [
      'https://user:fake\tpassword@wiki.example/page',
      `${base}#%67hp_${body}`, `${base}#%FF%67hp_${body}%`,
      `${base}?token=%67hp_${body}%`,
    ]) {
      await assert.rejects(call(fx, 'sources', { action: 'report', id: 'wiki', items: [{ ref: 'valid', text: 'Replacement.' }, { ref: 'bad', url, text: passage }] }), (e: unknown) => e instanceof ToolInputError && e.field === 'items[1].url' && /credentials/.test(e.message));
      assert.deepEqual(currentManifest(fx.broker.store, 'wiki'), before);
      assert.equal((await call(fx, 'check_answer', { answer: passage, citations: [{ ref: url, excerpt: passage }] })).ok, false);
    }
    assert.equal((await call(fx, 'check_answer', { answer: passage, citations: [{ ref: base, excerpt: passage }] })).ok, true);
  } finally { fx.cleanup(); }
});

test('credential URLs cannot enter through item refs or regain identity through exact matches', async () => {
  const fx = brokerFixture();
  try {
    await call(fx, 'sources', { action: 'declare', id: 'wiki', kind: 'docs' });
    await call(fx, 'sources', { action: 'report', id: 'wiki', items: [{ ref: 'clean', text: passage }] });
    const before = currentManifest(fx.broker.store, 'wiki');
    const dirty = 'https://user:synthetic-password@wiki.example/page';
    for (const ref of [dirty, `<${dirty}|page>`, `[page](${dirty})`]) {
      await assert.rejects(call(fx, 'sources', { action: 'report', id: 'wiki', items: [{ ref: 'valid', text: passage }, { ref, text: passage }] }), (e: unknown) => e instanceof ToolInputError && e.field === 'items[1].ref');
      assert.deepEqual(currentManifest(fx.broker.store, 'wiki'), before);
      for (const citation of [ref, `wiki:${ref}`]) assert.equal((await call(fx, 'check_answer', { answer: passage, citations: [{ ref: citation, excerpt: passage }] })).ok, false);
    }
  } finally { fx.cleanup(); }
});
