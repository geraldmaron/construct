/**
 * legacy-checkout.mjs — where the predecessor's source sits, resolved once.
 *
 * The golden captures freeze what v2 actually returned by importing v2's own
 * modules, so each of them needs a construct-legacy checkout on disk. Each
 * resolved its location the same way and none of them checked it: a missing
 * or misnamed checkout arrived as a raw ERR_MODULE_NOT_FOUND stack naming one
 * file deep inside a tree that was never there, and never naming the variable
 * that chooses where to look. The setting a caller has to change is the one
 * fact that failure has to carry, so it is stated here instead of left to the
 * module loader to imply.
 */

import { existsSync } from 'node:fs';
import { join } from 'node:path';

/**
 * The construct-legacy checkout root: CONSTRUCT_LEGACY when it is set, the
 * conventional location under $HOME otherwise.
 *
 * A location with nothing at it refuses rather than proceeding, and exits 2
 * on the probes' rule that a run which could not start is unknown rather than
 * passed. Nothing here is guessed on the caller's behalf beyond that one
 * conventional path, and the refusal names it.
 */
export function legacyCheckout() {
  const root =
    process.env.CONSTRUCT_LEGACY ?? join(process.env.HOME ?? '', 'Developer/Projects/construct-legacy');
  if (!existsSync(root)) {
    process.stderr.write(
      `No construct-legacy checkout at ${root}.\n` +
        'This capture reads the predecessor\'s own modules, so there is nothing to\n' +
        'freeze without one. Clone it there, or point CONSTRUCT_LEGACY at a checkout\n' +
        'you already have: CONSTRUCT_LEGACY=<path> node <this script>.\n',
    );
    process.exit(2);
  }
  return root;
}
