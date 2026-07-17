/**
 * tests/providers/fixtures/webhook-delivery-call.mjs — one real webhook()
 * call in a fresh process, for the cross-process dedup durability test.
 *
 * argv: <deliveryLogPath> <deliveryId>. Signs a fixed payload with the real
 * HMAC, invokes the real provider webhook(), and prints the result JSON on
 * stdout so the parent test can assert on duplicate/firstSeenAt across two
 * separate node process instantiations sharing one log file.
 */

import crypto from 'node:crypto';
import { create } from '../../../lib/providers/github/index.mjs';

const [logPath, deliveryId] = process.argv.slice(2);
const secret = '__construct_cross_process_secret__';
const body = JSON.stringify({ action: 'opened', number: 42 });
const signature = `sha256=${crypto.createHmac('sha256', secret).update(body).digest('hex')}`;

const provider = create({ env: {} });
const result = await provider.webhook(
  { webhookSecret: secret, webhookDeliveryLogPath: logPath },
  {
    headers: {
      'x-hub-signature-256': signature,
      'x-github-event': 'issues',
      'x-github-delivery': deliveryId,
    },
    body,
  },
);
process.stdout.write(JSON.stringify(result));
