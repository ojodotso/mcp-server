import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { OjoApiClient, OjoApiError } from '../../src/server/ojo-client.js';

function jsonResponse(body: unknown, init: { status?: number } = {}): Response {
  return new Response(JSON.stringify(body), {
    status: init.status ?? 200,
    headers: { 'content-type': 'application/json' },
  });
}

type FetchMock = ReturnType<typeof vi.fn>;

function callInit(mock: FetchMock): {
  method: string;
  headers: Record<string, string>;
  body?: string;
} {
  return mock.mock.calls[0]![1];
}

describe('OjoApiClient', () => {
  let fetchMock: FetchMock;

  beforeEach(() => {
    fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('sends raw HTML with an exact text/html Content-Type and bearer auth', async () => {
    fetchMock.mockResolvedValue(
      jsonResponse({ id: 'img_1', imageUrl: 'https://cdn/x.png', createdAt: 't' })
    );
    const client = new OjoApiClient('key123', 'https://api.example/v1');

    const result = await client.createImageFromHtml('<h1>hi</h1>');

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0]![0]).toBe('https://api.example/v1/image/html');
    const init = callInit(fetchMock);
    expect(init.method).toBe('POST');
    expect(init.body).toBe('<h1>hi</h1>');
    expect(init.headers['Content-Type']).toBe('text/html');
    expect(init.headers.Authorization).toBe('Bearer key123');
    expect(init.headers['x-ojo-source']).toBe('mcp');
    expect(result).toEqual({
      id: 'img_1',
      imageUrl: 'https://cdn/x.png',
      createdAt: 't',
    });
  });

  it('forwards viewport + transparency as headers only when provided', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ id: 'i', imageUrl: 'u' }));
    const client = new OjoApiClient('k');

    await client.createImageFromHtml('<p>x</p>', {
      viewportWidth: 600,
      viewportHeight: 400,
      transparentBackground: true,
    });

    const { headers } = callInit(fetchMock);
    expect(headers['x-viewport-width']).toBe('600');
    expect(headers['x-viewport-height']).toBe('400');
    expect(headers['x-transparent-background']).toBe('true');
  });

  it('omits viewport headers when not provided', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ id: 'i', imageUrl: 'u' }));
    const client = new OjoApiClient('k');

    await client.createImageFromHtml('<p>x</p>');

    const { headers } = callInit(fetchMock);
    expect(headers['x-viewport-width']).toBeUndefined();
    expect(headers['x-viewport-height']).toBeUndefined();
    expect(headers['x-transparent-background']).toBeUndefined();
  });

  it('builds a JSON body for template generation', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ id: 'i', imageUrl: 'u' }));
    const client = new OjoApiClient('k', 'https://api.example/v1');

    await client.createImageFromTemplate(
      'tpl_1',
      { name: 'Ada' },
      { viewportWidth: 800 }
    );

    expect(fetchMock.mock.calls[0]![0]).toBe(
      'https://api.example/v1/image/template'
    );
    const init = callInit(fetchMock);
    expect(init.headers['Content-Type']).toBe('application/json');
    expect(JSON.parse(init.body!)).toEqual({
      templateId: 'tpl_1',
      modify: { name: 'Ada' },
      viewportWidth: 800,
    });
  });

  it('builds a query string for listTemplates', async () => {
    fetchMock.mockResolvedValue(
      jsonResponse({
        items: [],
        totalItems: 0,
        totalPages: 0,
        currentPage: 1,
        pageSize: 10,
      })
    );
    const client = new OjoApiClient('k', 'https://api.example/v1');

    await client.listTemplates({ page: 2, pageSize: 5, sort: 'asc' });

    expect(fetchMock.mock.calls[0]![0]).toBe(
      'https://api.example/v1/template?page=2&pageSize=5&sort=asc'
    );
  });

  it('hits the bare /template path when no params are given', async () => {
    fetchMock.mockResolvedValue(
      jsonResponse({
        items: [],
        totalItems: 0,
        totalPages: 0,
        currentPage: 1,
        pageSize: 10,
      })
    );
    const client = new OjoApiClient('k', 'https://api.example/v1');

    await client.listTemplates();

    expect(fetchMock.mock.calls[0]![0]).toBe('https://api.example/v1/template');
  });

  it('base64-decodes the template html from getTemplate', async () => {
    const encoded = Buffer.from('<h1>Hello</h1>', 'utf-8').toString('base64');
    fetchMock.mockResolvedValue(
      jsonResponse({
        id: 't',
        name: 'n',
        html: encoded,
        variables: { a: 1 },
        createdAt: 'c',
        updatedAt: 'u',
      })
    );
    const client = new OjoApiClient('k', 'https://api.example/v1');

    const tpl = await client.getTemplate('t');

    expect(tpl.html).toBe('<h1>Hello</h1>');
    expect(tpl.variables).toEqual({ a: 1 });
    expect(fetchMock.mock.calls[0]![0]).toBe(
      'https://api.example/v1/template/t'
    );
  });

  it('base64-encodes the html when creating a template', async () => {
    fetchMock.mockResolvedValue(
      jsonResponse({ id: 'tpl_new', message: 'Template created' })
    );
    const client = new OjoApiClient('k', 'https://api.example/v1');

    const result = await client.createTemplate('<h1>{{title}}</h1>', {
      title: 'Hi',
    });

    expect(fetchMock.mock.calls[0]![0]).toBe('https://api.example/v1/template');
    const init = callInit(fetchMock);
    expect(init.method).toBe('POST');
    const body = JSON.parse(init.body!);
    expect(Buffer.from(body.html, 'base64').toString('utf-8')).toBe(
      '<h1>{{title}}</h1>'
    );
    expect(body.variables).toEqual({ title: 'Hi' });
    expect(result).toEqual({ id: 'tpl_new', message: 'Template created' });
  });

  it('normalizes a scheme-less imageUrl to absolute https', async () => {
    fetchMock.mockResolvedValue(
      jsonResponse({ id: 'i', imageUrl: 'ojousercontent.com/abc.png' })
    );
    const client = new OjoApiClient('k');

    const result = await client.createImageFromHtml('<p>x</p>');

    expect(result.imageUrl).toBe('https://ojousercontent.com/abc.png');
  });

  it('leaves an already-absolute imageUrl unchanged', async () => {
    fetchMock.mockResolvedValue(
      jsonResponse({ id: 'i', imageUrl: 'https://cdn.ojo.so/abc.png' })
    );
    const client = new OjoApiClient('k');

    const result = await client.createImageFromHtml('<p>x</p>');

    expect(result.imageUrl).toBe('https://cdn.ojo.so/abc.png');
  });

  it.each<[number, RegExp]>([
    [401, /OJO_API_KEY/],
    [402, /credit/i],
    [422, /rejected the request/i],
    [429, /rate limit/i],
  ])('maps HTTP %i to a clear OjoApiError', async (status, pattern) => {
    fetchMock.mockResolvedValue(jsonResponse({ message: 'nope' }, { status }));
    const client = new OjoApiClient('k');

    const error = await client
      .createImageFromHtml('<p>x</p>')
      .catch((e: unknown) => e);

    expect(error).toBeInstanceOf(OjoApiError);
    expect((error as OjoApiError).status).toBe(status);
    expect((error as OjoApiError).message).toMatch(pattern);
  });

  it('wraps network failures in an OjoApiError with status 0', async () => {
    fetchMock.mockRejectedValue(new Error('ECONNREFUSED'));
    const client = new OjoApiClient('k', 'https://api.example/v1');

    const error = await client
      .createImageFromHtml('<p>x</p>')
      .catch((e: unknown) => e);

    expect(error).toBeInstanceOf(OjoApiError);
    expect((error as OjoApiError).status).toBe(0);
    expect((error as OjoApiError).message).toContain('Could not reach');
  });
});
