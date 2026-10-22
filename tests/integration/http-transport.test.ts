import { createServer as createHttpServer, type RequestListener, type Server } from 'node:http';
import { randomBytes } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { EncryptJWT, SignJWT, generateKeyPair } from 'jose';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { LATEST_PROTOCOL_VERSION } from '@modelcontextprotocol/sdk/types.js';
import { createServer } from '../../src/server/index.js';
import { OjoApiClient } from '../../src/server/ojo-client.js';
import { pinnedShapeOf } from '../fixtures/pinned-schemas.js';

// The remote MCP server over Streamable HTTP (AC126 transport, AC134 resource metadata, AC140
// verifier). Access tokens are compact JWEs (alg dir, enc A256GCM) that oJo's own authorization
// server encrypts under a 32-byte key shared with mcp-server. Their claims carry the user's oJo
// API key, and that key, never the access token, is what reaches the API. Outside the unit and
// faked here: the oJo API. Tokens are built with jose.

const RESOURCE_URL = 'https://mcp.ojo.so/mcp';
const RESOURCE_METADATA = 'https://mcp.ojo.so/.well-known/oauth-protected-resource/mcp';
const ISSUER = 'https://ojo.so';
const WEB_BASE_URL = 'https://ojo.so';
const USER_A = '0b6f3c1e-4a2d-4f8e-9c5b-7d1a2e3f4a5b';
const USER_B = '9e8d7c6b-5a49-4382-a1b0-c9d8e7f6a5b4';
const GRANT_A = '1a2b3c4d-0000-4000-8000-00000000000a';
const GRANT_B = '1a2b3c4d-0000-4000-8000-00000000000b';
const KEY_A = 'ojo_mcp_key_of_user_a_6f1d0c';
const KEY_B = 'ojo_mcp_key_of_user_b_92ab4e';
const READ_ONLY_TOOLS = ['list_templates', 'get_template', 'create_preview_link'];

const TOKEN_KEY = new Uint8Array(randomBytes(32));
const OTHER_KEY = new Uint8Array(randomBytes(32));

// --- fake oJo API ---------------------------------------------------------------------

type ApiRequest = { method: string; path: string; authorization: string | undefined; rawHeaders: string };
const apiRequests: ApiRequest[] = [];
// Requests to the fake API are held until two are pending (or a short timeout), so two
// concurrent tool calls are in flight at the same time.
let holdForPair = false;
let held: Array<() => void> = [];

const USER_BY_KEY: Record<string, string> = { [KEY_A]: USER_A, [KEY_B]: USER_B };
const userOf = (authorization: string | undefined) =>
  USER_BY_KEY[(authorization ?? '').replace(/^Bearer /, '')] ?? 'nobody';

const fake = createHttpServer((req, res) => {
  const path = (req.url ?? '').split('?')[0] ?? '';
  apiRequests.push({
    method: req.method ?? '',
    path,
    authorization: req.headers.authorization,
    rawHeaders: req.rawHeaders.join('\n'),
  });
  const respond = () => {
    const user = userOf(req.headers.authorization);
    if (req.method === 'GET' && path === '/v1/template' && user !== 'nobody') {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(
        JSON.stringify({
          items: [
            {
              template_id: `tpl-of-${user}`,
              name: `template of ${user}`,
              created_at: '2026-10-01T00:00:00Z',
              updated_at: '2026-10-01T00:00:00Z',
            },
          ],
          totalItems: 1,
          totalPages: 1,
          currentPage: 1,
          pageSize: 10,
        })
      );
      return;
    }
    res.writeHead(user === 'nobody' ? 401 : 404, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ message: user === 'nobody' ? 'unauthorized' : 'not found' }));
  };
  if (!holdForPair) return respond();
  held.push(respond);
  if (held.length >= 2) {
    const release = held;
    held = [];
    release.forEach((r) => r());
  } else {
    setTimeout(() => {
      const release = held;
      held = [];
      release.forEach((r) => r());
    }, 2000);
  }
});

let mcp: Server;
let FAKE_ORIGIN = '';
let MCP_URL = '';
let MCP_ORIGIN = '';

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
  FAKE_ORIGIN = `http://127.0.0.1:${await listen(fake)}`;
  // The unit under test. A missing module or export fails every test here.
  const { createHttpApp } = await import('../../src/transports/http.js');
  const handler = createHttpApp({
    resourceUrl: RESOURCE_URL,
    issuer: ISSUER,
    apiBaseUrl: `${FAKE_ORIGIN}/v1`,
    webBaseUrl: WEB_BASE_URL,
    tokenKey: TOKEN_KEY,
  }) as RequestListener;
  mcp = createHttpServer(handler);
  MCP_ORIGIN = `http://127.0.0.1:${await listen(mcp)}`;
  MCP_URL = `${MCP_ORIGIN}/mcp`;
});

afterAll(async () => {
  await close(mcp);
  await close(fake);
});

beforeEach(() => {
  apiRequests.length = 0;
  holdForPair = false;
  held = [];
});

// --- tokens -------------------------------------------------------------------------

const now = () => Math.floor(Date.now() / 1000);

/** The claims oJo's authorization server puts in an access token. `undefined` drops a claim. */
const claims = (overrides: Record<string, unknown> = {}) => ({
  iss: ISSUER,
  aud: RESOURCE_URL,
  sub: USER_A,
  gid: GRANT_A,
  iat: now() - 10,
  exp: now() + 3600,
  key: KEY_A,
  ...overrides,
});

const encrypt = (
  payload: Record<string, unknown>,
  { key = TOKEN_KEY, alg = 'dir', enc = 'A256GCM' }: { key?: Uint8Array; alg?: string; enc?: string } = {}
) => new EncryptJWT(payload).setProtectedHeader({ alg, enc }).encrypt(key);

const accessToken = (overrides: Record<string, unknown> = {}) => encrypt(claims(overrides));

const tokenOfA = () => accessToken();
const tokenOfB = () => accessToken({ sub: USER_B, gid: GRANT_B, key: KEY_B });

/** Flips one byte of the ciphertext (the fourth compact JWE segment). */
const tamperCiphertext = (token: string) => {
  const parts = token.split('.');
  const bytes = Buffer.from(parts[3]!, 'base64url');
  bytes[0] = bytes[0]! ^ 0xff;
  parts[3] = bytes.toString('base64url');
  return parts.join('.');
};

/** A Supabase OAuth access token: an ordinary GoTrue session JWT, ES256-signed. */
const supabaseJwt = async () => {
  const { privateKey } = await generateKeyPair('ES256');
  return new SignJWT({
    role: 'authenticated',
    email: 'someone@example.com',
    aal: 'aal1',
    session_id: '3a2b1c0d-9e8f-4a7b-b6c5-d4e3f2a1b0c9',
    is_anonymous: false,
    client_id: '6c1f0e2d-3b4a-4c5d-8e9f-0a1b2c3d4e5f',
  })
    .setProtectedHeader({ alg: 'ES256', typ: 'JWT', kid: 'project-key-1' })
    .setIssuer('https://project.supabase.co/auth/v1')
    .setAudience('authenticated')
    .setSubject(USER_A)
    .setIssuedAt()
    .setExpirationTime('1h')
    .sign(privateKey);
};

/** A signed (not encrypted) JWT carrying every claim a valid access token has. */
const jwsWithAccessClaims = async (alg: 'ES256' | 'HS256') => {
  const key = alg === 'HS256' ? TOKEN_KEY : (await generateKeyPair('ES256')).privateKey;
  return new SignJWT(claims()).setProtectedHeader({ alg, typ: 'JWT' }).sign(key);
};

// --- MCP over Streamable HTTP --------------------------------------------------------

type JsonRpc = { jsonrpc: '2.0'; id?: number; method: string; params?: Record<string, unknown> };

const initializeBody = (id = 1): JsonRpc => ({
  jsonrpc: '2.0',
  id,
  method: 'initialize',
  params: {
    protocolVersion: LATEST_PROTOCOL_VERSION,
    capabilities: {},
    clientInfo: { name: 'http-test-client', version: '0.0.0' },
  },
});
const toolsListBody = (id = 2): JsonRpc => ({ jsonrpc: '2.0', id, method: 'tools/list' });
const listTemplatesCall = (id = 3): JsonRpc => ({
  jsonrpc: '2.0',
  id,
  method: 'tools/call',
  params: { name: 'list_templates', arguments: {} },
});

function headersFor(method: string, token?: string, extra: Record<string, string> = {}) {
  return {
    'content-type': 'application/json',
    accept: 'application/json, text/event-stream',
    ...(method === 'initialize' ? {} : { 'mcp-protocol-version': LATEST_PROTOCOL_VERSION }),
    ...(token === undefined ? {} : { authorization: `Bearer ${token}` }),
    ...extra,
  };
}

function post(body: JsonRpc, token?: string) {
  return fetch(MCP_URL, { method: 'POST', headers: headersFor(body.method, token), body: JSON.stringify(body) });
}

/** Reads a JSON-RPC message from a JSON body or from a single SSE event. */
async function readMessage(response: Response): Promise<any> {
  const text = await response.text();
  if ((response.headers.get('content-type') ?? '').includes('text/event-stream')) {
    const events = text
      .split(/\r?\n\r?\n/)
      .map((event) =>
        event
          .split(/\r?\n/)
          .filter((line) => line.startsWith('data:'))
          .map((line) => line.slice(5).trimStart())
          .join('\n')
      )
      .filter((data) => data.length > 0);
    return JSON.parse(events[events.length - 1]!);
  }
  return JSON.parse(text);
}

async function rpc(body: JsonRpc, token: string) {
  const response = await post(body, token);
  expect(response.status, `${body.method} status`).toBe(200);
  const message = await readMessage(response);
  expect(message.error, `${body.method} error`).toBeUndefined();
  return message.result;
}

const textOf = (result: { content: Array<{ type: string; text?: string }> }) =>
  result.content.map((c) => c.text ?? '').join('\n');

/** The tools createServer exposes to stdio with an API key. */
async function stdioTools() {
  const server = createServer(new OjoApiClient('ok.x'));
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: 'test-client', version: '0.0.0' });
  await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
  const { tools } = await client.listTools();
  await client.close();
  return tools;
}

// --- AC134 (resource side) -----------------------------------------------------------

describe("AC134: mcp.ojo.so's protected-resource metadata names oJo's own authorization server", () => {
  for (const path of ['/.well-known/oauth-protected-resource/mcp', '/.well-known/oauth-protected-resource']) {
    it(`AC134: GET ${path} returns 200 JSON {resource, authorization_servers: ['https://ojo.so']} with no auth`, async () => {
      const response = await fetch(`${MCP_ORIGIN}${path}`);

      expect(response.status).toBe(200);
      expect(response.headers.get('content-type') ?? '').toContain('application/json');
      const body = (await response.json()) as Record<string, unknown>;
      expect(body.resource).toBe(RESOURCE_URL);
      expect(body.authorization_servers).toEqual(['https://ojo.so']);
    });
  }
});

// --- AC140: refused tokens -----------------------------------------------------------

const REFUSED: Array<{ label: string; token: () => Promise<string | undefined> | string | undefined }> = [
  { label: 'no Authorization header', token: () => undefined },
  { label: 'garbage', token: () => 'garbage' },
  { label: 'five dot-separated garbage segments', token: () => 'a.b.c.d.e' },
  { label: 'a token with tampered ciphertext', token: async () => tamperCiphertext(await tokenOfA()) },
  { label: 'a token encrypted under another key', token: () => encrypt(claims(), { key: OTHER_KEY }) },
  { label: 'an expired token', token: () => accessToken({ iat: now() - 7200, exp: now() - 3600 }) },
  { label: "a token with aud 'authenticated'", token: () => accessToken({ aud: 'authenticated' }) },
  { label: 'a token for another resource', token: () => accessToken({ aud: 'https://mcp.ojo.so/other' }) },
  { label: 'a token without aud', token: () => accessToken({ aud: undefined }) },
  { label: 'a token from another issuer', token: () => accessToken({ iss: 'https://evil.example.com' }) },
  { label: 'a token with a Supabase issuer', token: () => accessToken({ iss: 'https://project.supabase.co/auth/v1' }) },
  { label: 'a token without iss', token: () => accessToken({ iss: undefined }) },
  { label: 'a token without the key claim', token: () => accessToken({ key: undefined }) },
  { label: 'a Supabase OAuth JWT (ES256 JWS)', token: () => supabaseJwt() },
  { label: 'an ES256 JWS carrying every access-token claim', token: () => jwsWithAccessClaims('ES256') },
  { label: 'an HS256 JWS carrying every access-token claim, signed with the token key', token: () => jwsWithAccessClaims('HS256') },
  {
    label: 'a JWE with enc A128GCM',
    token: () => encrypt(claims(), { key: TOKEN_KEY.slice(0, 16), enc: 'A128GCM' }),
  },
  { label: 'a JWE with alg A256KW under the token key', token: () => encrypt(claims(), { alg: 'A256KW' }) },
];

describe('AC140: POST /mcp without a valid access token gets 401 invalid_token with resource_metadata, never 500, and nothing reaches the oJo API', () => {
  for (const { label, token } of REFUSED) {
    for (const body of [initializeBody(), toolsListBody(), listTemplatesCall()]) {
      it(`AC140: ${label} on ${body.method} gets 401 Bearer error="invalid_token" resource_metadata, and no API call`, async () => {
        const response = await post(body, await token());
        await response.text();

        expect(response.status).toBe(401);
        const challenge = response.headers.get('www-authenticate') ?? '';
        expect(challenge).toMatch(/^Bearer /);
        expect(challenge).toContain('error="invalid_token"');
        expect(challenge).toContain(`resource_metadata="${RESOURCE_METADATA}"`);
        expect(apiRequests).toEqual([]);
      });
    }
  }
});

// --- AC140: valid tokens -------------------------------------------------------------

describe('AC140: a valid access token serves stateless MCP over Streamable HTTP', () => {
  it('AC140: initialize, notifications/initialized and tools/list work without any Mcp-Session-Id', async () => {
    const token = await tokenOfA();

    const init = await rpc(initializeBody(), token);
    expect(init.serverInfo?.name).toBe('ojo');

    const initialized = await post({ jsonrpc: '2.0', method: 'notifications/initialized' }, token);
    await initialized.text();
    expect(initialized.status).toBeLessThan(300);

    const { tools } = await rpc(toolsListBody(), token);
    expect(tools.length).toBeGreaterThan(0);
  });

  it('AC140: tools/list sent on its own, with no prior initialize, succeeds', async () => {
    const { tools } = await rpc(toolsListBody(), await tokenOfB());
    expect(tools.length).toBeGreaterThan(0);
  });

  it('AC140: tool names and input schemas equal those the stdio server exposes with an API key', async () => {
    const { tools } = (await rpc(toolsListBody(), await tokenOfA())) as {
      tools: Array<{ name: string; inputSchema: unknown }>;
    };
    const expected = await stdioTools();

    expect(tools.map((t) => t.name).sort()).toEqual(expected.map((t) => t.name).sort());
    const byName = new Map(tools.map((t) => [t.name, t.inputSchema]));
    for (const tool of expected) {
      expect(byName.get(tool.name), tool.name).toEqual(tool.inputSchema);
    }

    const pinned = JSON.parse(
      readFileSync(new URL('../fixtures/existing-tool-input-schemas.json', import.meta.url), 'utf-8')
    ) as Record<string, unknown>;
    for (const [name, schema] of Object.entries(pinned)) {
      expect(pinnedShapeOf(byName.get(name)), name).toEqual(schema);
    }
  });

  it('AC140, AC594: every tool states readOnlyHint and destructiveHint: the three read tools are read-only, only update_template is destructive', async () => {
    const { tools } = (await rpc(toolsListBody(), await tokenOfA())) as {
      tools: Array<{ name: string; annotations?: { readOnlyHint?: boolean; destructiveHint?: boolean } }>;
    };
    expect(tools.length).toBe(9);

    for (const tool of tools) {
      expect(tool.annotations?.readOnlyHint, `${tool.name} readOnlyHint`).toBe(READ_ONLY_TOOLS.includes(tool.name));
      expect(tool.annotations?.destructiveHint, `${tool.name} destructiveHint`).toBe(
        tool.name === 'update_template'
      );
    }
  });
});

describe('AC140: tool calls reach the oJo API with the embedded key, never the access token', () => {
  it('AC140: list_templates reaches apiBaseUrl with Authorization: Bearer <the embedded key>', async () => {
    const token = await tokenOfA();

    const result = await rpc(listTemplatesCall(), token);

    expect(result.isError ?? false).toBe(false);
    expect(apiRequests).toHaveLength(1);
    expect(apiRequests[0]).toMatchObject({ method: 'GET', path: '/v1/template', authorization: `Bearer ${KEY_A}` });
    expect(textOf(result)).toContain(`template of ${USER_A}`);
  });

  it('AC140: no request to the API carries the access token in any header', async () => {
    const token = await tokenOfA();

    await rpc(listTemplatesCall(), token);

    expect(apiRequests.length).toBeGreaterThan(0);
    for (const request of apiRequests) {
      expect(request.rawHeaders).not.toContain(token);
    }
  });

  it('AC140: two concurrent callers with different tokens each reach the API with their own key, never the other', async () => {
    const [tokenA, tokenB] = await Promise.all([tokenOfA(), tokenOfB()]);
    holdForPair = true;

    const [resultA, resultB] = await Promise.all([
      rpc(listTemplatesCall(10), tokenA),
      rpc(listTemplatesCall(11), tokenB),
    ]);

    expect(apiRequests).toHaveLength(2);
    expect(apiRequests.map((r) => r.authorization).sort()).toEqual([`Bearer ${KEY_A}`, `Bearer ${KEY_B}`].sort());
    expect(textOf(resultA)).toContain(`template of ${USER_A}`);
    expect(textOf(resultA)).not.toContain(USER_B);
    expect(textOf(resultB)).toContain(`template of ${USER_B}`);
    expect(textOf(resultB)).not.toContain(USER_A);
  });
});

// --- request body: parsed only after auth, 2mb limit ---------------------------------

describe('POST /mcp parses the body only after auth, up to 2mb', () => {
  const padded = (bytes: number): string =>
    JSON.stringify({ ...toolsListBody(), params: { _meta: { padding: 'x'.repeat(bytes) } } });

  it('without a token, a body that is not JSON gets 401, not 400', async () => {
    const response = await fetch(MCP_URL, { method: 'POST', headers: headersFor('tools/list'), body: '{not json' });
    await response.text();
    expect(response.status).toBe(401);
  });

  it('without a token, a 3 MB body gets 401, not 413', async () => {
    const response = await fetch(MCP_URL, { method: 'POST', headers: headersFor('tools/list'), body: padded(3_000_000) });
    await response.text();
    expect(response.status).toBe(401);
  });

  it('with a valid token, a 1.5 MB body is accepted', async () => {
    const response = await fetch(MCP_URL, {
      method: 'POST',
      headers: headersFor('tools/list', await tokenOfA()),
      body: padded(1_500_000),
    });
    const message = await readMessage(response);
    expect(response.status).toBe(200);
    expect(message.result?.tools?.length).toBeGreaterThan(0);
  });

  it('with a valid token, a body over 2mb gets 413', async () => {
    const response = await fetch(MCP_URL, {
      method: 'POST',
      headers: headersFor('tools/list', await tokenOfA()),
      body: padded(2_500_000),
    });
    await response.text();
    expect(response.status).toBe(413);
  });
});

// --- health check and no server-to-client stream -------------------------------------

describe('health check and no server-to-client stream', () => {
  it('GET /healthz returns 200 without auth', async () => {
    const response = await fetch(`${MCP_ORIGIN}/healthz`);
    await response.text();
    expect(response.status).toBe(200);
  });

  for (const method of ['GET', 'DELETE']) {
    it(`${method} /mcp with a valid token returns 405 with Allow: POST`, async () => {
      const response = await fetch(MCP_URL, {
        method,
        headers: {
          accept: 'text/event-stream',
          authorization: `Bearer ${await tokenOfA()}`,
          'mcp-protocol-version': LATEST_PROTOCOL_VERSION,
        },
      });
      await response.body?.cancel();
      expect(response.status).toBe(405);
      expect(response.headers.get('allow')).toBe('POST');
    });
  }
});
