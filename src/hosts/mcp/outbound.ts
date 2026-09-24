/**
 * hosts/mcp/outbound.ts — requests the server sends to the host, and the
 * host's answers.
 *
 * The server answers the host's messages one at a time, in order. A tool call
 * that waits on the host (to put a question to the person) would never see
 * the answer if that answer queued behind the call, so answers to the
 * server's own requests are settled the moment they arrive, outside the
 * queue. Every request has a deadline; an unanswered one fails rather than
 * holding the call open.
 */

export class HostRequestError extends Error {
  readonly reason: 'timeout' | 'error' | 'closed' | 'detached' | 'cancelled';

  constructor(message: string, reason: HostRequestError['reason']) {
    super(message);
    this.name = 'HostRequestError';
    this.reason = reason;
  }
}

interface Pending {
  readonly resolve: (result: unknown) => void;
  readonly reject: (error: Error) => void;
  readonly timer: NodeJS.Timeout;
}

export class HostRequests {
  private send: ((message: unknown) => Promise<void>) | null = null;
  private readonly pending = new Map<string, Pending>();
  private next = 1;

  /** Connect to the transport that carries messages to the host. */
  attach(send: (message: unknown) => Promise<void>): void {
    this.send = send;
  }

  /** Send `method` to the host and wait at most `timeoutMs` for its answer. */
  request(method: string, params: unknown, timeoutMs: number): Promise<unknown> {
    const send = this.send;
    if (!send) return Promise.reject(new HostRequestError('no host is connected', 'detached'));
    const id = `construct-${String(this.next++)}`;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new HostRequestError(`the host did not answer ${method} within ${String(Math.round(timeoutMs / 1000))}s`, 'timeout'));
      }, timeoutMs);
      this.pending.set(id, { resolve, reject, timer });
      send({ jsonrpc: '2.0', id, method, params }).catch((error: unknown) => {
        clearTimeout(timer);
        this.pending.delete(id);
        reject(new HostRequestError(`could not send ${method}: ${error instanceof Error ? error.message : String(error)}`, 'error'));
      });
    });
  }

  /** Settle one of this server's requests if `message` answers it. True when it did. */
  deliver(message: unknown): boolean {
    if (message === null || typeof message !== 'object') return false;
    const m = message as { id?: unknown; method?: unknown; result?: unknown; error?: { message?: unknown } };
    if (m.method !== undefined || typeof m.id !== 'string') return false;
    const waiting = this.pending.get(m.id);
    if (!waiting) return false;
    this.pending.delete(m.id);
    clearTimeout(waiting.timer);
    if (m.error) waiting.reject(new HostRequestError(`the host refused: ${String(m.error.message ?? 'no reason given')}`, 'error'));
    else waiting.resolve(m.result);
    return true;
  }

  /** Stop waiting on every request: the call that sent them was cancelled. */
  cancelAll(): void {
    for (const [id, waiting] of this.pending) {
      clearTimeout(waiting.timer);
      waiting.reject(new HostRequestError('the host cancelled the call waiting on this', 'cancelled'));
      this.pending.delete(id);
    }
  }

  /** Fail every request still waiting; the connection is gone. */
  close(): void {
    for (const [id, waiting] of this.pending) {
      clearTimeout(waiting.timer);
      waiting.reject(new HostRequestError('the host connection closed', 'closed'));
      this.pending.delete(id);
    }
    this.send = null;
  }
}
