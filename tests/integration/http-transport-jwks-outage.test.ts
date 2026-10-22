import { createServer as createHttpServer, type RequestListener, type Server } from 'node:http';
import { randomBytes } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { EncryptJWT } from 'jose';
import { LATEST_PROTOCOL_VERSION } from '@modelcontextprotocol/sdk/types.js';

// AC140: mcp-server checks access tokens locally, by decrypting them with the shared token key. It
// fetches nothing from the authorization server, so an authorization server that is down (or
// answers 503 to everything) neither refuses a valid token nor turns it into a 5xx. This replaces
// AC126g, which covered a JWKS outage in the Supabase design: there is no JWKS any more.
// Outside the unit and faked here: an authorization server that answers 503 to every request and
// counts them.

const RESOURCE_URL = 'https://mcp.ojo.so/mcp';
const TOKEN_KEY = new Uint8Array(randomBytes(32));

let asRequests = 0;
const downAuthorizationServer = createHttpServer((_req, res) => {
  asRequests += 1;
  res.writeHead(503, { 'content-type': 'text/plain' });
  res.end('Service Unavailable');
});

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

let ISSUER = '';
let MCP_URL = '';
let mcp: Server;

beforeAll(async () => {
  ISSUER = `http://127.0.0.1:${await listen(downAuthorizationServer)}`;
  const { createHttpApp } = await import('../../src/transports/http.js');
  const handler = createHttpApp({
    resourceUrl: RESOURCE_URL,
    issuer: ISSUER,
    apiBaseUrl: `${ISSUER}/v1`,
    webBaseUrl: 'https://ojo.so',
    tokenKey: TOKEN_KEY,
  }) as RequestListener;
  mcp = createHttpServer(handler);
  MCP_URL = `http://127.0.0.1:${await listen(mcp)}/mcp`;
});

afterAll(async () => {
  await close(mcp);
  await close(downAuthorizationServer);
});

const accessToken = () => {
  const now = Math.floor(Date.now() / 1000);
  return new EncryptJWT({
    iss: ISSUER,
    aud: RESOURCE_URL,
    sub: '0b6f3c1e-4a2d-4f8e-9c5b-7d1a2e3f4a5b',
    gid: '1a2b3c4d-0000-4000-8000-00000000000a',
    iat: now - 10,
    exp: now + 3600,
    key: 'ojo_mcp_key_of_user_a_6f1d0c',
  })
    .setProtectedHeader({ alg: 'dir', enc: 'A256GCM' })
    .encrypt(TOKEN_KEY);
};

type JsonRpc = { jsonrpc: '2.0'; id?: number; method: string; params?: Record<string, unknown> };

const BODIES: JsonRpc[] = [
  {
    jsonrpc: '2.0',
    id: 1,
    method: 'initialize',
    params: {
      protocolVersion: LATEST_PROTOCOL_VERSION,
      capabilities: {},
      clientInfo: { name: 'http-test-client', version: '0.0.0' },
    },
  },
  { jsonrpc: '2.0', id: 2, method: 'tools/list' },
];

describe('AC140: verification is local, so an authorization server outage does not affect valid tokens', () => {
  for (const body of BODIES) {
    it(`AC140: with the authorization server answering 503, a valid token on ${body.method} gets 200 and nothing is fetched from it`, async () => {
      asRequests = 0;

      const response = await fetch(MCP_URL, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          accept: 'application/json, text/event-stream',
          ...(body.method === 'initialize' ? {} : { 'mcp-protocol-version': LATEST_PROTOCOL_VERSION }),
          authorization: `Bearer ${await accessToken()}`,
        },
        body: JSON.stringify(body),
      });
      await response.text();

      expect(response.status).toBe(200);
      expect(asRequests).toBe(0);
    });
  }
});
