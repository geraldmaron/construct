/**
 * tests/cli/source-relations.test.ts — how a user says two of their sources
 * stand to each other, through the commands they actually type.
 *
 * Two paths reach the same table and only one of them is a person typing. So
 * both are walked here end to end: `source relate` states a relationship
 * outright, and `propose relation` files one a model noticed as a row that is
 * still nothing until a decision is recorded about it. The second half is the
 * one worth being strict about — the failure it exists to prevent is a
 * relationship that quietly reshapes every later dispatch's ground with nobody
 * having said yes to it.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { decide, propose, source } from '../../src/cli/index.ts';
import { openStore } from '../../src/kernel/store/open.ts';
import { sourcesFor, setWriteConsent } from '../../src/kernel/store/sources.ts';
import { sourceEdgesFor } from '../../src/kernel/store/source-edges.ts';
import { sterileHome } from '../harness/sterile.ts';

sterileHome();

interface Capture {
  readonly code: number;
  readonly out: string;
  readonly err: string;
}

type Step = () => number | Promise<number>;

async function runAll(sequence: readonly Step[]): Promise<Capture> {
  const root = mkdtempSync(join(tmpdir(), 'construct-relations-cli-'));
  const previous = process.env.XDG_DATA_HOME;
  process.env.XDG_DATA_HOME = join(root, 'share');
  const out: string[] = [];
  const err: string[] = [];
  const realOut = process.stdout.write.bind(process.stdout);
  const realErr = process.stderr.write.bind(process.stderr);
  (process.stdout as { write: unknown }).write = (c: string) => (out.push(String(c)), true);
  (process.stderr as { write: unknown }).write = (c: string) => (err.push(String(c)), true);
  let code = 0;
  try {
    for (const step of sequence) code = await step();
    return { code, out: out.join(''), err: err.join('') };
  } finally {
    (process.stdout as { write: unknown }).write = realOut;
    (process.stderr as { write: unknown }).write = realErr;
    if (previous === undefined) delete process.env.XDG_DATA_HOME;
    else process.env.XDG_DATA_HOME = previous;
    rmSync(root, { recursive: true, force: true });
  }
}

function inStore<T>(fn: (store: ReturnType<typeof openStore>) => T): T {
  const store = openStore(join(process.env.XDG_DATA_HOME as string, 'construct', 'construct.db'));
  try {
    return fn(store);
  } finally {
    store.close();
  }
}

function ground(name: string): string {
  const dir = mkdtempSync(join(tmpdir(), `construct-relations-${name}-`));
  writeFileSync(join(dir, `${name}.md`), `# ${name}\n\nfixture content.\n`);
  return dir;
}

/** The two declared sources, oldest first, as the store holds them. */
function ids(): [string, string] {
  return inStore((store) => {
    const rows = sourcesFor(store, 'ops');
    return [rows[0].id, rows[1].id];
  });
}

function twoSources(a: string, b: string): Step[] {
  return [
    () => source(['add', '--kind=directory', `--locator=${a}`, '--workspace=ops']),
    () => source(['add', '--kind=directory', `--locator=${b}`, '--workspace=ops']),
  ];
}

test('a relationship is stated, listed back in the user\'s own words, and retired', async () => {
  const strategy = ground('strategy');
  const repo = ground('repo');
  try {
    const { code, out } = await runAll([
      ...twoSources(strategy, repo),
      () => {
        const [from, to] = ids();
        return source([
          'relate',
          `--from=${from}`,
          `--to=${to}`,
          '--as=governs',
          '--note=the strategy sets what the repo is held to',
          '--workspace=ops',
        ]);
      },
      () => source(['relations', '--workspace=ops']),
      () => {
        const id = inStore((store) => sourceEdgesFor(store, 'ops')[0].id);
        return source(['unrelate', `--id=${id}`]);
      },
      () => source(['relations', '--workspace=ops']),
      () => source(['relations', '--workspace=ops', '--all']),
    ]);
    assert.equal(code, 0);
    assert.match(out, new RegExp(`${strategy} governs ${repo} {2}— the strategy sets what the repo`));
    assert.match(out, /ground: Both ends travel together into every dispatch that carries either/);
    assert.match(out, /no relationships declared for workspace ops/);
    assert.match(out, /\(retired 20/, 'a retired relationship stays readable');
  } finally {
    rmSync(strategy, { recursive: true, force: true });
    rmSync(repo, { recursive: true, force: true });
  }
});

test('relate refuses a word outside the vocabulary and a source pointed at itself', async () => {
  const strategy = ground('strategy');
  const repo = ground('repo');
  try {
    const { err } = await runAll([
      ...twoSources(strategy, repo),
      () => {
        const [from, to] = ids();
        return source(['relate', `--from=${from}`, `--to=${to}`, '--as=informs']);
      },
      () => {
        const [from] = ids();
        return source(['relate', `--from=${from}`, `--to=${from}`, '--as=governs', '--workspace=ops']);
      },
    ]);
    assert.match(err, /construct source relate/, 'an unknown word gets the usage, not a row');
    assert.match(err, /does not stand in a relationship to itself/);
    // The plain sentence reaches the user, not the internal function that raised it.
    assert.doesNotMatch(err, /declareSourceEdge/);
  } finally {
    rmSync(strategy, { recursive: true, force: true });
    rmSync(repo, { recursive: true, force: true });
  }
});

test('a model-proposed relationship waits for a decision and is refused without one', async () => {
  const strategy = ground('strategy');
  const repo = ground('repo');
  try {
    const { out, err } = await runAll([
      ...twoSources(strategy, repo),
      () => {
        // Even with the workspace's standing yes to low-risk changes on the
        // record, this one is outside it: it reshapes what every later run is
        // assembled from.
        inStore((store) => {
          setWriteConsent(store, 'ops', true, new Date().toISOString());
        });
        const [from, to] = ids();
        return propose([
          'relation',
          `--from=${from}`,
          `--to=${to}`,
          '--as=supersedes',
          '--because=the newer plan names the older one as replaced',
          '--note=replaced at the Q3 review',
          '--workspace=ops',
        ]);
      },
      () => {
        inStore((store) => {
          assert.deepEqual(sourceEdgesFor(store, 'ops'), [], 'proposing made nothing live');
        });
        return 0;
      },
      async () => {
        const [from, to] = ids();
        return decide([`--apply=prop-supersedes-${from}-${to}`]);
      },
    ]);
    assert.match(out, /filed prop-supersedes-/);
    assert.match(err, /was not adopted.*no authority to apply/s);
    assert.match(err, /high-risk never applies on standing consent/);
  } finally {
    rmSync(strategy, { recursive: true, force: true });
    rmSync(repo, { recursive: true, force: true });
  }
});

test('an approved relationship is adopted, and needs no host to reach the user\'s own store', async () => {
  const strategy = ground('strategy');
  const repo = ground('repo');
  try {
    const { code, out } = await runAll([
      ...twoSources(strategy, repo),
      () => {
        const [from, to] = ids();
        return propose([
          'relation',
          `--from=${from}`,
          `--to=${to}`,
          '--as=covers-same-initiative',
          '--because=both describe the Q3 launch',
          '--workspace=ops',
        ]);
      },
      async () => {
        const [from, to] = ids();
        return decide([
          `--approve=prop-covers-same-initiative-${from}-${to}`,
          'yes',
          'these',
          'are',
          'one',
          'initiative',
        ]);
      },
      async () => {
        const [from, to] = ids();
        // No --host: the change lands in the user's own store.
        return decide([`--apply=prop-covers-same-initiative-${from}-${to}`]);
      },
      () => {
        const [from, to] = ids();
        inStore((store) => {
          const edges = sourceEdgesFor(store, 'ops');
          assert.equal(edges.length, 1);
          assert.equal(edges[0].relation, 'covers-same-initiative');
          assert.equal(edges[0].from, from);
          assert.equal(edges[0].to, to);
        });
        return 0;
      },
    ]);
    assert.equal(code, 0);
    assert.match(out, /adopted prop-covers-same-initiative-.* as rel-prop-/);
  } finally {
    rmSync(strategy, { recursive: true, force: true });
    rmSync(repo, { recursive: true, force: true });
  }
});

test('a relationship still in play is not proposed twice', async () => {
  const strategy = ground('strategy');
  const repo = ground('repo');
  const relate = (): Promise<number> => {
    const [from, to] = ids();
    return propose([
      'relation',
      `--from=${from}`,
      `--to=${to}`,
      '--as=supersedes',
      '--because=the newer plan names the older one as replaced',
      '--workspace=ops',
    ]);
  };
  try {
    const { code, out } = await runAll([
      ...twoSources(strategy, repo),
      relate,
      relate,
      () => {
        inStore((store) => {
          const waiting = store.db
            .prepare('SELECT COUNT(*) AS n FROM proposed_source_edges')
            .get() as { n: number };
          assert.equal(waiting.n, 1, 'the queue holds one row, not the same row twice');
        });
        return 0;
      },
    ]);
    assert.equal(code, 0);
    assert.match(out, /already proposed as prop-supersedes-.*, and it is still waiting for your decision/);
  } finally {
    rmSync(strategy, { recursive: true, force: true });
    rmSync(repo, { recursive: true, force: true });
  }
});

/**
 * The dead end this covers: an id derived from the pair and the word is the
 * right way to keep the queue from filling with one row twice, and the wrong
 * way to decide whether a pair may ever be proposed again. A relationship that
 * was adopted and later retired is a statement whose life is over, and the
 * second look that reaches it again is about ground that has moved since.
 */
test('a relationship adopted and since retired can be proposed again', async () => {
  const strategy = ground('strategy');
  const repo = ground('repo');
  const relate = (): Promise<number> => {
    const [from, to] = ids();
    return propose([
      'relation',
      `--from=${from}`,
      `--to=${to}`,
      '--as=supersedes',
      '--because=the newer plan names the older one as replaced',
      '--workspace=ops',
    ]);
  };
  try {
    const { code, out } = await runAll([
      ...twoSources(strategy, repo),
      relate,
      async () => {
        const [from, to] = ids();
        return decide([`--approve=prop-supersedes-${from}-${to}`, 'yes,', 'it', 'is', 'replaced']);
      },
      async () => {
        const [from, to] = ids();
        return decide([`--apply=prop-supersedes-${from}-${to}`]);
      },
      () => {
        // While it stands, proposing it again is correctly refused as settled.
        return 0;
      },
      relate,
      () => {
        const id = inStore((store) => sourceEdgesFor(store, 'ops')[0].id);
        return source(['unrelate', `--id=${id}`]);
      },
      relate,
      () => {
        inStore((store) => {
          const rows = store.db
            .prepare('SELECT proposal FROM proposed_source_edges ORDER BY proposal')
            .all() as unknown as { proposal: string }[];
          assert.equal(rows.length, 2, 'the second look is its own row, not a swallowed no-op');
        });
        return 0;
      },
    ]);
    assert.equal(code, 0);
    assert.match(out, /this relationship already stands as rel-prop-supersedes-/);
    assert.match(out, /filed prop-supersedes-.*-\d{17}\./, 'the second filing got an id of its own');
  } finally {
    rmSync(strategy, { recursive: true, force: true });
    rmSync(repo, { recursive: true, force: true });
  }
});

/**
 * The chained dead end: a proposal rejected once keeps its rejection forever,
 * so when a retry under a fresh id is later adopted, only the relationship
 * itself can say the pair is settled. Asking the original stem's history
 * instead files a third row for an edge that already stands, and the decision
 * that tries to carry it out dies on the schema's unique index.
 */
test('a relationship adopted under a retry id is not proposed a third time', async () => {
  const strategy = ground('strategy');
  const repo = ground('repo');
  const relate = (): Promise<number> => {
    const [from, to] = ids();
    return propose([
      'relation',
      `--from=${from}`,
      `--to=${to}`,
      '--as=supersedes',
      '--because=the newer plan names the older one as replaced',
      '--workspace=ops',
    ]);
  };
  const retryId = (): string =>
    inStore((store) => {
      const rows = store.db
        .prepare('SELECT proposal FROM proposed_source_edges ORDER BY proposal DESC')
        .all() as unknown as { proposal: string }[];
      return rows[0].proposal;
    });
  try {
    const { code, out } = await runAll([
      ...twoSources(strategy, repo),
      relate,
      async () => {
        const [from, to] = ids();
        return decide([`--reject=prop-supersedes-${from}-${to}`, 'not', 'yet']);
      },
      relate,
      () => decide([`--approve=${retryId()}`, 'yes,', 'it', 'is', 'replaced']),
      () => decide([`--apply=${retryId()}`]),
      relate,
      () => {
        inStore((store) => {
          const rows = store.db
            .prepare('SELECT COUNT(*) AS n FROM proposed_source_edges')
            .get() as { n: number };
          assert.equal(rows.n, 2, 'the standing relationship did not gain a third row');
          const live = sourceEdgesFor(store, 'ops');
          assert.equal(live.length, 1, 'exactly one relationship stands');
        });
        return 0;
      },
    ]);
    assert.equal(code, 0);
    assert.match(out, /this relationship already stands as rel-prop-supersedes-.*-\d{17}/);
  } finally {
    rmSync(strategy, { recursive: true, force: true });
    rmSync(repo, { recursive: true, force: true });
  }
});

/**
 * The same settlement holds when the user said it themselves: a relationship
 * declared outright needs no proposal, and a model re-noticing it should be
 * told it stands rather than fed into the queue.
 */
test('a relationship the user declared directly is not proposable at all', async () => {
  const strategy = ground('strategy');
  const repo = ground('repo');
  try {
    const { code, out } = await runAll([
      ...twoSources(strategy, repo),
      () => {
        const [from, to] = ids();
        return source(['relate', `--from=${from}`, `--to=${to}`, '--as=supersedes', '--workspace=ops']);
      },
      () => {
        const [from, to] = ids();
        return propose([
          'relation',
          `--from=${from}`,
          `--to=${to}`,
          '--as=supersedes',
          '--because=the newer plan names the older one as replaced',
          '--workspace=ops',
        ]);
      },
      () => {
        inStore((store) => {
          const rows = store.db
            .prepare('SELECT COUNT(*) AS n FROM proposed_source_edges')
            .get() as { n: number };
          assert.equal(rows.n, 0, 'nothing entered the queue for a declared relationship');
        });
        return 0;
      },
    ]);
    assert.equal(code, 0);
    assert.match(out, /the replaced source will be withheld from dispatches that carry its replacement/);
    assert.match(out, /this relationship already stands as rel-\d/);
  } finally {
    rmSync(strategy, { recursive: true, force: true });
    rmSync(repo, { recursive: true, force: true });
  }
});
