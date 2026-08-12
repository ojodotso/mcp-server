import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { OjoApiClient } from './ojo-client.js';
import { OJO_WEB_BASE_URL } from '../constants.js';
import { registerTools } from '../tools/index.js';
import { registerPrompts } from '../prompts/index.js';

/**
 * Build a transport-agnostic McpServer wired to the given oJo API client.
 * The transport (stdio for v1) is attached separately by the entrypoint.
 *
 * A `null` client means preview-only mode: no API key was supplied, so only the
 * account-free `create_preview_link` tool is registered.
 */
export function createServer(
  client: OjoApiClient | null,
  webBaseUrl: string = OJO_WEB_BASE_URL
): McpServer {
  const server = new McpServer({
    name: 'ojo',
    // Keep in sync with package.json — this is what clients see in the MCP
    // handshake. It drifted to a stale 0.1.0 once; bump both together.
    version: '0.3.1',
  });
  registerTools(server, client, webBaseUrl);
  registerPrompts(server, client !== null);
  return server;
}
