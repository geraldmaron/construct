/**
 * tests/hosts/mcp/interactive.test.ts — semantic interactive MCP over v1 state.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { initializeProject } from '../../../src/kernel/project/initialize.ts';
import { resolveProjectContext } from '../../../src/kernel/project/context.ts';
import {
  createInteractiveHandler,
  INTERACTIVE_TOOLS,
  projectHasV1State,
  sessionFromBinding,
} from '../../../src/hosts/mcp/interactive.ts';
import type { JsonRpcRequest } from '../../../src/hosts/mcp/jsonrpc.ts';

test('projectHasV1State is true only after init', () => {
  const root = mkdtempSync(join(process.cwd(), '.tmp-interactive-'));
  try {
    assert.equal(projectHasV1State(root), false);
    const store = initializeProject(resolveProjectContext({ cwd: root, allowCwdFallback: true })).store;
    store.close();
    assert.equal(projectHasV1State(root), true);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('interactive MCP start_run → next_work → submit_work leaves draft', async () => {
  const root = mkdtempSync(join(process.cwd(), '.tmp-interactive-'));
  try {
    const init = initializeProject(resolveProjectContext({ cwd: root, allowCwdFallback: true }));
    const handle = createInteractiveHandler({
      store: init.store,
      projectRoot: root,
      clock: () => '2026-08-31T12:00:00.000Z',
      serverVersion: 'test',
      session: sessionFromBinding({ client: 'cursor', projectRoot: root }),
    });

    const initReply = await handle({
      jsonrpc: '2.0',
      id: 1,
      method: 'initialize',
      params: {},
    } as JsonRpcRequest);
    assert.ok(initReply);
    assert.equal(
      (initReply as { result: { serverInfo: { name: string } } }).result.serverInfo.name,
      'construct-interactive',
    );

    const listed = await handle({
      jsonrpc: '2.0',
      id: 2,
      method: 'tools/list',
      params: {},
    } as JsonRpcRequest);
    const tools = (listed as { result: { tools: Array<{ name: string }> } }).result.tools.map(
      (t) => t.name,
    );
    for (const name of INTERACTIVE_TOOLS.map((t) => t.name)) {
      assert.ok(tools.includes(name), name);
    }

    const started = await handle({
      jsonrpc: '2.0',
      id: 3,
      method: 'tools/call',
      params: {
        name: 'start_run',
        arguments: {
          outcome: 'Ship the interactive path',
          concerns: [{ domain: 'system-design', why: 'architecture cutover' }],
          tasks: [{ role: 'implementer', brief: { do: 'wire MCP' } }],
        },
      },
    } as JsonRpcRequest);
    const startBody = JSON.parse(
      (started as { result: { content: Array<{ text: string }> } }).result.content[0]!.text,
    ) as { run: string; tasksQueued: number };
    assert.equal(startBody.tasksQueued, 1);

    const claimed = await handle({
      jsonrpc: '2.0',
      id: 4,
      method: 'tools/call',
      params: { name: 'next_work', arguments: {} },
    } as JsonRpcRequest);
    const claimBody = JSON.parse(
      (claimed as { result: { content: Array<{ text: string }> } }).result.content[0]!.text,
    ) as { claimed: boolean; task: string };
    assert.equal(claimBody.claimed, true);

    const submitted = await handle({
      jsonrpc: '2.0',
      id: 5,
      method: 'tools/call',
      params: {
        name: 'submit_work',
        arguments: { task: claimBody.task, deliverable: { text: 'done' } },
      },
    } as JsonRpcRequest);
    const submitBody = JSON.parse(
      (submitted as { result: { content: Array<{ text: string }> } }).result.content[0]!.text,
    ) as {
      ok: boolean;
      taskState: string;
      deliverable: { trustState: string } | null;
    };
    assert.equal(submitBody.ok, true);
    assert.equal(submitBody.taskState, 'done');
    assert.equal(submitBody.deliverable?.trustState, 'draft');

    const raised = await handle({
      jsonrpc: '2.0',
      id: 6,
      method: 'tools/call',
      params: {
        name: 'raise_decision',
        arguments: {
          kind: 'requires_decision',
          question: 'Ship this week?',
          run: startBody.run,
        },
      },
    } as JsonRpcRequest);
    const raiseBody = JSON.parse(
      (raised as { result: { content: Array<{ text: string }> } }).result.content[0]!.text,
    ) as { id: string };
    assert.ok(raiseBody.id);

    const decided = await handle({
      jsonrpc: '2.0',
      id: 7,
      method: 'tools/call',
      params: {
        name: 'decide',
        arguments: { id: raiseBody.id, resolution: 'Yes, ship.' },
      },
    } as JsonRpcRequest);
    const decideBody = JSON.parse(
      (decided as { result: { content: Array<{ text: string }> } }).result.content[0]!.text,
    ) as { decided: string; state: string };
    assert.equal(decideBody.decided, raiseBody.id);
    assert.equal(decideBody.state, 'resolved');

    init.store.close();
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
