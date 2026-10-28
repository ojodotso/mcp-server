import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { createServer } from '../../src/server/index.js';
import { OjoApiClient } from '../../src/server/ojo-client.js';

// AC1-AC10 (.claude/docs/specs/2026-10-26-mcp-api-parity.md): the MCP tools cover the template
// API (create with name/description/viewport, rename, delete), bulk image renders and the free PDF
// check, plus the `template_from_document` prompt. Driven end to end through the MCP server with a
// real OjoApiClient. Only fetch is stubbed: the oJo API routes are outside this unit.

const API_BASE_URL = 'https://api.example/v1';
const API_KEY = 'ok_parity_key';

const NEW_API_TOOLS = [
  'delete_template',
  'generate_images_from_template',
  'check_pdf',
] as const;

type FetchMock = ReturnType<typeof vi.fn>;

type ToolResult = {
  content: { type: string; text?: string }[];
  isError?: boolean;
};

type ListedTool = Awaited<ReturnType<Client['listTools']>>['tools'][number];

type JsonSchema = {
  type?: unknown;
  properties?: Record<string, JsonSchema>;
  required?: string[];
  items?: JsonSchema;
  minItems?: number;
  maxItems?: number;
};

function jsonResponse(
  body: unknown,
  status = 200,
  extraHeaders: Record<string, string> = {}
): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', ...extraHeaders },
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

function sentJson(fetchMock: FetchMock): Record<string, unknown> {
  return JSON.parse(String(sentRequest(fetchMock).body)) as Record<string, unknown>;
}

function allText(result: ToolResult): string {
  return result.content.map((c) => c.text ?? '').join('\n');
}

async function connect(client_: OjoApiClient | null = new OjoApiClient(API_KEY, API_BASE_URL)) {
  const server = createServer(client_);
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: 'test-client', version: '0.0.0' });
  await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
  return client;
}

async function listTools(client_?: OjoApiClient | null): Promise<ListedTool[]> {
  const client = await connect(client_);
  try {
    return (await client.listTools()).tools;
  } finally {
    await client.close();
  }
}

async function toolNamed(name: string): Promise<ListedTool> {
  const tool = (await listTools()).find((t) => t.name === name);
  expect(tool, `${name} is listed`).toBeDefined();
  return tool!;
}

async function call(name: string, args: Record<string, unknown>): Promise<ToolResult> {
  const client = await connect();
  try {
    return (await client.callTool({ name, arguments: args })) as ToolResult;
  } finally {
    await client.close();
  }
}

async function promptText(name: string, client_?: OjoApiClient | null): Promise<string> {
  const client = await connect(client_);
  try {
    const result = await client.getPrompt({ name });
    return result.messages
      .map((m) => (m.content.type === 'text' ? m.content.text : ''))
      .join('\n');
  } finally {
    await client.close();
  }
}

/**
 * The call is answered with a tool error and never reaches the API. The tool must be registered:
 * the SDK answers an unknown tool with an error result too, which would pass for the wrong reason.
 */
async function expectRejectedBeforeApi(
  fetchMock: FetchMock,
  name: string,
  args: Record<string, unknown>
) {
  await toolNamed(name);
  const result = await call(name, args);
  expect(result.isError, allText(result)).toBe(true);
  expect(allText(result)).not.toMatch(/Tool \S+ not found/);
  expect(fetchMock).not.toHaveBeenCalled();
}

let fetchMock: FetchMock;

beforeEach(() => {
  fetchMock = vi.fn();
  vi.stubGlobal('fetch', fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('AC1: create_template takes name, description and viewport', () => {
  it('AC1: name, description, viewportWidth and viewportHeight are optional inputs', async () => {
    const schema = (await toolNamed('create_template')).inputSchema as JsonSchema;

    expect(schema.properties?.name?.type).toBe('string');
    expect(schema.properties?.description?.type).toBe('string');
    expect(schema.properties?.viewportWidth?.type).toBe('integer');
    expect(schema.properties?.viewportHeight?.type).toBe('integer');
    expect(schema.required ?? []).not.toContain('name');
    expect(schema.required ?? []).not.toContain('description');
    expect(schema.required ?? []).not.toContain('viewportWidth');
    expect(schema.required ?? []).not.toContain('viewportHeight');
  });

  it('AC1: given, they go to POST /v1/template next to html and variables', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ id: 'tpl_new', message: 'Template created' }));
    const args = {
      html: '<h1>{{title}}</h1>',
      variables: { title: 'Invoice' },
      name: 'Invoice',
      description: 'Monthly invoice, A4',
      viewportWidth: 794,
      viewportHeight: 1123,
    };

    const result = await call('create_template', args);

    expect(result.isError, allText(result)).toBeFalsy();
    const sent = sentRequest(fetchMock);
    expect(sent.url).toBe(`${API_BASE_URL}/template`);
    expect(sent.method).toBe('POST');
    expect(JSON.parse(String(sent.body))).toEqual(args);
  });

  it('AC1: a name alone is sent without description or viewport keys', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ id: 'tpl_new', message: 'Template created' }));

    await call('create_template', { html: '<p>x</p>', name: 'Receipt' });

    expect(sentJson(fetchMock)).toEqual({ html: '<p>x</p>', name: 'Receipt' });
  });

  it('AC1: with every optional field left out, the body carries the html only', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ id: 'tpl_new', message: 'Template created' }));

    await call('create_template', { html: '<p>x</p>' });

    expect(sentJson(fetchMock)).toEqual({ html: '<p>x</p>' });
  });
});

describe('AC2: update_template renames, and html is optional', () => {
  it('AC2: name, html, variables, viewportWidth and viewportHeight are optional, templateId required', async () => {
    const schema = (await toolNamed('update_template')).inputSchema as JsonSchema;

    expect(schema.properties?.name?.type).toBe('string');
    expect(schema.properties?.html?.type).toBe('string');
    expect(schema.properties?.variables?.type).toBe('object');
    expect(schema.properties?.viewportWidth?.type).toBe('integer');
    expect(schema.properties?.viewportHeight?.type).toBe('integer');
    expect(schema.required ?? []).toEqual(['templateId']);
  });

  it('AC2: a call with only name PUTs { name } and nothing else', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ id: 'tpl_1', message: 'Template updated' }));

    const result = await call('update_template', { templateId: 'tpl_1', name: 'Invoice v2' });

    expect(result.isError, allText(result)).toBeFalsy();
    const sent = sentRequest(fetchMock);
    expect(sent.url).toBe(`${API_BASE_URL}/template/tpl_1`);
    expect(sent.method).toBe('PUT');
    expect(JSON.parse(String(sent.body))).toEqual({ name: 'Invoice v2' });
  });

  it('AC2: a call with only variables PUTs { variables }', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ id: 'tpl_1', message: 'Template updated' }));

    await call('update_template', { templateId: 'tpl_1', variables: { title: 'Q4' } });

    expect(sentJson(fetchMock)).toEqual({ variables: { title: 'Q4' } });
  });

  it('AC2: name, html and viewport given together all go in the body', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ id: 'tpl_1', message: 'Template updated' }));
    const args = {
      html: '<h1>{{title}}</h1>',
      name: 'Card',
      viewportWidth: 1200,
      viewportHeight: 630,
    };

    await call('update_template', { templateId: 'tpl_1', ...args });

    expect(sentJson(fetchMock)).toEqual(args);
  });

  it('AC2: a call with none of name, html, variables is a tool error and calls no API', async () => {
    await expectRejectedBeforeApi(fetchMock, 'update_template', { templateId: 'tpl_1' });
  });

  it('AC2: a viewport alone (none of name, html, variables) is a tool error and calls no API', async () => {
    await expectRejectedBeforeApi(fetchMock, 'update_template', {
      templateId: 'tpl_1',
      viewportWidth: 800,
      viewportHeight: 600,
    });
  });
});

describe('AC3: delete_template', () => {
  it('AC3: takes templateId (string, required)', async () => {
    const schema = (await toolNamed('delete_template')).inputSchema as JsonSchema;

    expect(schema.properties?.templateId?.type).toBe('string');
    expect(schema.required ?? []).toContain('templateId');
  });

  it('AC3: is annotated destructiveHint true and readOnlyHint false', async () => {
    const tool = await toolNamed('delete_template');

    expect(tool.annotations?.destructiveHint).toBe(true);
    expect(tool.annotations?.readOnlyHint).toBe(false);
  });

  it('AC3: the description says the template and its id stop working for later renders, and it cannot be undone', async () => {
    const description = (await toolNamed('delete_template')).description ?? '';

    expect(description).toMatch(/\bid\b/i);
    expect(description).toMatch(/stops? working/i);
    expect(description).toMatch(/render/i);
    expect(description).toMatch(/(cannot|can't|can not)\s+(be\s+)?undo(ne)?/i);
  });

  it('AC3: calls DELETE /v1/template/:id with the id URL-encoded, the bearer key and the mcp source header', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ deleted: true }));

    const result = await call('delete_template', { templateId: 'tpl/1 x?y' });

    expect(result.isError, allText(result)).toBeFalsy();
    const sent = sentRequest(fetchMock);
    expect(sent.url).toBe(`${API_BASE_URL}/template/${encodeURIComponent('tpl/1 x?y')}`);
    expect(sent.method).toBe('DELETE');
    expect(sent.headers.get('authorization')).toBe(`Bearer ${API_KEY}`);
    expect(sent.headers.get('x-ojo-source')).toBe('mcp');
  });

  it("AC3: a 404 from the API is an error result carrying the API's message", async () => {
    fetchMock.mockResolvedValue(
      jsonResponse({ error: true, message: 'Template not found' }, 404)
    );

    const result = await call('delete_template', { templateId: 'tpl_missing' });

    expect(result.isError).toBe(true);
    expect(allText(result)).toMatch(/Template not found/);
  });
});

describe('AC4: generate_images_from_template', () => {
  const BULK_RESPONSE = {
    images: [
      {
        id: 'img_a',
        templateId: 'tpl_1',
        imageUrl: 'https://cdn.ojo.so/u/first-a.png',
        createdAt: '2026-10-26T00:00:00.000Z',
      },
      {
        id: 'img_b',
        templateId: 'tpl_1',
        imageUrl: 'https://cdn.ojo.so/u/second-b.png',
        createdAt: '2026-10-26T00:00:00.000Z',
        warnings: ['`subtitle` was not given and printed its default'],
      },
      {
        id: 'img_c',
        templateId: 'tpl_1',
        imageUrl: 'https://cdn.ojo.so/u/third-c.png',
        createdAt: '2026-10-26T00:00:00.000Z',
        warnings: ['`colour` is not read by the template'],
      },
    ],
    totalRequested: 3,
    successCount: 3,
    failureCount: 0,
  };

  const MODIFICATIONS = [{ title: 'A' }, { title: 'B' }, { title: 'C', colour: 'red' }];

  it('AC4: takes templateId and modifications (required), viewport, transparentBackground and strict (optional)', async () => {
    const schema = (await toolNamed('generate_images_from_template')).inputSchema as JsonSchema;

    expect(schema.properties?.templateId?.type).toBe('string');
    expect(schema.properties?.modifications?.type).toBe('array');
    expect(schema.properties?.modifications?.items?.type).toBe('object');
    expect(schema.properties?.modifications?.minItems).toBe(1);
    expect(schema.properties?.modifications?.maxItems).toBe(50);
    expect(schema.properties?.viewportWidth?.type).toBe('integer');
    expect(schema.properties?.viewportHeight?.type).toBe('integer');
    expect(schema.properties?.transparentBackground?.type).toBe('boolean');
    expect(schema.properties?.strict?.type).toBe('boolean');
    expect([...(schema.required ?? [])].sort()).toEqual(['modifications', 'templateId']);
  });

  it('AC4: the description states one credit per image', async () => {
    const description = (await toolNamed('generate_images_from_template')).description ?? '';

    expect(description).toMatch(/(one|1) credit (per|for each|for every|an?) image/i);
  });

  it('AC4: POSTs to /v1/image/bulk one template entry carrying the modifications in order', async () => {
    fetchMock.mockResolvedValue(jsonResponse(BULK_RESPONSE));

    const result = await call('generate_images_from_template', {
      templateId: 'tpl_1',
      modifications: MODIFICATIONS,
    });

    expect(result.isError, allText(result)).toBeFalsy();
    const sent = sentRequest(fetchMock);
    expect(sent.url).toBe(`${API_BASE_URL}/image/bulk`);
    expect(sent.method).toBe('POST');
    expect(sent.headers.get('content-type')).toMatch(/^application\/json\b/);
    expect(sent.headers.get('authorization')).toBe(`Bearer ${API_KEY}`);
    expect(sent.headers.get('x-ojo-source')).toBe('mcp');
    const body = JSON.parse(String(sent.body)) as {
      templates: Array<Record<string, unknown>>;
    };
    expect(body.templates).toHaveLength(1);
    expect(body.templates[0]?.templateId).toBe('tpl_1');
    expect(body.templates[0]?.modifications).toEqual(MODIFICATIONS);
  });

  it('AC4: viewport, transparentBackground and strict reach the API', async () => {
    fetchMock.mockResolvedValue(jsonResponse(BULK_RESPONSE));

    await call('generate_images_from_template', {
      templateId: 'tpl_1',
      modifications: MODIFICATIONS,
      viewportWidth: 1200,
      viewportHeight: 630,
      transparentBackground: true,
      strict: true,
    });

    const body = sentJson(fetchMock) as {
      templates: Array<Record<string, unknown>>;
      defaultOptions?: Record<string, unknown>;
      strict?: unknown;
    };
    // The API reads a per-template value first, then defaultOptions: either place is the same request.
    const effective = (key: string) => body.templates[0]?.[key] ?? body.defaultOptions?.[key];
    expect(effective('viewportWidth')).toBe(1200);
    expect(effective('viewportHeight')).toBe(630);
    expect(effective('transparentBackground')).toBe(true);
    expect(body.strict).toBe(true);
  });

  it('AC4: the result lists each image URL in input order and the warning: lines', async () => {
    fetchMock.mockResolvedValue(jsonResponse(BULK_RESPONSE));

    const result = await call('generate_images_from_template', {
      templateId: 'tpl_1',
      modifications: MODIFICATIONS,
    });

    expect(result.isError, allText(result)).toBeFalsy();
    const text = allText(result);
    const positions = BULK_RESPONSE.images.map((image) => text.indexOf(image.imageUrl));
    expect(positions.every((p) => p >= 0), text).toBe(true);
    expect([...positions].sort((a, b) => a - b)).toEqual(positions);
    expect(text).toMatch(/^warning: `subtitle` was not given and printed its default$/m);
    expect(text).toMatch(/^warning: `colour` is not read by the template$/m);
  });

  // AC11: the bulk route answers 200 with `images[]` for what rendered and `errors[]` for what did
  // not (apps/server/src/routes/image.ts:422-428).
  const FAILED = [
    {
      templateId: 'tpl_1',
      modify: { title: 'B', colour: 'red' },
      error: 'Failed to generate image',
      logs: ['Navigation timeout of 30000 ms exceeded'],
    },
    {
      templateId: 'tpl_1',
      modify: { title: 'D' },
      error: 'Some resources could not be loaded',
      logs: ['https://img.example/logo.png: 404'],
    },
  ];

  function failedLines(text: string): string[] {
    return text.split('\n').filter((line) => line.startsWith('failed:'));
  }

  it('AC11: with some images failed, the result lists the rendered images, then one failed: line per failure with its error and modifications as JSON, and is not an error', async () => {
    const rendered = [BULK_RESPONSE.images[0]!, BULK_RESPONSE.images[2]!];
    fetchMock.mockResolvedValue(
      jsonResponse({
        images: rendered,
        errors: FAILED,
        totalRequested: 4,
        successCount: 2,
        failureCount: 2,
      })
    );

    const result = await call('generate_images_from_template', {
      templateId: 'tpl_1',
      modifications: [{ title: 'A' }, FAILED[0]!.modify, { title: 'C' }, FAILED[1]!.modify],
    });

    expect(result.isError, allText(result)).toBeFalsy();
    const text = allText(result);
    const lines = failedLines(text);
    expect(lines, text).toHaveLength(FAILED.length);
    FAILED.forEach((failure, i) => {
      expect(lines[i]).toContain(failure.error);
      expect(lines[i]).toContain(JSON.stringify(failure.modify));
    });
    const firstFailed = text.indexOf('failed:');
    for (const image of rendered) {
      const at = text.indexOf(image.imageUrl);
      expect(at, `${image.imageUrl} is listed`).toBeGreaterThanOrEqual(0);
      expect(at, `${image.imageUrl} comes before the failed: lines`).toBeLessThan(firstFailed);
    }
    expect(text.indexOf(rendered[0]!.imageUrl)).toBeLessThan(text.indexOf(rendered[1]!.imageUrl));
  });

  it('AC11: with every image failed, the result is a tool error listing one failed: line per image', async () => {
    fetchMock.mockResolvedValue(
      jsonResponse({
        images: [],
        errors: FAILED,
        totalRequested: 2,
        successCount: 0,
        failureCount: 2,
      })
    );

    const result = await call('generate_images_from_template', {
      templateId: 'tpl_1',
      modifications: FAILED.map((failure) => failure.modify),
    });

    expect(result.isError, allText(result)).toBe(true);
    const lines = failedLines(allText(result));
    expect(lines, allText(result)).toHaveLength(FAILED.length);
    FAILED.forEach((failure, i) => {
      expect(lines[i]).toContain(failure.error);
      expect(lines[i]).toContain(JSON.stringify(failure.modify));
    });
  });

  it('AC4: a 402 from the API is an error result', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ error: true, message: 'Payment required' }, 402));

    const result = await call('generate_images_from_template', {
      templateId: 'tpl_1',
      modifications: MODIFICATIONS,
    });

    expect(result.isError).toBe(true);
    expect(allText(result)).toMatch(/credit/i);
  });
});

describe('AC5: check_pdf', () => {
  const PDF_BYTES = new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e, 0x37]); // %PDF-1.7
  const WARNINGS = ['Font “Grüße Sans” was not found; printed in serif', 'A row is 100% wider than the page'];

  function pdfResponse(headers: Record<string, string>): Response {
    return new Response(PDF_BYTES, {
      status: 200,
      headers: { 'content-type': 'application/pdf', 'cache-control': 'no-store', ...headers },
    });
  }

  it('AC5: takes html as its only input, shaped like generate_pdf_from_html', async () => {
    const tools = await listTools();
    const check = tools.find((t) => t.name === 'check_pdf')?.inputSchema as JsonSchema | undefined;
    const pdf = tools.find((t) => t.name === 'generate_pdf_from_html')?.inputSchema as JsonSchema;
    expect(check, 'check_pdf is listed').toBeDefined();

    expect(Object.keys(check?.properties ?? {})).toEqual(['html']);
    expect(check?.required).toEqual(['html']);
    expect(check?.properties?.html?.type).toBe(pdf.properties?.html?.type);
  });

  it('AC13: is annotated readOnlyHint true and destructiveHint false', async () => {
    const tool = await toolNamed('check_pdf');

    expect(tool.annotations?.readOnlyHint).toBe(true);
    expect(tool.annotations?.destructiveHint).toBe(false);
  });

  it('AC5: the description says it is free, capped at 30 an hour, and that placeholders are not filled', async () => {
    const description = (await toolNamed('check_pdf')).description ?? '';

    expect(description).toMatch(/free/i);
    expect(description).toMatch(/\b30\b/);
    expect(description).toMatch(/hour/i);
    expect(description).toMatch(/Handlebars|placeholder/i);
    expect(description).toMatch(/sample/i);
  });

  it('AC5: sends the html as text/html to POST /v1/pdf/preview', async () => {
    fetchMock.mockResolvedValue(pdfResponse({ 'x-pdf-pages': '3' }));
    const html = '<style>@page { size: A4 }</style><h1>Invoice 1042 – Grüße</h1>';

    const result = await call('check_pdf', { html });

    expect(result.isError, allText(result)).toBeFalsy();
    const sent = sentRequest(fetchMock);
    expect(sent.url).toBe(`${API_BASE_URL}/pdf/preview`);
    expect(sent.method).toBe('POST');
    // The API compares the content type with `!==`, so it must be exactly text/html.
    expect(sent.headers.get('content-type')).toBe('text/html');
    expect(sent.headers.get('authorization')).toBe(`Bearer ${API_KEY}`);
    expect(sent.body).toBe(html);
  });

  it('AC5: returns the page count and the decoded render warnings, and no file or URL', async () => {
    fetchMock.mockResolvedValue(
      pdfResponse({
        'x-pdf-pages': '37',
        'x-render-warnings': encodeURIComponent(JSON.stringify(WARNINGS)),
      })
    );

    const result = await call('check_pdf', { html: '<p>x</p>' });

    expect(result.isError, allText(result)).toBeFalsy();
    for (const block of result.content) expect(block.type).toBe('text');
    const text = allText(result);
    expect(text).toMatch(/\b37\b/);
    for (const warning of WARNINGS) expect(text).toContain(warning);
    expect(text).not.toContain(encodeURIComponent(WARNINGS[0]!));
    expect(text).not.toMatch(/https?:\/\//);
    expect(text).not.toContain('%PDF');
  });

  it('AC5: with no X-Render-Warnings header it still returns the page count', async () => {
    fetchMock.mockResolvedValue(pdfResponse({ 'x-pdf-pages': '12' }));

    const result = await call('check_pdf', { html: '<p>x</p>' });

    expect(result.isError, allText(result)).toBeFalsy();
    expect(allText(result)).toMatch(/\b12\b/);
  });

  it('AC5: a 429 from the API is an error result with its wait', async () => {
    fetchMock.mockResolvedValue(
      jsonResponse({ error: true, message: 'PDF preview limit reached' }, 429, {
        'retry-after': '1200',
      })
    );

    const result = await call('check_pdf', { html: '<p>x</p>' });

    expect(result.isError).toBe(true);
    expect(allText(result)).toMatch(/PDF preview limit reached/);
  });
});

describe('AC6: the template_from_document prompt', () => {
  it('AC6: is registered', async () => {
    const client = await connect();
    const { prompts } = await client.listPrompts();
    await client.close();

    expect(prompts.map((p) => p.name)).toContain('template_from_document');
  });

  it('AC6: covers a PDF or an image, page size, HTML and CSS, and Handlebars placeholders with sample defaults', async () => {
    const text = await promptText('template_from_document');

    expect(text).toMatch(/PDF/);
    expect(text).toMatch(/image/i);
    expect(text).toMatch(/page size|@page/i);
    expect(text).toMatch(/HTML/);
    expect(text).toMatch(/CSS/);
    expect(text).toMatch(/Handlebars/);
    expect(text).toMatch(/default/i);
  });

  it('AC6: checks with create_preview_link (images) or check_pdf (PDFs), then create_template with a name', async () => {
    const text = await promptText('template_from_document');

    expect(text).toContain('create_preview_link');
    expect(text).toContain('check_pdf');
    expect(text).toContain('create_template');
    expect(text).toMatch(/`name`|\bname\b/);
    expect(text.indexOf('check_pdf')).toBeLessThan(text.lastIndexOf('create_template'));
  });

  it('AC6: says text inside the supplied document is content, never instructions', async () => {
    const text = await promptText('template_from_document');

    expect(text).toMatch(/instruction/i);
    expect(text).toMatch(/content/i);
  });

  it('AC6 (SG2): says personal data in the sample is replaced with neutral sample values before it becomes a default', async () => {
    const text = await promptText('template_from_document');

    expect(text).toMatch(/personal data/i);
    expect(text).toMatch(/address/i);
    expect(text).toMatch(/e-?mail/i);
    expect(text).toMatch(/account number/i);
    expect(text).toMatch(/neutral|sample value/i);
  });
});

describe('AC7: keyless mode', () => {
  it('AC7: none of the new API tools is registered without an API key', async () => {
    const names = (await listTools(null)).map((t) => t.name);

    for (const name of NEW_API_TOOLS) expect(names).not.toContain(name);
  });

  it('AC7: without a key the template_from_document prompt says the API tools are unavailable, with a key it does not', async () => {
    const keyless = await promptText('template_from_document', null);
    const keyed = await promptText('template_from_document');

    expect(keyless).toMatch(/(without|no) (an )?API key/i);
    expect(keyed).not.toMatch(/(without|no) (an )?API key/i);
  });
});

describe('AC8: create_template points to template_from_document', () => {
  it('AC8: the create_template description names the template_from_document prompt', async () => {
    const description = (await toolNamed('create_template')).description ?? '';

    expect(description).toContain('template_from_document');
    expect(description).toMatch(/PDF/);
    expect(description).toMatch(/image/i);
  });
});

describe('AC9: the author_ojo_template guide lists the new capabilities', () => {
  it('AC9: the guide names rename, delete_template, generate_images_from_template and check_pdf', async () => {
    const text = await promptText('author_ojo_template');

    expect(text).toMatch(/renam/i);
    expect(text).toContain('delete_template');
    expect(text).toContain('generate_images_from_template');
    expect(text).toContain('check_pdf');
  });
});

describe('AC10: the tool schemas reject what the API would reject, before any API call', () => {
  const longName = 'n'.repeat(121);

  it.each([
    ['empty', ''],
    ['blank', '   '],
    ['over 120 characters', longName],
  ])('AC10: create_template rejects a name that is %s', async (_label, name) => {
    await expectRejectedBeforeApi(fetchMock, 'create_template', { html: '<p>x</p>', name });
  });

  it.each([
    ['empty', ''],
    ['blank', '   '],
    ['over 120 characters', longName],
  ])('AC10: update_template rejects a name that is %s', async (_label, name) => {
    // html is valid, so the name is the only reason to reject.
    await expectRejectedBeforeApi(fetchMock, 'update_template', {
      templateId: 'tpl_1',
      html: '<p>x</p>',
      name,
    });
  });

  it('AC10: create_template rejects a description over 300 characters', async () => {
    await expectRejectedBeforeApi(fetchMock, 'create_template', {
      html: '<p>x</p>',
      description: 'd'.repeat(301),
    });
  });

  it('AC10: a 120-character name and a 300-character description are accepted', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ id: 'tpl_new', message: 'Template created' }));
    const args = { html: '<p>x</p>', name: 'n'.repeat(120), description: 'd'.repeat(300) };

    const result = await call('create_template', args);

    expect(result.isError, allText(result)).toBeFalsy();
    expect(sentJson(fetchMock)).toEqual(args);
  });

  it('AC10: generate_images_from_template rejects an empty modifications array', async () => {
    await expectRejectedBeforeApi(fetchMock, 'generate_images_from_template', {
      templateId: 'tpl_1',
      modifications: [],
    });
  });

  it('AC10: generate_images_from_template rejects more than 50 modifications', async () => {
    await expectRejectedBeforeApi(fetchMock, 'generate_images_from_template', {
      templateId: 'tpl_1',
      modifications: Array.from({ length: 51 }, (_, i) => ({ title: `T${i}` })),
    });
  });

  it('AC10: generate_images_from_template accepts exactly 50 modifications', async () => {
    const modifications = Array.from({ length: 50 }, (_, i) => ({ title: `T${i}` }));
    fetchMock.mockResolvedValue(
      jsonResponse({
        images: modifications.map((_, i) => ({
          id: `img_${i}`,
          templateId: 'tpl_1',
          imageUrl: `https://cdn.ojo.so/u/${i}.png`,
        })),
        totalRequested: 50,
        successCount: 50,
        failureCount: 0,
      })
    );

    const result = await call('generate_images_from_template', {
      templateId: 'tpl_1',
      modifications,
    });

    expect(result.isError, allText(result)).toBeFalsy();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it.each([
    ['a string', 'title=A'],
    ['a number', 42],
    ['null', null],
    ['an array', [{ title: 'A' }]],
  ])('AC10: generate_images_from_template rejects a modifications item that is %s', async (_label, item) => {
    await expectRejectedBeforeApi(fetchMock, 'generate_images_from_template', {
      templateId: 'tpl_1',
      modifications: [{ title: 'ok' }, item],
    });
  });
});

describe('AC14: update_template refuses a viewport the API would drop', () => {
  it.each([
    ['name + viewportWidth', { name: 'Card', viewportWidth: 1200 }],
    ['name + viewportHeight', { name: 'Card', viewportHeight: 630 }],
    ['name + both viewport sides', { name: 'Card', viewportWidth: 1200, viewportHeight: 630 }],
    ['an empty html + viewport', { html: '', viewportWidth: 1200, viewportHeight: 630 }],
    ['name + an empty html + viewport', { name: 'Card', html: '', viewportWidth: 1200 }],
  ])('AC14: %s, with neither html nor variables, is a tool error and calls no API', async (_label, args) => {
    await expectRejectedBeforeApi(fetchMock, 'update_template', { templateId: 'tpl_1', ...args });
  });

  it('AC14: an empty html string alone counts as not given: a tool error, no API call', async () => {
    await expectRejectedBeforeApi(fetchMock, 'update_template', { templateId: 'tpl_1', html: '' });
  });

  it('AC14: a viewport with variables is sent', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ id: 'tpl_1', message: 'Template updated' }));
    const args = { variables: { title: 'Q4' }, viewportWidth: 1200, viewportHeight: 630 };

    const result = await call('update_template', { templateId: 'tpl_1', ...args });

    expect(result.isError, allText(result)).toBeFalsy();
    expect(sentJson(fetchMock)).toEqual(args);
  });
});

describe('AC15: a name is checked on its trimmed length', () => {
  const name120 = 'n'.repeat(120);
  const name121Padded = ` ${'n'.repeat(121)} `;

  it('AC15: create_template accepts a 120-character name with a trailing space', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ id: 'tpl_new', message: 'Template created' }));

    const result = await call('create_template', { html: '<p>x</p>', name: `${name120} ` });

    expect(result.isError, allText(result)).toBeFalsy();
    expect(String(sentJson(fetchMock).name).trim()).toBe(name120);
  });

  it('AC15: update_template accepts a 120-character name with a trailing space', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ id: 'tpl_1', message: 'Template updated' }));

    const result = await call('update_template', { templateId: 'tpl_1', name: `${name120} ` });

    expect(result.isError, allText(result)).toBeFalsy();
    expect(String(sentJson(fetchMock).name).trim()).toBe(name120);
  });

  it('AC15: create_template rejects a name that is 121 characters after trimming', async () => {
    await expectRejectedBeforeApi(fetchMock, 'create_template', {
      html: '<p>x</p>',
      name: name121Padded,
    });
  });

  it('AC15: update_template rejects a name that is 121 characters after trimming', async () => {
    await expectRejectedBeforeApi(fetchMock, 'update_template', {
      templateId: 'tpl_1',
      html: '<p>x</p>',
      name: name121Padded,
    });
  });
});
