#!/usr/bin/env node
import dotenv from 'dotenv';
import { createServer } from './server/index.js';
import { OjoApiClient } from './server/ojo-client.js';
import { startStdio } from './transports/stdio.js';

dotenv.config();

async function main(): Promise<void> {
  const apiKey = process.env.OJO_API_KEY;
  if (!apiKey) {
    // Preview-only mode instead of exiting: `create_preview_link` needs no
    // account, no credit and no oJo backend, so the server is genuinely useful
    // with zero configuration. Exiting here used to make trying oJo impossible
    // without first signing up.
    console.error(
      'OJO_API_KEY is not set — starting in preview-only mode. `create_preview_link` works with no account. Set OJO_API_KEY (https://ojo.so/dashboard/api) to enable rendering and templates.'
    );
  }

  const client = apiKey
    ? new OjoApiClient(apiKey, process.env.OJO_API_BASE_URL)
    : null;
  const server = createServer(client, process.env.OJO_WEB_BASE_URL);
  await startStdio(server);
}

main().catch((error) => {
  console.error('Fatal error starting the oJo MCP server:', error);
  process.exit(1);
});
