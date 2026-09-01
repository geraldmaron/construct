/**
 * tests/scripts/commit-trailers.test.ts — attribution trailers stay out of commits.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
// @ts-expect-error — hook helper is plain .mjs outside src/
import {
  stripAttributionTrailers,
  findAttributionTrailers,
} from '../../scripts/hooks/commit-trailers.mjs';

test('Co-authored-by and Signed-off-by lines are stripped', () => {
  const message = [
    'Fix the thing (construct-abcd)',
    '',
    'Co-authored-by: Cursor <cursoragent@cursor.com>',
    'Signed-off-by: Someone <someone@example.com>',
  ].join('\n');
  assert.equal(
    stripAttributionTrailers(message),
    'Fix the thing (construct-abcd)\n',
  );
});

test('findAttributionTrailers names what is still present', () => {
  const hits = findAttributionTrailers(
    'Subject\n\nCo-authored-by: Cursor <cursoragent@cursor.com>\n',
  );
  assert.deepEqual(hits, ['Co-authored-by: Cursor <cursoragent@cursor.com>']);
});

test('ordinary body text is untouched', () => {
  const message = 'Subject (construct-abcd)\n\nBody mentions co-authored work in prose.\n';
  assert.equal(stripAttributionTrailers(message), message);
  assert.deepEqual(findAttributionTrailers(message), []);
});
