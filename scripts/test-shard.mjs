/**
 * scripts/test-shard.mjs — pure shard-spec parsing and file striping for
 * scripts/run-tests.mjs (`--shard <i>/<n>`).
 *
 * Striping, not chunking: the runner's file list is sorted, so heavy suites
 * cluster in contiguous directory blocks (tests/functional, tests/visual). A
 * chunked split would hand one shard the whole functional block; striping
 * (`idx % n === i - 1`) spreads each block across every shard. By construction
 * the shards are pairwise disjoint, their union is the full list, and their
 * sizes differ by at most one — tests/scripts/run-tests-shard.test.mjs asserts
 * all three invariants.
 *
 * Kept separate from run-tests.mjs so the unit test can import these helpers
 * without executing the runner's top-level side effects (env scrubbing, test
 * enumeration, spawning `node --test`).
 */

export function parseShardSpec(value) {
  const match = typeof value === "string" ? value.match(/^(\d+)\/(\d+)$/) : null;
  if (!match) {
    throw new Error(`Invalid --shard spec "${value}": expected <i>/<n>, e.g. --shard=2/3`);
  }
  const index = Number(match[1]);
  const total = Number(match[2]);
  if (index < 1 || total < 1 || index > total) {
    throw new Error(`Invalid --shard spec "${value}": shard index must satisfy 1 <= i <= n`);
  }
  return { index, total };
}

// Consumes `--shard=i/n` and the two-token `--shard i/n` form, splicing every
// occurrence out of `args` so nothing leaks through to `node --test`. The last
// occurrence in argv wins, matching how repeated CLI flags usually resolve.

export function parseShardArgs(args) {
  let spec = null;
  for (let i = args.length - 1; i >= 0; i--) {
    const arg = args[i];
    if (typeof arg !== "string") continue;
    if (arg === "--shard") {
      const value = args[i + 1];
      args.splice(i, i + 1 < args.length ? 2 : 1);
      spec = spec ?? parseShardSpec(value);
    } else if (arg.startsWith("--shard=")) {
      const value = arg.slice("--shard=".length);
      args.splice(i, 1);
      spec = spec ?? parseShardSpec(value);
    }
  }
  return spec;
}

export function stripeFiles(files, index, total) {
  return files.filter((_, idx) => idx % total === index - 1);
}
