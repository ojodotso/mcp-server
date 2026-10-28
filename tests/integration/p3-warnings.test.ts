import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { createServer } from '../../src/server/index.js';
import { OjoApiClient } from '../../src/server/ojo-client.js';

// .claude/docs/specs/2026-10-27-api-p3-additive-contract.md:
// AC1460 The MCP client (source) shows the `warnings` of template create, template update and bulk
//   answers to the agent, as it already does for single renders (one `warning: <text>` line each).
// AC1453 The bodies the source build sends produce no unknown-field warning: each JSON body uses
//   only the field names its route reads.
//
// Driven through the MCP server with a real OjoApiClient. Only fetch is stubbed: the oJo API is
// outside this unit.

const API_BASE_URL = 'https://api.example/v1';
const API_KEY = 'ok_p3_key';

type FetchMock = ReturnType<typeof vi.fn>;
type ToolResult = { content: { type: string; text?: string }[]; isError?: boolean };

const jsonResponse = (body: unknown, status = 200, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', ...headers } });

const allText = (result: ToolResult) =>
  result.content
    .filter((block) => block.type === 'text')
    .map((block) => block.text ?? '')
    .join('\n');

async function connect() {
  const server = createServer(new OjoApiClient(API_KEY, API_BASE_URL));
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: 'test-client', version: '0.0.0' });
  await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
  return client;
}

const call = async (client: Client, name: string, args: Record<string, unknown>) =>
  (await client.callTool({ name, arguments: args })) as ToolResult;

const WARNINGS = ['Unknown field `colour` was ignored', 'Unknown field `size` was ignored'];
const BULK_WARNINGS = ['templates[0]: unknown field `colour` was ignored'];

const expectWarningLines = (result: ToolResult, warnings: string[]) => {
  expect(result.isError, allText(result)).toBeFalsy();
  const lines = allText(result).split('\n');
  for (const warning of warnings) {
    expect(lines, allText(result)).toContain(`warning: ${warning}`);
  }
  expect(lines.filter((line) => line.startsWith('warning: '))).toHaveLength(warnings.length);
};

describe('AC1460: the template create, template update and bulk tools show the answer warnings', () => {
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

  it('create_template prints each warning on its own "warning: " line', async () => {
    fetchMock.mockResolvedValue(
      jsonResponse({ id: 'tpl_new', message: 'Template created', warnings: WARNINGS }, 201, {
        location: '/v1/template/tpl_new',
      })
    );

    const result = await call(client, 'create_template', { html: '<h1>{{title}}</h1>' });

    expectWarningLines(result, WARNINGS);
    expect(allText(result)).toContain('tpl_new');
  });

  it('update_template prints each warning on its own "warning: " line', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ id: 'tpl_1', message: 'Template updated', warnings: WARNINGS }));

    const result = await call(client, 'update_template', { templateId: 'tpl_1', html: '<h2>{{title}}</h2>' });

    expectWarningLines(result, WARNINGS);
    expect(allText(result)).toContain('tpl_1');
  });

  it('generate_images_from_template prints the top-level warnings of the bulk answer, beside the per-image ones', async () => {
    const IMAGE_WARNING = "'recipent' is not used by the template";
    fetchMock.mockResolvedValue(
      jsonResponse({
        images: [
          { id: 'img_1', templateId: 'tpl_1', imageUrl: 'https://cdn.ojo.so/a.png', createdAt: '2026-10-27T00:00:00.000Z', warnings: [IMAGE_WARNING] },
          { id: 'img_2', templateId: 'tpl_1', imageUrl: 'https://cdn.ojo.so/b.png', createdAt: '2026-10-27T00:00:00.000Z' },
        ],
        totalRequested: 2,
        successCount: 2,
        failureCount: 0,
        warnings: BULK_WARNINGS,
      })
    );

    const result = await call(client, 'generate_images_from_template', {
      templateId: 'tpl_1',
      modifications: [{ title: 'A' }, { title: 'B' }],
    });

    expectWarningLines(result, [IMAGE_WARNING, ...BULK_WARNINGS]);
    expect(allText(result)).toContain('https://cdn.ojo.so/a.png');
  });

  it.each([
    ['create_template', { html: '<h1>{{title}}</h1>' }, { id: 'tpl_new', message: 'Template created' }, 201],
    ['update_template', { templateId: 'tpl_1', html: '<h2>{{title}}</h2>' }, { id: 'tpl_1', message: 'Template updated' }, 200],
  ] as const)('control: %s prints no warning line when the answer has none', async (name, args, body, status) => {
    fetchMock.mockResolvedValue(jsonResponse(body, status));

    const result = await call(client, name, args);

    expect(result.isError).toBeFalsy();
    expect(allText(result).split('\n').filter((line) => line.startsWith('warning: '))).toHaveLength(0);
  });
});

// The fields each route reads (spec AC1452), the bulk item's `modify` (AC1449) included.
const READ = {
  '/image/template': ['templateId', 'modify', 'viewportWidth', 'viewportHeight', 'transparentBackground', 'strict'],
  '/image/bulk': ['templates', 'defaultOptions', 'strict'],
  '/image/bulk item': ['templateId', 'modifications', 'modify', 'viewportWidth', 'viewportHeight', 'transparentBackground'],
  '/pdf/template': ['templateId', 'modify', 'pages', 'strict'],
  '/template': ['html', 'variables', 'name', 'description', 'viewportWidth', 'viewportHeight'],
};

describe('AC1453: the source client sends only the fields each route reads', () => {
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

  const sentJson = () => {
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0]! as [string | URL, { body?: unknown }];
    return { path: new URL(String(url)).pathname.replace(/^\/v1/, ''), body: JSON.parse(String(init.body)) as Record<string, any> };
  };

  const expectOnly = (body: Record<string, unknown>, read: string[]) => {
    const extra = Object.keys(body).filter((key) => !read.includes(key));
    expect(extra, JSON.stringify(body)).toEqual([]);
  };

  const VIEWPORT = { viewportWidth: 1200, viewportHeight: 630, transparentBackground: true };

  it('generate_image_from_template', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ id: 'i', imageUrl: 'https://cdn.ojo.so/i.png', createdAt: 'x' }));

    await call(client, 'generate_image_from_template', { templateId: 't', modify: { a: 1 }, strict: true, ...VIEWPORT });

    const { path, body } = sentJson();
    expect(path).toBe('/image/template');
    expectOnly(body, READ['/image/template']);
  });

  it('generate_images_from_template', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ images: [], totalRequested: 1, successCount: 0, failureCount: 1, errors: [] }));

    await call(client, 'generate_images_from_template', { templateId: 't', modifications: [{ a: 1 }], strict: true, ...VIEWPORT });

    const { path, body } = sentJson();
    expect(path).toBe('/image/bulk');
    expectOnly(body, READ['/image/bulk']);
    for (const item of body.templates) expectOnly(item, READ['/image/bulk item']);
  });

  it('generate_pdf_from_template with pages', async () => {
    fetchMock.mockResolvedValue(
      jsonResponse({ id: 'p', pdfUrl: 'https://cdn.ojo.so/p.pdf', pages: 2, credits: 1, createdAt: 'x', entries: [] })
    );

    await call(client, 'generate_pdf_from_template', { templateId: 't', modify: { a: 1 }, pages: [{}, {}], strict: false });

    const { path, body } = sentJson();
    expect(path).toBe('/pdf/template');
    expectOnly(body, READ['/pdf/template']);
  });

  it('create_template', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ id: 'n', message: 'Template created' }, 201));

    await call(client, 'create_template', {
      html: '<p>{{a}}</p>',
      name: 'N',
      description: 'D',
      variables: { a: '1' },
      viewportWidth: 800,
      viewportHeight: 600,
    });

    const { path, body } = sentJson();
    expect(path).toBe('/template');
    expectOnly(body, READ['/template']);
  });

  it('update_template', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ id: 't', message: 'Template updated' }));

    await call(client, 'update_template', {
      templateId: 't',
      html: '<p>{{a}}</p>',
      name: 'N',
      variables: { a: '1' },
      viewportWidth: 800,
      viewportHeight: 600,
    });

    const { path, body } = sentJson();
    expect(path).toBe('/template/t');
    expectOnly(body, READ['/template']);
  });
});
