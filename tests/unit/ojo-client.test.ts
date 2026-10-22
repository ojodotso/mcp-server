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

  // AC726/AC732 (.claude/docs/specs/2026-10-16-plain-html-templates.md): the API returns plain
  // HTML, and getTemplate returns its html unchanged.
  it.each([
    ['plain HTML', '<h1>Hello</h1>'],
    ['plain HTML with quotes, a newline and non-ASCII', '<p class="a">Grüße "{{name}}"\n✓</p>'],
    ['plain HTML whose text is also valid base64', '<p>QUJD</p>'],
  ])('AC726 returns %s from getTemplate as the API sent it', async (_label, html) => {
    fetchMock.mockResolvedValue(
      jsonResponse({ id: 't', name: 'n', html, variables: {}, createdAt: 'c', updatedAt: 'u' })
    );
    const client = new OjoApiClient('k', 'https://api.example/v1');

    const tpl = await client.getTemplate('t');

    expect(tpl.html).toBe(html);
  });

  // AC726 (reviewer F3) and AC732: values that look like base64 are the API's html, returned
  // unchanged, never decoded.
  it.each([
    ['plain text with a variable', 'Hello {{name}}'],
    ['a word that is valid base64 but not UTF-8 (Invoice)', 'Invoice'],
    ['abcd (valid base64, not UTF-8)', 'abcd'],
    ['QUJD (strict base64 of ABC, no <)', 'QUJD'],
    ['base64 of Hello world (UTF-8, no <)', Buffer.from('Hello world', 'utf-8').toString('base64')],
    ['base64 of bytes that hold < but are not UTF-8', Buffer.from([0xff, 0xfe, 0x3c, 0x70]).toString('base64')],
    ['not base64 at all (! inside)', 'PHA+aGk8!3A+'],
  ])('AC726 returns %s from getTemplate unchanged', async (_label, html) => {
    fetchMock.mockResolvedValue(
      jsonResponse({ id: 't', name: 'n', html, variables: {}, createdAt: 'c', updatedAt: 'u' })
    );
    const client = new OjoApiClient('k', 'https://api.example/v1');

    expect((await client.getTemplate('t')).html).toBe(html);
  });

  // AC732 (Addition 1 of the same spec) supersedes the decode half of AC726: getTemplate decodes
  // nothing, so strict base64 of UTF-8 HTML comes back as the API sent it.
  const NON_ASCII = Buffer.from('<p>Grüße {{name}} ✓ ?>?</p>', 'utf-8');
  it.each([
    ['standard base64 of HTML', Buffer.from('<h1>Hello</h1>', 'utf-8').toString('base64')],
    ['standard base64 of non-ASCII UTF-8 HTML', NON_ASCII.toString('base64')],
    ['URL-safe base64 of HTML, unpadded', NON_ASCII.toString('base64url')],
    ['standard base64 of HTML wrapped with \\n', NON_ASCII.toString('base64').replace(/(.{16})/g, '$1\n')],
    ['PGI+ (base64 of <b>)', 'PGI+'],
  ])('AC732 returns %s from getTemplate unchanged, decoding nothing', async (_label, html) => {
    fetchMock.mockResolvedValue(
      jsonResponse({ id: 't', name: 'n', html, variables: { a: 1 }, createdAt: 'c', updatedAt: 'u' })
    );
    const client = new OjoApiClient('k', 'https://api.example/v1');

    const tpl = await client.getTemplate('t');

    expect(tpl.html).toBe(html);
    expect(tpl.variables).toEqual({ a: 1 });
    expect(fetchMock.mock.calls[0]![0]).toBe('https://api.example/v1/template/t');
  });

  it('AC725 sends the html plain when creating a template', async () => {
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
    expect(body.html).toBe('<h1>{{title}}</h1>');
    expect(body.variables).toEqual({ title: 'Hi' });
    expect(result).toEqual({ id: 'tpl_new', message: 'Template created' });
  });

  it('AC725 sends the html plain when updating a template', async () => {
    fetchMock.mockResolvedValue(
      jsonResponse({ id: 'tpl_1', message: 'Template updated' })
    );
    const client = new OjoApiClient('k', 'https://api.example/v1');
    const html = '<p class="a">Grüße "{{name}}"\n✓</p>';

    await client.updateTemplate('tpl_1', html);

    const init = callInit(fetchMock);
    expect(init.method).toBe('PUT');
    expect(JSON.parse(init.body!)).toEqual({ html });
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
    // AC59: a 429's text carries the server's message, not a fixed line.
    [429, /nope/],
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

  describe('createPdfFromTemplate (AC58)', () => {
    const PAGES = [
      { templateId: 'tpl_cover', modify: { title: 'Q3' } },
      { html: '<h1>{{title}}</h1>' },
      { modify: { section: 2 } },
      {},
    ];

    it('POSTs templateId, modify and pages to /pdf/template unchanged', async () => {
      fetchMock.mockResolvedValue(
        jsonResponse({ id: 'p', pdfUrl: 'https://cdn/p.pdf', pages: 4, credits: 1 })
      );
      const client = new OjoApiClient('k', 'https://api.example/v1');

      await client.createPdfFromTemplate({
        templateId: 'tpl_default',
        modify: { shared: true },
        pages: PAGES,
      });

      expect(fetchMock.mock.calls[0]![0]).toBe(
        'https://api.example/v1/pdf/template'
      );
      const init = callInit(fetchMock);
      expect(init.method).toBe('POST');
      expect(init.headers['Content-Type']).toBe('application/json');
      expect(JSON.parse(init.body!)).toEqual({
        templateId: 'tpl_default',
        modify: { shared: true },
        pages: PAGES,
      });
    });

    it('sends no templateId when only pages are given', async () => {
      fetchMock.mockResolvedValue(
        jsonResponse({ id: 'p', pdfUrl: 'https://cdn/p.pdf', pages: 4, credits: 1 })
      );
      const client = new OjoApiClient('k', 'https://api.example/v1');

      await client.createPdfFromTemplate({
        pages: PAGES,
        modify: { shared: true },
      });

      const body = JSON.parse(callInit(fetchMock).body!);
      expect(body).not.toHaveProperty('templateId');
      expect(body.pages).toEqual(PAGES);
      expect(body.modify).toEqual({ shared: true });
    });
  });

  describe('API errors (AC59)', () => {
    const LOGS = [
      "pages[3]: template 'x' not found",
      'pages[7]: give templateId or html, not both',
    ];

    it.each([400, 422])(
      'puts every entry of logs into the error text (HTTP %i)',
      async (status) => {
        fetchMock.mockResolvedValue(
          jsonResponse(
            { error: true, message: 'Invalid pages', logs: LOGS },
            { status }
          )
        );
        const client = new OjoApiClient('k');

        const error = await client
          .createPdfFromTemplate({ pages: [{}] })
          .catch((e: unknown) => e);

        expect(error).toBeInstanceOf(OjoApiError);
        expect((error as OjoApiError).status).toBe(status);
        for (const line of LOGS) {
          expect((error as OjoApiError).message).toContain(line);
        }
      }
    );

    it.each([
      'Another multi-page PDF from this account is still rendering',
      'Too Many Requests',
    ])('includes the server message "%s" in a 429', async (message) => {
      fetchMock.mockResolvedValue(
        jsonResponse({ error: true, message }, { status: 429 })
      );
      const client = new OjoApiClient('k');

      const error = await client
        .createPdfFromTemplate({ templateId: 'tpl' })
        .catch((e: unknown) => e);

      expect(error).toBeInstanceOf(OjoApiError);
      expect((error as OjoApiError).status).toBe(429);
      expect((error as OjoApiError).message).toContain(message);
    });
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
