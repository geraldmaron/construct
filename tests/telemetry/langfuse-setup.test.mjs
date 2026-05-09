/**
 * lib/telemetry/langfuse-setup.test.mjs — Tests for langfuse-setup.mjs
 */

import { describe, it, expect, beforeEach } from 'bun:test';
import { runLangfuseSetup } from './langfuse-setup.mjs';

const MOCK_URL = 'http://localhost:3000';
const MOCK_HEADERS = { Authorization: 'Basic xxx', 'Content-Type': 'application/json' };

describe('langfuse-setup', () => {
  let mockFetch;

  beforeEach(() => {
    mockFetch = vi.fn();
    global.fetch = mockFetch;
  });

  it('should handle missing credentials gracefully', async () => {
    const result = await runLangfuseSetup({
      publicKey: '',
      secretKey: '',
      fetchImpl: mockFetch,
    });
    expect(result.ok).toBe(false);
    expect(result.error).toContain('LANGFUSE_PUBLIC_KEY');
  });

  it('should create annotation queue if missing', async () => {
    mockFetch
      .mockResolvedValueOnce({ ok: true, json: () => ({ data: [] }) }) // list queues
      .mockResolvedValueOnce({ ok: true }); // create queue

    const result = await runLangfuseSetup({
      publicKey: 'pk-test',
      secretKey: 'sk-test',
      baseUrl: MOCK_URL,
      fetchImpl: mockFetch,
    });

    expect(result.ok).toBe(true);
    expect(mockFetch).toHaveBeenCalledWith(
      expect.stringContaining('/annotation-queues'),
      expect.objectContaining({ method: 'POST' })
    );
  });

  it('should skip queue if exists', async () => {
    mockFetch
      .mockResolvedValueOnce({ ok: true, json: () => ({ data: [{ name: 'construct-quality-queue' }] }) }) // list

    const result = await runLangfuseSetup({
      publicKey: 'pk-test',
      secretKey: 'sk-test',
      baseUrl: MOCK_URL,
      fetchImpl: mockFetch,
    });

    expect(result.ok).toBe(true);
    expect(mockFetch).toHaveBeenCalledTimes(1);
  });

  it('should create eval config if missing', async () => {
    mockFetch
      .mockResolvedValueOnce({ ok: true, json: () => ({ data: [] }) }) // queues
      .mockResolvedValueOnce({ ok: true, json: () => ({ data: [] }) }) // eval configs
      .mockResolvedValueOnce({ ok: true }); // create eval

    const result = await runLangfuseSetup({
      publicKey: 'pk-test',
      secretKey: 'sk-test',
      baseUrl: MOCK_URL,
      fetchImpl: mockFetch,
    });

    expect(mockFetch).toHaveBeenCalledWith(
      expect.stringContaining('/evaluation-configs'),
      expect.objectContaining({ method: 'POST' })
    );
  });
});
