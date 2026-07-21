/**
 * lib/runtime/contract/conformance.mjs — shared conformance suite for any
 * runtime adapter satisfying interface.mjs.
 *
 * Import and call runConformanceSuite(fixture) from an adapter's own test
 * file, mirroring lib/providers/contract/contract-tests.mjs's
 * runContractTests() shape for providers. A fixture supplies the
 * adapter-specific glue the suite needs to exercise generic runtime
 * properties without hardcoding any one adapter's request shape:
 *
 *   name              - string, describes the runtime under test
 *   createRuntime()   - () => a fresh, unconfigured runtime instance
 *   initConfig        - config object passed to runtime.init()
 *   invokeEcho(runtime) - async (runtime) => RuntimeResult for a request that
 *                       resolves quickly (well under SLOW_INVOKE_MIN_MS) and
 *                       deterministically
 *   invokeSlow(runtime, invocationId) - optional; (runtime, invocationId) =>
 *                       Promise<RuntimeResult> for a call that stays in
 *                       flight at least SLOW_INVOKE_MIN_MS, using the given
 *                       invocationId so cancel(invocationId) can target it.
 *                       Fixtures that omit this skip the cancel /
 *                       in-flight-safety cases rather than fake them.
 *   supportsInterrupt - boolean; must equal hasCapability(runtime, 'interrupt')
 *
 * The "an in-flight invocation finishes safely" case below is the required
 * conformance case named in this bead's spec, generalizing directive §11 F's
 * property (validated for one adapter by spike F's in-flight-safety harness:
 * docs/notes/research/workspace-control-plane/synthesis/spike-f-runtime-replacement.md)
 * from a one-off spike check into a property every runtime adapter must
 * demonstrate.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { validate, hasCapability, CAPABILITIES } from './interface.mjs';
import { RuntimeNotReadyError } from './errors.mjs';

const SLOW_INVOKE_MIN_MS = 150;

export function runConformanceSuite(fixture) {
  const { name, createRuntime, initConfig, invokeEcho, invokeSlow, supportsInterrupt } = fixture;

  describe(`Runtime contract: ${name}`, () => {
    it('satisfies the interface contract', () => {
      const runtime = createRuntime();
      const result = validate(runtime);
      assert.ok(result.valid, `Validation errors: ${result.errors.join('; ')}`);
    });

    it('declares a non-empty name and kind', () => {
      const runtime = createRuntime();
      assert.ok(typeof runtime.name === 'string' && runtime.name.length > 0);
      assert.ok(typeof runtime.kind === 'string' && runtime.kind.length > 0);
    });

    it('declares only known capabilities, matching the fixture\'s interrupt claim', () => {
      const runtime = createRuntime();
      for (const cap of runtime.capabilities) {
        assert.ok(CAPABILITIES.includes(cap), `Unknown capability: ${cap}`);
      }
      assert.equal(hasCapability(runtime, 'interrupt'), Boolean(supportsInterrupt));
    });

    it('rejects invoke() before init()', async () => {
      const runtime = createRuntime();
      await assert.rejects(
        () => runtime.invoke({ input: {} }, { invocationId: randomUUID() }),
        (err) => {
          assert.ok(err instanceof RuntimeNotReadyError, `expected RuntimeNotReadyError, got ${err}`);
          return true;
        },
      );
    });

    it('becomes healthy after init()', async () => {
      const runtime = createRuntime();
      await runtime.init(initConfig);
      const health = await runtime.health();
      assert.equal(health.live, true);
    });

    it('invoke() resolves a well-shaped RuntimeResult for a normal request', async () => {
      const runtime = createRuntime();
      await runtime.init(initConfig);
      const result = await invokeEcho(runtime);
      assert.equal(result.status, 'completed');
      assert.ok(typeof result.id === 'string' && result.id.length > 0);
      assert.equal(result.error, null);
    });

    it('cancel() on an unknown invocation id is a safe no-op', async () => {
      const runtime = createRuntime();
      await runtime.init(initConfig);
      const result = await runtime.cancel(`unknown-${randomUUID()}`);
      assert.equal(result.cancelled, false);
    });

    if (invokeSlow) {
      it('an in-flight invocation finishes safely despite an unrelated cancel()', async () => {
        const runtime = createRuntime();
        await runtime.init(initConfig);
        const invocationId = randomUUID();
        const inFlight = invokeSlow(runtime, invocationId);
        await runtime.cancel(`unrelated-${randomUUID()}`);
        const result = await inFlight;
        assert.equal(result.status, 'completed');
      });

      const label = supportsInterrupt
        ? 'cancel() interrupts an in-flight invocation when "interrupt" is declared'
        : 'cancel() safely no-ops on an in-flight invocation when "interrupt" is not declared';

      it(label, async () => {
        const runtime = createRuntime();
        await runtime.init(initConfig);
        const invocationId = randomUUID();
        const inFlight = invokeSlow(runtime, invocationId);
        await new Promise((resolve) => setTimeout(resolve, 20));
        const cancelResult = await runtime.cancel(invocationId);
        const result = await inFlight;

        if (supportsInterrupt) {
          assert.equal(cancelResult.cancelled, true);
          assert.equal(result.status, 'cancelled');
        } else {
          assert.equal(cancelResult.cancelled, false);
          assert.equal(result.status, 'completed');
        }
      });
    }
  });
}

export { SLOW_INVOKE_MIN_MS };
