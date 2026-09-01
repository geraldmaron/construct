#!/usr/bin/env node
/**
 * amend-strip-head-commit.mjs — during history rewrite, drop attribution
 * trailers from the current HEAD commit message if present.
 */

import { execFileSync } from 'node:child_process';
import { stripAttributionTrailers } from './commit-trailers.mjs';

const msg = execFileSync('git', ['log', '-1', '--format=%B'], { encoding: 'utf8' });
const clean = stripAttributionTrailers(msg);
if (clean === msg) process.exit(0);

execFileSync('git', ['commit', '--amend', '-F', '-'], { input: clean, stdio: ['pipe', 'inherit', 'inherit'] });
