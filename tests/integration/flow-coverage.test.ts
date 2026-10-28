import { createServer as createHttpServer, type RequestListener, type Server } from 'node:http';
import { randomBytes } from 'node:crypto';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { EncryptJWT } from 'jose';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { createServer } from '../../src/server/index.js';
import { OjoApiClient } from '../../src/server/ojo-client.js';

// AC1375-AC1377, AC1381-AC1384 (.claude/docs/specs/2026-10-26-flow-coverage.md).
//
// Two servers, each driven through an MCP client:
// - local: createServer with an OjoApiClient, as the stdio entry (src/index.ts) builds it;
// - remote: createHttpApp (src/transports/http.ts), the Streamable HTTP server behind mcp.ojo.so,
//   reached with an access token as oJo's authorization server encrypts it.
// Outside the unit and faked: the oJo API, a local HTTP server whose answers each test sets.

const RESOURCE_URL = 'https://mcp.ojo.so/mcp';
const ISSUER = 'https://ojo.so';
const WEB_BASE_URL = 'https://ojo.so';
const API_KEY = 'ok_flow_coverage_key';
const TOKEN_KEY = new Uint8Array(randomBytes(32));

const OUT_OF_CREDITS =
  'Not enough credits for this render. Choose a plan at https://ojo.so/pricing.';

// --- fake oJo API ---------------------------------------------------------------------

type ApiRequest = { method: string; path: string; query: URLSearchParams; authorization?: string };
type Answer = { status: number; body: unknown };

const apiRequests: ApiRequest[] = [];
let answer: (req: ApiRequest) => Answer = () => ({ status: 404, body: { error: true, message: 'not found' } });

const fake = createHttpServer((req, res) => {
  const url = new URL(req.url ?? '/', 'http://fake');
  const entry = {
    method: req.method ?? '',
    path: url.pathname,
    query: url.searchParams,
    authorization: req.headers.authorization,
  };
  apiRequests.push(entry);
  req.resume();
  req.on('end', () => {
    const { status, body } = answer(entry);
    res.writeHead(status, { 'content-type': 'application/json' });
    res.end(JSON.stringify(body));
  });
});

let mcp: Server;
let API_BASE_URL = '';
let MCP_URL = '';

const listen = (server: Server) =>
  new Promise<number>((resolve) =>
    server.listen(0, '127.0.0.1', () => resolve((server.address() as { port: number }).port))
  );
const close = (server: Server | undefined) =>
  new Promise<void>((resolve) => {
    if (!server?.listening) return resolve();
    server.closeAllConnections();
    server.close(() => resolve());
  });

beforeAll(async () => {
  API_BASE_URL = `http://127.0.0.1:${await listen(fake)}/v1`;
  const { createHttpApp } = await import('../../src/transports/http.js');
  const handler = createHttpApp({
    resourceUrl: RESOURCE_URL,
    issuer: ISSUER,
    apiBaseUrl: API_BASE_URL,
    webBaseUrl: WEB_BASE_URL,
    tokenKey: TOKEN_KEY,
  }) as RequestListener;
  mcp = createHttpServer(handler);
  MCP_URL = `http://127.0.0.1:${await listen(mcp)}/mcp`;
});

afterAll(async () => {
  await close(mcp);
  await close(fake);
});

beforeEach(() => {
  apiRequests.length = 0;
  answer = () => ({ status: 404, body: { error: true, message: 'not found' } });
});

// --- MCP clients ----------------------------------------------------------------------

type Kind = 'local' | 'remote';
const KINDS: Kind[] = ['local', 'remote'];

const accessToken = () => {
  const now = Math.floor(Date.now() / 1000);
  return new EncryptJWT({
    iss: ISSUER,
    aud: RESOURCE_URL,
    sub: '0b6f3c1e-4a2d-4f8e-9c5b-7d1a2e3f4a5b',
    gid: '1a2b3c4d-0000-4000-8000-00000000000a',
    iat: now - 10,
    exp: now + 3600,
    key: API_KEY,
  })
    .setProtectedHeader({ alg: 'dir', enc: 'A256GCM' })
    .encrypt(TOKEN_KEY);
};

async function connect(kind: Kind): Promise<Client> {
  const client = new Client({ name: 'flow-coverage-test', version: '0.0.0' });
  if (kind === 'local') {
    const server = createServer(new OjoApiClient(API_KEY, API_BASE_URL), WEB_BASE_URL);
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
  } else {
    const transport = new StreamableHTTPClientTransport(new URL(MCP_URL), {
      requestInit: { headers: { Authorization: `Bearer ${await accessToken()}` } },
    });
    await client.connect(transport);
  }
  return client;
}

type ListedTool = Awaited<ReturnType<Client['listTools']>>['tools'][number];
type ToolResult = { content: Array<{ type: string; text?: string }>; isError?: boolean };

async function listTools(kind: Kind): Promise<ListedTool[]> {
  const client = await connect(kind);
  try {
    return (await client.listTools()).tools;
  } finally {
    await client.close();
  }
}

async function toolNamed(kind: Kind, name: string): Promise<ListedTool> {
  const tool = (await listTools(kind)).find((t) => t.name === name);
  expect(tool, `${name} is listed on the ${kind} server`).toBeDefined();
  return tool!;
}

/** A tool call; an argument error the SDK throws instead of answering is returned as an error. */
async function call(kind: Kind, name: string, args: Record<string, unknown>): Promise<ToolResult> {
  const client = await connect(kind);
  try {
    return (await client.callTool({ name, arguments: args })) as ToolResult;
  } catch (error) {
    return { content: [{ type: 'text', text: String(error) }], isError: true };
  } finally {
    await client.close();
  }
}

const textOf = (result: ToolResult) => result.content.map((c) => c.text ?? '').join('\n');

/** The API requests a tool call made, the MCP handshake excluded (it never reaches the API). */
const apiCalls = () => apiRequests.filter((r) => r.path.startsWith('/v1/'));

const json = (status: number, body: unknown): Answer => ({ status, body });

// --- AC1375 ---------------------------------------------------------------------------

describe('AC1375: delete_template is local only', () => {
  it('AC1375: the remote server does not list delete_template', async () => {
    const names = (await listTools('remote')).map((t) => t.name);

    expect(names.length).toBeGreaterThan(0);
    expect(names).not.toContain('delete_template');
  });

  it('AC1375: the local (stdio) server lists delete_template', async () => {
    const names = (await listTools('local')).map((t) => t.name);

    expect(names).toContain('delete_template');
  });

  it('AC1375: a delete_template call on the remote server never reaches the API', async () => {
    answer = () => json(200, { deleted: true });

    const result = await call('remote', 'delete_template', { templateId: 'tpl_1' });

    expect(result.isError).toBe(true);
    expect(apiCalls().filter((r) => r.method === 'DELETE')).toEqual([]);
  });
});

// --- AC1376 ---------------------------------------------------------------------------

describe("AC1376: a 402 tool error carries the API's message, its pricing link included", () => {
  for (const kind of KINDS) {
    it(`AC1376 (${kind}): generate_image_from_html answered 402 shows the API's message`, async () => {
      answer = () => json(402, { error: true, message: OUT_OF_CREDITS });

      const result = await call(kind, 'generate_image_from_html', { html: '<p>x</p>' });

      expect(result.isError).toBe(true);
      expect(textOf(result)).toContain(OUT_OF_CREDITS);
      expect(textOf(result)).toContain('https://ojo.so/pricing');
    });

    it(`AC1376 (${kind}): generate_pdf_from_template answered 402 shows the API's message`, async () => {
      answer = () => json(402, { error: true, message: OUT_OF_CREDITS });

      const result = await call(kind, 'generate_pdf_from_template', { templateId: 'tpl_1' });

      expect(result.isError).toBe(true);
      expect(textOf(result)).toContain(OUT_OF_CREDITS);
    });
  }
});

// --- AC1377 ---------------------------------------------------------------------------

describe('AC1377: a 401 tool error names the fix that applies to the server', () => {
  const UNAUTHORIZED = json(401, {
    error: true,
    message: 'This API key is invalid or was revoked. Create a new one at https://ojo.so/dashboard/api.',
  });

  it('AC1377 (remote): it says to reconnect oJo in the AI app and does not mention OJO_API_KEY', async () => {
    answer = () => UNAUTHORIZED;

    const result = await call('remote', 'list_templates', {});

    expect(result.isError).toBe(true);
    expect(textOf(result)).toMatch(/reconnect/i);
    expect(textOf(result)).toContain('oJo');
    expect(textOf(result)).not.toContain('OJO_API_KEY');
  });

  it('AC1377 (local): it keeps the OJO_API_KEY line', async () => {
    answer = () => UNAUTHORIZED;

    const result = await call('local', 'list_templates', {});

    expect(result.isError).toBe(true);
    expect(textOf(result)).toContain('OJO_API_KEY');
  });
});

// --- AC1381 ---------------------------------------------------------------------------

/** The expiry as text: its ISO date, or the same day written out in English. */
const showsDay = (text: string, iso: string) => {
  const day = new Date(iso);
  const month = day.toLocaleString('en-US', { month: 'long', timeZone: 'UTC' });
  const short = month.slice(0, 3);
  const d = day.getUTCDate();
  const y = day.getUTCFullYear();
  return (
    text.includes(iso.slice(0, 10)) ||
    new RegExp(`(${month}|${short})\\.? ${d},? ${y}`).test(text) ||
    new RegExp(`${d} (${month}|${short})\\.?,? ${y}`).test(text)
  );
};

describe('AC1381: get_credits', () => {
  const EXPIRES = '2026-11-28T09:15:00.000Z';

  for (const kind of KINDS) {
    it(`AC1381 (${kind}): get_credits is listed, takes no arguments and carries the read-only annotation`, async () => {
      const tool = await toolNamed(kind, 'get_credits');

      expect(Object.keys((tool.inputSchema as { properties?: object }).properties ?? {})).toEqual([]);
      expect(tool.annotations?.readOnlyHint).toBe(true);
      expect(tool.annotations?.destructiveHint).toBe(false);
    });

    it(`AC1381 (${kind}): it reads GET /v1/credits and returns left, total and expiry as text`, async () => {
      answer = (req) =>
        req.method === 'GET' && req.path === '/v1/credits'
          ? json(200, { left: 86, total: 150, expiresAt: EXPIRES })
          : json(404, { error: true, message: 'not found' });

      const result = await call(kind, 'get_credits', {});

      expect(result.isError, textOf(result)).toBeFalsy();
      expect(apiCalls().map((r) => `${r.method} ${r.path}`)).toEqual(['GET /v1/credits']);
      expect(apiCalls()[0]!.authorization).toBe(`Bearer ${API_KEY}`);
      const text = textOf(result);
      expect(text).toMatch(/\b86\b/);
      expect(text).toMatch(/\b150\b/);
      expect(showsDay(text, EXPIRES), text).toBe(true);
    });
  }

  it('AC1381: with no current batch it returns 0 left and 0 total as text, not an error', async () => {
    answer = () => json(200, { left: 0, total: 0, expiresAt: null });

    const result = await call('local', 'get_credits', {});

    expect(result.isError, textOf(result)).toBeFalsy();
    expect(apiCalls().map((r) => `${r.method} ${r.path}`)).toEqual(['GET /v1/credits']);
    expect(textOf(result)).toMatch(/\b0\b/);
  });
});

// --- AC1382 ---------------------------------------------------------------------------

// Fixtures shared by AC1382 and AC1386.
// Digits 3 and 7 appear only in the page position below, so it can be found in the text.
const IMAGES = {
  items: [
    { id: '1111img-alpha.png', imageUrl: 'ojousercontent.com/1111_user/img-alpha.png', createdAt: '2026-10-01T10:20:00Z' },
    { id: '1111img-beta.png', imageUrl: 'https://cdn.ojo.so/1111_user/img-beta.png', createdAt: '2026-10-02T11:21:00Z' },
  ],
  totalItems: 64,
  totalPages: 7,
  currentPage: 3,
  pageSize: 10,
};
const PDFS = {
  items: [
    { id: '1111doc-one.pdf', pdfUrl: 'ojousercontent.com/1111_user/doc-one.pdf', pages: 4, createdAt: '2026-10-05T08:00:00Z' },
    { id: '1111doc-two.pdf', pdfUrl: 'https://cdn.ojo.so/1111_user/doc-two.pdf', pages: 12, createdAt: '2026-10-06T09:00:00Z' },
  ],
  totalItems: 64,
  totalPages: 7,
  currentPage: 3,
  pageSize: 10,
};

const pagePosition = /\b3\b\D+\b7\b/;

describe('AC1382: list_renders lists stored renders through GET /v1/{format}', () => {
  for (const kind of KINDS) {
    it(`AC1382 (${kind}): format image calls GET /v1/image with page, pageSize and sort`, async () => {
      answer = (req) => (req.path === '/v1/image' ? json(200, IMAGES) : json(404, { error: true, message: 'not found' }));

      const result = await call(kind, 'list_renders', { format: 'image', page: 3, pageSize: 10, sort: 'asc' });

      expect(result.isError, textOf(result)).toBeFalsy();
      const [sent, ...rest] = apiCalls();
      expect(rest).toEqual([]);
      expect(sent!.method).toBe('GET');
      expect(sent!.path).toBe('/v1/image');
      expect(sent!.query.get('page')).toBe('3');
      expect(sent!.query.get('pageSize')).toBe('10');
      expect(sent!.query.get('sort')).toBe('asc');
      expect(sent!.authorization).toBe(`Bearer ${API_KEY}`);
    });

    it(`AC1382 (${kind}): format pdf calls GET /v1/pdf with page, pageSize and sort`, async () => {
      answer = (req) => (req.path === '/v1/pdf' ? json(200, PDFS) : json(404, { error: true, message: 'not found' }));

      const result = await call(kind, 'list_renders', { format: 'pdf', page: 3, pageSize: 10, sort: 'desc' });

      expect(result.isError, textOf(result)).toBeFalsy();
      const [sent, ...rest] = apiCalls();
      expect(rest).toEqual([]);
      expect(sent!.method).toBe('GET');
      expect(sent!.path).toBe('/v1/pdf');
      expect(sent!.query.get('page')).toBe('3');
      expect(sent!.query.get('pageSize')).toBe('10');
      expect(sent!.query.get('sort')).toBe('desc');
    });
  }

  it("AC1382: an image list returns each record's id, absolute URL and created time, and the page position", async () => {
    answer = () => json(200, IMAGES);

    const result = await call('local', 'list_renders', { format: 'image', page: 3 });

    const text = textOf(result);
    expect(result.isError, text).toBeFalsy();
    expect(text).toContain('1111img-alpha.png');
    expect(text).toContain('https://ojousercontent.com/1111_user/img-alpha.png');
    expect(showsDay(text, '2026-10-01T10:20:00Z'), text).toBe(true);
    expect(text).toContain('1111img-beta.png');
    expect(text).toContain('https://cdn.ojo.so/1111_user/img-beta.png');
    expect(showsDay(text, '2026-10-02T11:21:00Z'), text).toBe(true);
    expect(text).not.toMatch(/https:\/\/https:\/\//);
    expect(text).toMatch(pagePosition);
  });

  it("AC1382: a PDF list returns each record's id, absolute URL, created time and pages, and the page position", async () => {
    answer = () => json(200, PDFS);

    const result = await call('local', 'list_renders', { format: 'pdf', page: 3 });

    const text = textOf(result);
    expect(result.isError, text).toBeFalsy();
    expect(text).toContain('1111doc-one.pdf');
    expect(text).toContain('https://ojousercontent.com/1111_user/doc-one.pdf');
    expect(showsDay(text, '2026-10-05T08:00:00Z'), text).toBe(true);
    expect(text).toContain('1111doc-two.pdf');
    expect(text).toContain('https://cdn.ojo.so/1111_user/doc-two.pdf');
    expect(showsDay(text, '2026-10-06T09:00:00Z'), text).toBe(true);
    // Each PDF's page count sits with its own record: on the lines from its id to the next id.
    const one = text.slice(text.indexOf('1111doc-one.pdf'), text.indexOf('1111doc-two.pdf'));
    const two = text.slice(text.indexOf('1111doc-two.pdf'));
    expect(one).toMatch(/\b4\b/);
    expect(two).toMatch(/\b12\b/);
    expect(text).toMatch(pagePosition);
  });
});

// --- AC1386 ---------------------------------------------------------------------------

const DASHBOARD_RENDERS = 'https://ojo.so/dashboard/renders';

/** No file location in any form: no host the fixtures store files on, no storage path. */
const expectNoFileUrl = (text: string) => {
  expect(text).not.toContain('ojousercontent.com');
  expect(text).not.toContain('cdn.ojo.so');
  expect(text).not.toContain('1111_user');
  // The only link left is the dashboard's renders page.
  for (const link of text.match(/https?:\/\/\S+/g) ?? []) {
    expect(link.startsWith(DASHBOARD_RENDERS), `unexpected link ${link}`).toBe(true);
  }
};

describe('AC1386: the remote list_renders returns no file URL and points to the dashboard', () => {
  it("AC1386 (remote): an image list returns each record's id and created time, the page position and the dashboard renders page, and no file URL", async () => {
    answer = () => json(200, IMAGES);

    const result = await call('remote', 'list_renders', { format: 'image', page: 3 });

    const text = textOf(result);
    expect(result.isError, text).toBeFalsy();
    expect(text).toContain('1111img-alpha.png');
    expect(showsDay(text, '2026-10-01T10:20:00Z'), text).toBe(true);
    expect(text).toContain('1111img-beta.png');
    expect(showsDay(text, '2026-10-02T11:21:00Z'), text).toBe(true);
    expect(text).toMatch(pagePosition);
    expectNoFileUrl(text);
    expect(text).toContain(DASHBOARD_RENDERS);
  });

  it("AC1386 (remote): a PDF list returns each record's id, created time and pages, the page position and the dashboard renders page, and no file URL", async () => {
    answer = () => json(200, PDFS);

    const result = await call('remote', 'list_renders', { format: 'pdf', page: 3 });

    const text = textOf(result);
    expect(result.isError, text).toBeFalsy();
    expect(text).toContain('1111doc-one.pdf');
    expect(showsDay(text, '2026-10-05T08:00:00Z'), text).toBe(true);
    expect(text).toContain('1111doc-two.pdf');
    expect(showsDay(text, '2026-10-06T09:00:00Z'), text).toBe(true);
    const one = text.slice(text.indexOf('1111doc-one.pdf'), text.indexOf('1111doc-two.pdf'));
    const two = text.slice(text.indexOf('1111doc-two.pdf'));
    expect(one).toMatch(/\b4\b/);
    expect(two).toMatch(/\b12\b/);
    expect(text).toMatch(pagePosition);
    expectNoFileUrl(text);
    expect(text).toContain(DASHBOARD_RENDERS);
  });

  // The local half of AC1386 (the local server keeps the URLs) is the two local AC1382 tests above.
});

// --- AC1383---------------------------------------------------------------------------

describe('AC1383: the list_renders schema refuses bad values before any API call', () => {
  it.each([
    ['format gif', { format: 'gif' }],
    ['format png', { format: 'png' }],
    ['format IMAGE', { format: 'IMAGE' }],
    ['page 0', { format: 'image', page: 0 }],
    ['page -1', { format: 'pdf', page: -1 }],
    ['pageSize 0', { format: 'image', pageSize: 0 }],
    ['pageSize 101', { format: 'pdf', pageSize: 101 }],
  ])('AC1383: %s is refused and nothing reaches the API', async (_, args) => {
    await toolNamed('local', 'list_renders');
    answer = () => json(200, { items: [], totalItems: 0, totalPages: 0, currentPage: 1, pageSize: 10 });

    const result = await call('local', 'list_renders', args);

    expect(result.isError, textOf(result)).toBe(true);
    expect(textOf(result)).not.toMatch(/Tool \S+ not found/);
    expect(apiCalls()).toEqual([]);
  });

  it.each([
    ['page 1 and pageSize 1', { format: 'image', page: 1, pageSize: 1 }],
    ['pageSize 100', { format: 'pdf', pageSize: 100 }],
  ])('AC1383: the bounds themselves are accepted: %s reaches the API', async (_, args) => {
    answer = () => json(200, { items: [], totalItems: 0, totalPages: 0, currentPage: 1, pageSize: 1 });

    const result = await call('local', 'list_renders', args);

    expect(result.isError, textOf(result)).toBeFalsy();
    expect(apiCalls()).toHaveLength(1);
  });

  it('AC1383: the advertised schema states the format enum and the page and pageSize bounds', async () => {
    const schema = (await toolNamed('local', 'list_renders')).inputSchema as {
      properties?: Record<string, { enum?: unknown[]; minimum?: number; maximum?: number }>;
      required?: string[];
    };

    expect([...(schema.properties?.format?.enum ?? [])].sort()).toEqual(['image', 'pdf']);
    expect(schema.properties?.page?.minimum).toBe(1);
    expect(schema.properties?.pageSize?.minimum).toBe(1);
    expect(schema.properties?.pageSize?.maximum).toBe(100);
    expect(schema.required ?? []).not.toContain('page');
    expect(schema.required ?? []).not.toContain('pageSize');
    expect(schema.required ?? []).not.toContain('sort');
  });
});

// --- AC1384 ---------------------------------------------------------------------------

describe('AC1384: list_renders is read-only and listed on both servers', () => {
  for (const kind of KINDS) {
    it(`AC1384 (${kind}): list_renders is listed with the read-only annotation`, async () => {
      const tool = await toolNamed(kind, 'list_renders');

      expect(tool.annotations?.readOnlyHint).toBe(true);
      expect(tool.annotations?.destructiveHint).toBe(false);
    });
  }
});
