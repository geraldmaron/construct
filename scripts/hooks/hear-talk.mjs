#!/usr/bin/env node
/**
 * hooks/hear-talk.mjs — prompt-submit hook. The host launches this on
 * Send with the user's words on stdin. The user does not type a verb.
 * Records a run. Does not name seats.
 */

import { hear } from '../../src/cli/hear.ts';

process.exitCode = hear([]);
