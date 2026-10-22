import express, { type Express } from 'express';
import { jwtDecrypt } from 'jose';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { requireBearerAuth } from '@modelcontextprotocol/sdk/server/auth/middleware/bearerAuth.js';
import { InvalidTokenError } from '@modelcontextprotocol/sdk/server/auth/errors.js';
import type { OAuthTokenVerifier } from '@modelcontextprotocol/sdk/server/auth/provider.js';
import type { AuthInfo } from '@modelcontextprotocol/sdk/server/auth/types.js';
import { createServer } from '../server/index.js';
import { OjoApiClient } from '../server/ojo-client.js';

export interface HttpAppOptions {
  /** The public MCP endpoint, e.g. https://mcp.ojo.so/mcp. */
  resourceUrl: string;
  /** oJo's authorization server, https://ojo.so. */
  issuer: string;
  /** The oJo API the tools call with the connection's own oJo key. */
  apiBaseUrl: string;
  webBaseUrl?: string;
  /** The 32-byte key ojo.so encrypts access tokens with (MCP_TOKEN_KEY). */
  tokenKey: Uint8Array;
}

/**
 * Access tokens are JWEs that ojo.so encrypts under the shared token key (AC140). One that
 * decrypts, names this server and has not expired carries the oJo key of its connection, and that
 * key is what reaches the API: the access token itself never leaves this server. Nothing is
 * fetched, so every failure is the token's fault and is invalid_token, never a 500.
 */
const accessTokenVerifier = (
  issuer: string,
  audience: string,
  tokenKey: Uint8Array
): OAuthTokenVerifier => ({
  async verifyAccessToken(token) {
    try {
      const { payload } = await jwtDecrypt(token, tokenKey, {
        issuer,
        audience,
        keyManagementAlgorithms: ['dir'],
        contentEncryptionAlgorithms: ['A256GCM'],
        requiredClaims: ['exp', 'sub'],
      });
      const apiKey = payload['key'];
      if (typeof apiKey !== 'string' || !apiKey) throw new Error('missing key claim');
      return {
        token,
        clientId: String(payload.sub),
        scopes: [],
        expiresAt: payload.exp,
        extra: { apiKey },
      };
    } catch {
      throw new InvalidTokenError('Invalid or expired access token');
    }
  },
});

/**
 * The remote MCP server (AC126, AC140): Streamable HTTP, stateless, one McpServer per request so
 * a caller's key never serves another request. Each tool call reaches the oJo API with the oJo key
 * of the caller's connection, and the API decides what it may do.
 */
export function createHttpApp({
  resourceUrl,
  issuer,
  apiBaseUrl,
  webBaseUrl,
  tokenKey,
}: HttpAppOptions): Express {
  const resource = new URL(resourceUrl);
  const metadataPath = `/.well-known/oauth-protected-resource${resource.pathname}`;
  const metadata = { resource: resource.href, authorization_servers: [issuer] };

  const app = express();
  app.disable('x-powered-by');

  app.get('/healthz', (_req, res) => {
    res.sendStatus(200);
  });
  // RFC 9728: clients find the authorization server here. The root path is for clients that
  // ignore the path suffix.
  app.get([metadataPath, '/.well-known/oauth-protected-resource'], (_req, res) => {
    res.json(metadata);
  });

  app.use(
    '/mcp',
    requireBearerAuth({
      verifier: accessTokenVerifier(issuer, resource.href, tokenKey),
      resourceMetadataUrl: new URL(metadataPath, resource).href,
    })
  );

  // The API takes up to 1 MB of HTML; JSON-RPC escaping can make that larger.
  app.post('/mcp', express.json({ limit: '2mb' }), async (req, res) => {
    // Set by requireBearerAuth above; its type augmentation targets the SDK's own express types.
    const { extra } = (req as typeof req & { auth: AuthInfo }).auth;
    const server = createServer(new OjoApiClient(extra!.apiKey as string, apiBaseUrl), webBaseUrl);
    const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
    res.on('close', () => {
      void transport.close();
      void server.close();
    });
    await server.connect(transport);
    await transport.handleRequest(req, res, req.body);
  });

  // Stateless: no server-to-client stream and no session to delete.
  app.all('/mcp', (_req, res) => {
    res.set('Allow', 'POST').sendStatus(405);
  });

  return app;
}
