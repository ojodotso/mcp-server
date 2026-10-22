// Entry of the hosted MCP server at mcp.ojo.so (AC126, AC140). The npm package's `ojo-mcp` bin
// stays the stdio server (src/index.ts).
import { createHttpApp } from './transports/http.js';

// base64url of 32 random bytes, the same value ojo.so encrypts access tokens with.
const tokenKey = Buffer.from(process.env.MCP_TOKEN_KEY ?? '', 'base64url');
if (tokenKey.length !== 32) {
  console.error('MCP_TOKEN_KEY must be set to base64url of 32 bytes.');
  process.exit(1);
}

const app = createHttpApp({
  resourceUrl: process.env.MCP_RESOURCE_URL ?? 'https://mcp.ojo.so/mcp',
  issuer: 'https://ojo.so',
  apiBaseUrl: process.env.OJO_API_BASE_URL ?? 'https://api.ojo.so/v1',
  webBaseUrl: process.env.OJO_WEB_BASE_URL,
  tokenKey,
});

const port = Number(process.env.PORT ?? 3012);
const server = app.listen(port, () => {
  console.log(`oJo MCP server listening on ${port}`);
});

process.on('SIGTERM', () => server.close(() => process.exit(0)));
