import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { OjoApiClient, OjoApiError } from '../../src/server/ojo-client.js';

// AC238 (.claude/docs/specs/2026-10-08-m1-render-limits.md): when the render queue is full the API
// answers 503 with code "queue_full", a reason, and Retry-After and retryAfter as in AC225. The MCP
// client shows the wait for a 503 as it does for a 429 (AC227): the error names the wait from
// Retry-After, or the body's retryAfter, and passes the server's text through. The network (fetch)
// is outside the unit and stubbed.

function serviceUnavailable(body: unknown, retryAfter?: number): Response {
  const headers: Record<string, string> = { 'content-type': 'application/json' };
  if (retryAfter !== undefined) headers['retry-after'] = String(retryAfter);
  return new Response(JSON.stringify(body), { status: 503, headers });
}

const UNIT = '(?:more\\s+)?';
/** The wait in whole seconds, said as seconds or as minutes (rounded either way). */
const namesWait = (text: string, seconds: number) => {
  const patterns = [new RegExp(`\\b${seconds}\\s*${UNIT}(?:s|secs?|seconds?)\\b`, 'i')];
  if (seconds >= 60) {
    for (const minutes of new Set([
      Math.floor(seconds / 60),
      Math.ceil(seconds / 60),
      Math.round(seconds / 60),
    ])) {
      patterns.push(new RegExp(`\\b${minutes}\\s*${UNIT}(?:mins?|minutes?)\\b`, 'i'));
    }
  }
  return patterns.some((pattern) => pattern.test(text));
};

const errorOf = async (call: Promise<unknown>) => {
  const error = await call.catch((e: unknown) => e);
  expect(error).toBeInstanceOf(OjoApiError);
  expect((error as OjoApiError).status).toBe(503);
  return (error as OjoApiError).message;
};

const REASON = 'The render queue is full';

describe('OjoApiClient 503 queue_full errors (AC238)', () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('names the wait from the Retry-After header and passes the server reason through', async () => {
    fetchMock.mockResolvedValue(
      serviceUnavailable({ error: true, code: 'queue_full', message: REASON, retryAfter: 17 }, 17)
    );

    const text = await errorOf(new OjoApiClient('k').createImageFromTemplate('tpl'));

    expect(text).toContain(REASON);
    expect(namesWait(text, 17), `the error does not name the 17 s wait: ${text}`).toBe(true);
  });

  it("names the wait from the body's retryAfter when there is no Retry-After header", async () => {
    fetchMock.mockResolvedValue(
      serviceUnavailable({ error: true, code: 'queue_full', message: REASON, retryAfter: 23 })
    );

    const text = await errorOf(new OjoApiClient('k').createImageFromHtml('<p>x</p>'));

    expect(text).toContain(REASON);
    expect(namesWait(text, 23), `the error does not name the 23 s wait: ${text}`).toBe(true);
  });

  it('names a wait of minutes for a PDF render', async () => {
    fetchMock.mockResolvedValue(
      serviceUnavailable({ error: true, code: 'queue_full', message: REASON, retryAfter: 120 }, 120)
    );

    const text = await errorOf(
      new OjoApiClient('k').createPdfFromTemplate({ pages: [{ templateId: 'tpl' }] })
    );

    expect(text).toContain(REASON);
    expect(namesWait(text, 120), `the error does not name the 120 s wait: ${text}`).toBe(true);
  });
});
