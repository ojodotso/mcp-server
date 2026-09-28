import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { createServer } from '../../src/server/index.js';
import { OjoApiClient } from '../../src/server/ojo-client.js';

// The PDF tools are driven end to end through the MCP server with a real
// OjoApiClient. Only the HTTP layer (fetch) is stubbed: the oJo API's
// /v1/pdf/* endpoints are outside this unit.

const API_BASE_URL = 'https://api.example/v1';
const API_KEY = 'key123';

type FetchMock = ReturnType<typeof vi.fn>;

type ToolResult = {
  content: { type: string; text?: string }[];
  isError?: boolean;
};

type ListedTool = Awaited<ReturnType<Client['listTools']>>['tools'][number];

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

/** The one request the tool sent to the oJo API, normalised for assertions. */
function sentRequest(fetchMock: FetchMock) {
  expect(fetchMock).toHaveBeenCalledTimes(1);
  const [url, init] = fetchMock.mock.calls[0]! as [
    string | URL,
    { method?: string; headers?: HeadersInit; body?: unknown },
  ];
  return {
    url: String(url),
    method: init.method,
    headers: new Headers(init.headers),
    body: init.body,
  };
}

function firstText(result: ToolResult): string {
  const block = result.content[0]!;
  if (block.type !== 'text') {
    throw new Error(`expected a text block, got ${block.type}`);
  }
  return block.text ?? '';
}

function toolNamed(tools: ListedTool[], name: string): ListedTool {
  const tool = tools.find((t) => t.name === name);
  if (!tool) throw new Error(`tool ${name} is not listed`);
  return tool;
}

/** A property's JSON Schema without its description: the shape, not the copy. */
function shapeOf(property: unknown): unknown {
  return Object.fromEntries(
    Object.entries(property as Record<string, unknown>).filter(
      ([key]) => key !== 'description'
    )
  );
}

async function connect() {
  const server = createServer(new OjoApiClient(API_KEY, API_BASE_URL));
  const [clientTransport, serverTransport] =
    InMemoryTransport.createLinkedPair();
  const client = new Client({ name: 'test-client', version: '0.0.0' });
  await Promise.all([
    server.connect(serverTransport),
    client.connect(clientTransport),
  ]);
  return client;
}

async function call(
  client: Client,
  name: string,
  args: Record<string, unknown>
): Promise<ToolResult> {
  return (await client.callTool({ name, arguments: args })) as ToolResult;
}

const PDF_BODY = {
  id: 'pdf_abc',
  pdfUrl: 'https://cdn.ojo.so/renders/quarterly-report.pdf',
  pages: 17,
  createdAt: '2026-09-28T00:00:00.000Z',
};

describe('generate_pdf_from_html', () => {
  let fetchMock: FetchMock;
  let client: Client;

  beforeEach(async () => {
    fetchMock = vi.fn().mockResolvedValue(jsonResponse(PDF_BODY));
    vi.stubGlobal('fetch', fetchMock);
    client = await connect();
  });

  afterEach(async () => {
    await client.close();
    vi.unstubAllGlobals();
  });

  it('takes html as its only required input, shaped like generate_image_from_html', async () => {
    const { tools } = await client.listTools();
    const pdf = toolNamed(tools, 'generate_pdf_from_html').inputSchema;
    const image = toolNamed(tools, 'generate_image_from_html').inputSchema;

    expect(pdf.required).toEqual(['html']);
    expect(shapeOf(pdf.properties?.html)).toEqual(
      shapeOf(image.properties?.html)
    );
  });

  it('refuses a call without html and never reaches the API', async () => {
    // Without this, an unregistered tool would also "refuse" the call.
    toolNamed((await client.listTools()).tools, 'generate_pdf_from_html');

    const result = await call(client, 'generate_pdf_from_html', {});

    expect(result.isError).toBe(true);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('POSTs the html as a text/html body to /v1/pdf/html with the API key and the mcp source header', async () => {
    await call(client, 'generate_pdf_from_html', {
      html: '<h1>Quarterly report</h1>',
    });

    const request = sentRequest(fetchMock);
    expect(request.url).toBe(`${API_BASE_URL}/pdf/html`);
    expect(request.method).toBe('POST');
    expect(request.body).toBe('<h1>Quarterly report</h1>');
    expect(request.headers.get('content-type')).toBe('text/html');
    expect(request.headers.get('authorization')).toBe(`Bearer ${API_KEY}`);
    expect(request.headers.get('x-ojo-source')).toBe('mcp');
  });

  it('sends no viewport or transparency headers', async () => {
    await call(client, 'generate_pdf_from_html', { html: '<p>x</p>' });

    const { headers } = sentRequest(fetchMock);
    expect(headers.get('x-viewport-width')).toBeNull();
    expect(headers.get('x-viewport-height')).toBeNull();
    expect(headers.get('x-transparent-background')).toBeNull();
  });

  it('sends no viewport or transparency headers even when the caller passes image-style viewport arguments', async () => {
    await call(client, 'generate_pdf_from_html', {
      html: '<p>x</p>',
      viewportWidth: 800,
      viewportHeight: 600,
      transparentBackground: true,
    });

    const { headers } = sentRequest(fetchMock);
    expect(headers.get('x-viewport-width')).toBeNull();
    expect(headers.get('x-viewport-height')).toBeNull();
    expect(headers.get('x-transparent-background')).toBeNull();
  });
});

describe('generate_pdf_from_template', () => {
  let fetchMock: FetchMock;
  let client: Client;

  beforeEach(async () => {
    fetchMock = vi.fn().mockResolvedValue(jsonResponse(PDF_BODY));
    vi.stubGlobal('fetch', fetchMock);
    client = await connect();
  });

  afterEach(async () => {
    await client.close();
    vi.unstubAllGlobals();
  });

  it('takes a required templateId and an optional modify, shaped like generate_image_from_template', async () => {
    const { tools } = await client.listTools();
    const pdf = toolNamed(tools, 'generate_pdf_from_template').inputSchema;
    const image = toolNamed(tools, 'generate_image_from_template').inputSchema;

    expect(pdf.required).toEqual(['templateId']);
    expect(shapeOf(pdf.properties?.templateId)).toEqual(
      shapeOf(image.properties?.templateId)
    );
    expect(shapeOf(pdf.properties?.modify)).toEqual(
      shapeOf(image.properties?.modify)
    );
  });

  it('refuses a call without templateId and never reaches the API', async () => {
    // Without this, an unregistered tool would also "refuse" the call.
    toolNamed((await client.listTools()).tools, 'generate_pdf_from_template');

    const result = await call(client, 'generate_pdf_from_template', {
      modify: { name: 'Ada' },
    });

    expect(result.isError).toBe(true);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('POSTs { templateId, modify } as JSON to /v1/pdf/template with the API key and the mcp source header', async () => {
    await call(client, 'generate_pdf_from_template', {
      templateId: 'tpl_1',
      modify: { name: 'Ada', total: 42 },
    });

    const request = sentRequest(fetchMock);
    expect(request.url).toBe(`${API_BASE_URL}/pdf/template`);
    expect(request.method).toBe('POST');
    expect(request.headers.get('content-type')).toMatch(/application\/json/);
    expect(JSON.parse(String(request.body))).toEqual({
      templateId: 'tpl_1',
      modify: { name: 'Ada', total: 42 },
    });
    expect(request.headers.get('authorization')).toBe(`Bearer ${API_KEY}`);
    expect(request.headers.get('x-ojo-source')).toBe('mcp');
  });

  it('still calls /v1/pdf/template with the templateId when modify is omitted', async () => {
    const result = await call(client, 'generate_pdf_from_template', {
      templateId: 'tpl_1',
    });

    const request = sentRequest(fetchMock);
    expect(request.url).toBe(`${API_BASE_URL}/pdf/template`);
    expect(JSON.parse(String(request.body)).templateId).toBe('tpl_1');
    expect(result.isError).toBeFalsy();
  });
});

const PDF_CALLS: [string, Record<string, unknown>][] = [
  ['generate_pdf_from_html', { html: '<h1>Quarterly report</h1>' }],
  ['generate_pdf_from_template', { templateId: 'tpl_1', modify: { a: 1 } }],
];

describe('PDF tool results', () => {
  let fetchMock: FetchMock;
  let client: Client;

  beforeEach(async () => {
    fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    client = await connect();
  });

  afterEach(async () => {
    await client.close();
    vi.unstubAllGlobals();
  });

  it.each(PDF_CALLS)(
    '%s returns the pdfUrl and the page count in a text result, like the image tools return their URL',
    async (name, args) => {
      fetchMock.mockResolvedValue(jsonResponse(PDF_BODY));

      const result = await call(client, name, args);

      expect(result.isError).toBeFalsy();
      expect(result.content[0]!.type).toBe('text');
      expect(firstText(result)).toContain(PDF_BODY.pdfUrl);
      expect(firstText(result)).toMatch(/\b17\b/);
    }
  );

  // [pdf tool, image sibling, HTTP status, API message, arguments for both]
  it.each<[string, string, number, string, Record<string, unknown>]>([
    [
      'generate_pdf_from_html',
      'generate_image_from_html',
      400,
      'HTML body is required',
      { html: '<p>x</p>' },
    ],
    [
      'generate_pdf_from_html',
      'generate_image_from_html',
      422,
      'Failed to render the document',
      { html: '<p>x</p>' },
    ],
    [
      'generate_pdf_from_template',
      'generate_image_from_template',
      404,
      'Template not found',
      { templateId: 'tpl_missing' },
    ],
    [
      'generate_pdf_from_template',
      'generate_image_from_template',
      422,
      'Invalid modify payload',
      { templateId: 'tpl_1', modify: { a: 1 } },
    ],
  ])(
    '%s returns an error result carrying the API message, the same way %s does (HTTP %i)',
    async (pdfTool, imageTool, status, apiMessage, args) => {
      fetchMock.mockImplementation(async () =>
        jsonResponse({ error: true, message: apiMessage }, status)
      );

      const pdfResult = await call(client, pdfTool, args);
      const imageResult = await call(client, imageTool, args);

      expect(pdfResult.isError).toBe(true);
      expect(firstText(pdfResult)).toContain(apiMessage);
      expect(pdfResult).toEqual(imageResult);
    }
  );
});
