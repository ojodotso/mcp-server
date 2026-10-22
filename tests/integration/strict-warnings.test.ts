import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { createServer } from '../../src/server/index.js';
import { OjoApiClient } from '../../src/server/ojo-client.js';

// AC189: the template render tools take `strict`, pass it to the API and print the
// API's warnings; the template read tools say their result lists the template's
// inputs. Driven through the MCP server with a real OjoApiClient. Only fetch is
// stubbed: the oJo API is outside this unit.

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

function sentBody(fetchMock: FetchMock): Record<string, unknown> {
  expect(fetchMock).toHaveBeenCalledTimes(1);
  const [, init] = fetchMock.mock.calls[0]! as [string | URL, { body?: unknown }];
  return JSON.parse(String(init.body)) as Record<string, unknown>;
}

function allText(result: ToolResult): string {
  return result.content
    .filter((block) => block.type === 'text')
    .map((block) => block.text ?? '')
    .join('\n');
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

const IMAGE_BODY = {
  id: 'img_1',
  imageUrl: 'https://cdn.ojo.so/renders/cert.png',
  createdAt: '2026-10-07T00:00:00.000Z',
};

const PDF_BODY = {
  id: 'pdf_1',
  pdfUrl: 'https://cdn.ojo.so/renders/cert.pdf',
  pages: 2,
  credits: 1,
  createdAt: '2026-10-07T00:00:00.000Z',
};

const WARNINGS = [
  "'recipent_name' is not used by the template",
  "'recipient_name' was not sent, so the stored sample value was used",
  "'modules[1].title' was not sent and has no stored value, so it renders empty",
];

const PAGE_WARNINGS = [
  "pages[1]: 'recipent_name' is not used by the template",
  "pages[1]: 'recipient_name' was not sent, so the stored sample value was used",
];

// [tool, arguments without strict, API answer without warnings]
const RENDER_TOOLS: Array<[string, Record<string, unknown>, Record<string, unknown>]> = [
  ['generate_image_from_template', { templateId: 'tpl_1', modify: { recipient_name: 'Ada' } }, IMAGE_BODY],
  ['generate_pdf_from_template', { templateId: 'tpl_1', modify: { recipient_name: 'Ada' } }, PDF_BODY],
  [
    'generate_pdf_from_template',
    { templateId: 'tpl_1', modify: { issuer: { name: 'N' } }, pages: [{ modify: { recipient_name: 'Ada' } }, {}] },
    { ...PDF_BODY, entries: [{ index: 0, pages: 1 }, { index: 1, pages: 1 }] },
  ],
];

describe('AC189: strict and warnings on the template render tools', () => {
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

  it.each(['generate_image_from_template', 'generate_pdf_from_template'])(
    '%s takes an optional boolean strict',
    async (name) => {
      const { tools } = await client.listTools();
      const schema = toolNamed(tools, name).inputSchema;

      expect(schema.properties).toHaveProperty('strict');
      expect(shapeOf(schema.properties?.strict)).toEqual({ type: 'boolean' });
      expect(schema.required ?? []).not.toContain('strict');
    }
  );

  it.each(RENDER_TOOLS)(
    '%s passes strict: true to the API with the rest of the request (%j)',
    async (name, args, answer) => {
      fetchMock.mockResolvedValue(jsonResponse(answer));

      const result = await call(client, name, { ...args, strict: true });

      expect(result.isError).toBeFalsy();
      expect(sentBody(fetchMock)).toMatchObject({ ...args, strict: true });
    }
  );

  it.each(RENDER_TOOLS)(
    '%s passes strict: false to the API as given (%j)',
    async (name, args, answer) => {
      fetchMock.mockResolvedValue(jsonResponse(answer));

      await call(client, name, { ...args, strict: false });

      expect(sentBody(fetchMock)).toMatchObject({ ...args, strict: false });
    }
  );

  it('generate_image_from_template prints each warning of the API response on its own line starting "warning: "', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ ...IMAGE_BODY, warnings: WARNINGS }));

    const result = await call(client, 'generate_image_from_template', RENDER_TOOLS[0]![1]);

    expect(result.isError).toBeFalsy();
    const lines = allText(result).split('\n');
    for (const warning of WARNINGS) {
      expect(lines).toContain(`warning: ${warning}`);
    }
    expect(lines.filter((line) => line.startsWith('warning: '))).toHaveLength(WARNINGS.length);
    expect(allText(result)).toContain(IMAGE_BODY.imageUrl);
  });

  it('generate_pdf_from_template prints each warning of the API response on its own line starting "warning: "', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ ...PDF_BODY, warnings: WARNINGS }));

    const result = await call(client, 'generate_pdf_from_template', RENDER_TOOLS[1]![1]);

    expect(result.isError).toBeFalsy();
    const lines = allText(result).split('\n');
    for (const warning of WARNINGS) {
      expect(lines).toContain(`warning: ${warning}`);
    }
    expect(lines.filter((line) => line.startsWith('warning: '))).toHaveLength(WARNINGS.length);
    expect(allText(result)).toContain(PDF_BODY.pdfUrl);
  });

  it('generate_pdf_from_template with pages prints the page-prefixed warnings as the API sent them', async () => {
    fetchMock.mockResolvedValue(
      jsonResponse({ ...RENDER_TOOLS[2]![2], warnings: PAGE_WARNINGS })
    );

    const result = await call(client, 'generate_pdf_from_template', RENDER_TOOLS[2]![1]);

    expect(result.isError).toBeFalsy();
    const lines = allText(result).split('\n');
    for (const warning of PAGE_WARNINGS) {
      expect(lines).toContain(`warning: ${warning}`);
    }
  });

  it.each(RENDER_TOOLS)(
    '%s prints no warning line when the API answers none (%j)',
    async (name, args, answer) => {
      fetchMock.mockResolvedValue(jsonResponse(answer));

      const result = await call(client, name, args);

      expect(result.isError).toBeFalsy();
      expect(allText(result).split('\n').some((line) => line.startsWith('warning: '))).toBe(false);
    }
  );
});

describe('AC189: the template read tools say their result lists the inputs', () => {
  let client: Client;

  beforeEach(async () => {
    vi.stubGlobal('fetch', vi.fn());
    client = await connect();
  });

  afterEach(async () => {
    await client.close();
    vi.unstubAllGlobals();
  });

  it.each(['get_template', 'list_templates'])(
    "%s's description mentions the template's inputs",
    async (name) => {
      const { tools } = await client.listTools();
      const description = toolNamed(tools, name).description ?? '';

      expect(description).toMatch(/\binputs\b/);
    }
  );
});
