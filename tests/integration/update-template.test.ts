import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { createServer } from '../../src/server/index.js';
import { OjoApiClient } from '../../src/server/ojo-client.js';

// AC594-AC597 (.claude/docs/specs/2026-10-14-mcp-update-template.md): the `update_template` tool,
// driven end to end through the MCP server with a real OjoApiClient. Only the HTTP layer (fetch)
// is stubbed: the oJo API's PUT /v1/template/:id is outside this unit.

const API_BASE_URL = 'https://api.example/v1';
const API_KEY = 'ok_update_key';

const DESCRIPTION =
  'Replace the HTML of an existing oJo template this account owns, and its variable defaults ' +
  'when `variables` is given (left out, the stored defaults stay). The template keeps its ID: API ' +
  'renders and an oJo editor open on it use the new version at once, so check the design with ' +
  '`create_preview_link` first. Does not cost a credit.';

type FetchMock = ReturnType<typeof vi.fn>;

type ToolResult = {
  content: { type: string; text?: string }[];
  isError?: boolean;
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

async function call(name: string, args: Record<string, unknown>): Promise<ToolResult> {
  const client = await connect();
  try {
    return (await client.callTool({ name, arguments: args })) as ToolResult;
  } finally {
    await client.close();
  }
}

const base64 = (text: string) => Buffer.from(text, 'utf-8').toString('base64');

describe('AC594: update_template is registered only with an API key', () => {
  it('AC594: with an API key, update_template is listed, titled "Update template"', async () => {
    const client = await connect();
    const { tools } = await client.listTools();
    await client.close();

    const tool = tools.find((t) => t.name === 'update_template');
    expect(tool, 'update_template is listed').toBeDefined();
    expect(tool?.title).toBe('Update template');
  });

  it('AC594: in preview-only mode (no key) update_template is not registered', async () => {
    const client = await connect(null);
    const { tools } = await client.listTools();
    await client.close();

    expect(tools.map((t) => t.name)).not.toContain('update_template');
  });

  it('AC594: input is templateId and html (strings, required) and variables (object, optional)', async () => {
    const client = await connect();
    const { tools } = await client.listTools();
    await client.close();

    const schema = tools.find((t) => t.name === 'update_template')?.inputSchema as
      | { type?: string; properties?: Record<string, { type?: unknown }>; required?: string[] }
      | undefined;
    expect(schema, 'update_template is listed').toBeDefined();
    expect(schema?.type).toBe('object');
    expect(Object.keys(schema?.properties ?? {}).sort()).toEqual(['html', 'templateId', 'variables']);
    expect(schema?.properties?.templateId?.type).toBe('string');
    expect(schema?.properties?.html?.type).toBe('string');
    expect(schema?.properties?.variables?.type).toBe('object');
    expect([...(schema?.required ?? [])].sort()).toEqual(['html', 'templateId']);
  });

  it('AC594: annotations are readOnlyHint false, destructiveHint true, idempotentHint true', async () => {
    const client = await connect();
    const { tools } = await client.listTools();
    await client.close();

    const tool = tools.find((t) => t.name === 'update_template');
    expect(tool, 'update_template is listed').toBeDefined();
    expect(tool?.annotations?.readOnlyHint).toBe(false);
    expect(tool?.annotations?.destructiveHint).toBe(true);
    expect(tool?.annotations?.idempotentHint).toBe(true);
  });
});

describe('AC597: update_template description', () => {
  it('AC597: the description reads exactly as the spec fixes it', async () => {
    const client = await connect();
    const { tools } = await client.listTools();
    await client.close();

    const tool = tools.find((t) => t.name === 'update_template');
    expect(tool, 'update_template is listed').toBeDefined();
    expect(tool?.description).toBe(DESCRIPTION);
  });
});

describe('AC595/AC596: update_template calls PUT /v1/template/:id', () => {
  let fetchMock: FetchMock;

  beforeEach(() => {
    fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('AC595: PUTs to the configured base with the id URL-encoded, the bearer key and the mcp source header', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ id: 'tpl/1 x?y', message: 'Template updated' }));

    await call('update_template', { templateId: 'tpl/1 x?y', html: '<h1>hi</h1>' });

    const sent = sentRequest(fetchMock);
    expect(sent.url).toBe(`${API_BASE_URL}/template/${encodeURIComponent('tpl/1 x?y')}`);
    expect(sent.method).toBe('PUT');
    expect(sent.headers.get('authorization')).toBe(`Bearer ${API_KEY}`);
    expect(sent.headers.get('x-ojo-source')).toBe('mcp');
    expect(sent.headers.get('content-type')).toMatch(/^application\/json\b/);
  });

  // AC595 as amended by AC725 (.claude/docs/specs/2026-10-16-plain-html-templates.md): the html
  // goes plain, no longer base64-encoded.
  it('AC595/AC725: the body carries the html plain and no variables key when variables is left out', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ id: 'tpl_1', message: 'Template updated' }));
    const html = '<h1>{{title}} – Café ✓</h1>';

    await call('update_template', { templateId: 'tpl_1', html });

    const body = JSON.parse(String(sentRequest(fetchMock).body)) as Record<string, unknown>;
    expect(body).toEqual({ html });
    expect('variables' in body).toBe(false);
  });

  it('AC595/AC725: variables, when given, go in the body next to the plain html', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ id: 'tpl_1', message: 'Template updated' }));
    const html = '<h1>{{title}}</h1><p>{{items.0.name}}</p>';
    const variables = { title: 'Q4', items: [{ name: 'A' }] };

    await call('update_template', { templateId: 'tpl_1', html, variables });

    const body = JSON.parse(String(sentRequest(fetchMock).body)) as Record<string, unknown>;
    expect(body).toEqual({ html, variables });
  });

  it('AC725: create_template POSTs the html plain, variables next to it', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ id: 'tpl_new', message: 'Template created' }));
    const html = '<p class="a">Grüße "{{name}}"\n✓</p>';
    const variables = { name: 'Ada' };

    const result = await call('create_template', { html, variables });

    expect(result.isError, allText(result)).toBeFalsy();
    const sent = sentRequest(fetchMock);
    expect(sent.url).toBe(`${API_BASE_URL}/template`);
    expect(sent.method).toBe('POST');
    expect(JSON.parse(String(sent.body))).toEqual({ html, variables });
  });

  it('AC726: get_template returns plain HTML from the API as sent', async () => {
    const html = '<p class="a">Grüße "{{name}}"\n✓ QUJD</p>';
    fetchMock.mockResolvedValue(
      jsonResponse({ id: 'tpl_1', name: 'n', html, variables: {}, createdAt: 'c', updatedAt: 'u' })
    );

    const result = await call('get_template', { templateId: 'tpl_1' });

    expect(result.isError, allText(result)).toBeFalsy();
    expect(JSON.parse(result.content[0]?.text ?? '').html).toBe(html);
  });

  it('AC726: get_template returns plain text without < unchanged (reviewer F3)', async () => {
    const html = 'Hello {{name}}';
    fetchMock.mockResolvedValue(
      jsonResponse({ id: 'tpl_1', name: 'n', html, variables: {}, createdAt: 'c', updatedAt: 'u' })
    );

    const result = await call('get_template', { templateId: 'tpl_1' });

    expect(result.isError, allText(result)).toBeFalsy();
    expect(JSON.parse(result.content[0]?.text ?? '').html).toBe(html);
  });

  // AC732 supersedes the decode half of AC726: get_template decodes nothing.
  it('AC732: get_template returns base64 html from the API unchanged, decoding nothing', async () => {
    const html = base64('<p>Grüße {{name}} ✓</p>');
    fetchMock.mockResolvedValue(
      jsonResponse({ id: 'tpl_1', name: 'n', html, variables: {}, createdAt: 'c', updatedAt: 'u' })
    );

    const result = await call('get_template', { templateId: 'tpl_1' });

    expect(result.isError, allText(result)).toBeFalsy();
    expect(JSON.parse(result.content[0]?.text ?? '').html).toBe(html);
  });

  it("AC596: a success returns the API's JSON (id, message) as text", async () => {
    fetchMock.mockResolvedValue(jsonResponse({ id: 'tpl_1', message: 'Template updated' }));

    const result = await call('update_template', { templateId: 'tpl_1', html: '<p>x</p>' });

    expect(result.isError, allText(result)).toBeFalsy();
    expect(result.content[0]?.type).toBe('text');
    expect(JSON.parse(result.content[0]?.text ?? '')).toEqual({
      id: 'tpl_1',
      message: 'Template updated',
    });
  });

  // The same failure, answered to update_template and to get_template, gives the same error result.
  const FAILURES = [
    {
      label: '404 Template not found',
      status: 404,
      body: { error: true, message: 'Template not found' },
      headers: {},
      expectText: [/Template not found/],
    },
    {
      label: "422 with the API's message",
      status: 422,
      body: {
        error: true,
        message: 'Failed to decode `html`. Ensure it is properly encoded.',
      },
      headers: {},
      expectText: [/Failed to decode `html`\. Ensure it is properly encoded/],
    },
    {
      label: 'a 429 with its retry hint',
      status: 429,
      body: { error: true, message: 'Template rate limit reached' },
      headers: { 'retry-after': '30' },
      expectText: [/Template rate limit reached/, /\b30\s*(?:s|secs?|seconds?)\b/i],
    },
  ] as const;

  it.each(FAILURES)(
    'AC596: $label is an error result, the same one the other tools give',
    async ({ status, body, headers, expectText }) => {
      fetchMock.mockImplementation(async () => jsonResponse(body, status, headers));

      const updated = await call('update_template', { templateId: 'tpl_1', html: '<p>x</p>' });
      const fetched = await call('get_template', { templateId: 'tpl_1' });

      expect(updated.isError, allText(updated)).toBe(true);
      for (const pattern of expectText) {
        expect(allText(updated)).toMatch(pattern);
      }
      expect(updated).toEqual(fetched);
    }
  );
});
