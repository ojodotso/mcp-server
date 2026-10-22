import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { OjoApiClient, OjoApiError } from '../../src/server/ojo-client.js';

// AC227: the MCP server's error for a 429 names the wait from Retry-After (or the body's
// retryAfter) and passes the server's text through. The network (fetch) is outside the unit and
// stubbed.

function tooManyRequests(body: unknown, retryAfter?: number): Response {
  const headers: Record<string, string> = { 'content-type': 'application/json' };
  if (retryAfter !== undefined) headers['retry-after'] = String(retryAfter);
  return new Response(JSON.stringify(body), { status: 429, headers });
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
  expect((error as OjoApiError).status).toBe(429);
  return (error as OjoApiError).message;
};

describe('OjoApiClient 429 errors (AC227)', () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('names the wait from the Retry-After header and passes the server message through', async () => {
    const message = 'Render rate limit reached: 60 renders per minute';
    fetchMock.mockResolvedValue(
      tooManyRequests({ error: true, code: 'rate_limited.render', message }, 37)
    );

    const text = await errorOf(new OjoApiClient('k').createImageFromTemplate('tpl'));

    expect(text).toContain(message);
    expect(namesWait(text, 37), `the error does not name the 37 s wait: ${text}`).toBe(true);
  });

  it("names the wait from the body's retryAfter when there is no Retry-After header", async () => {
    const message = 'Template rate limit reached: 30 requests per minute';
    fetchMock.mockResolvedValue(
      tooManyRequests({ error: true, code: 'rate_limited.template', retryAfter: 53, message })
    );

    const text = await errorOf(new OjoApiClient('k').createTemplate('<p>x</p>'));

    expect(text).toContain(message);
    expect(namesWait(text, 53), `the error does not name the 53 s wait: ${text}`).toBe(true);
  });

  it('names a wait of minutes from Retry-After for another multi-page PDF in progress', async () => {
    const message = 'Another multi-page PDF from this account is still rendering';
    fetchMock.mockResolvedValue(
      tooManyRequests({ error: true, code: 'pdf_in_progress', message }, 90)
    );

    const text = await errorOf(
      new OjoApiClient('k').createPdfFromTemplate({ pages: [{ templateId: 'tpl' }] })
    );

    expect(text).toContain(message);
    expect(namesWait(text, 90), `the error does not name the 90 s wait: ${text}`).toBe(true);
  });

  it("passes the server's text through when it arrives in logs, with the wait", async () => {
    // The log does not name the wait itself, so the error must add it from Retry-After.
    const log = 'Render rate limit reached: 60 renders per minute';
    fetchMock.mockResolvedValue(
      tooManyRequests(
        { error: true, code: 'rate_limited.render', message: 'Too Many Requests', logs: [log] },
        41
      )
    );

    const text = await errorOf(new OjoApiClient('k').createImageFromTemplate('tpl'));

    expect(text).toContain(log);
    expect(namesWait(text, 41), `the error does not name the 41 s wait: ${text}`).toBe(true);
  });
});
