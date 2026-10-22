import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { createServer } from '../../src/server/index.js';
import { OjoApiClient } from '../../src/server/ojo-client.js';
import { pinnedShapeOf } from '../fixtures/pinned-schemas.js';

// The tool surface the stdio entrypoint builds through createServer.

const READ_ONLY_TOOLS = ['list_templates', 'get_template', 'create_preview_link'];

async function listTools(client_: OjoApiClient | null) {
  const server = createServer(client_);
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: 'test-client', version: '0.0.0' });
  await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
  const { tools } = await client.listTools();
  await client.close();
  return tools;
}

describe('AC126e: every tool states readOnlyHint and destructiveHint explicitly (createServer, as stdio uses it)', () => {
  it('AC126e, AC594: with an API key, list_templates, get_template and create_preview_link are read-only, every other tool is not, and only update_template is destructive', async () => {
    const tools = await listTools(new OjoApiClient('ok.x'));
    expect(tools).toHaveLength(9);

    for (const tool of tools) {
      expect(tool.annotations?.readOnlyHint, `${tool.name} readOnlyHint`).toBe(
        READ_ONLY_TOOLS.includes(tool.name)
      );
      expect(tool.annotations?.destructiveHint, `${tool.name} destructiveHint`).toBe(
        tool.name === 'update_template'
      );
    }
  });

  it('AC126e: without an API key, create_preview_link is read-only and not destructive', async () => {
    const tools = await listTools(null);
    expect(tools.map((t) => t.name)).toEqual(['create_preview_link']);
    expect(tools[0]?.annotations?.readOnlyHint).toBe(true);
    expect(tools[0]?.annotations?.destructiveHint).toBe(false);
  });
});

describe('AC127: the stdio tool surface is unchanged', () => {
  it('AC127, AC594: with an API key, createServer exposes the nine tools (update_template included) and the pinned input schemas', async () => {
    const expected = JSON.parse(
      readFileSync(new URL('../fixtures/existing-tool-input-schemas.json', import.meta.url), 'utf-8')
    ) as Record<string, unknown>;

    const tools = await listTools(new OjoApiClient('ok.x'));
    expect(tools.map((t) => t.name).sort()).toEqual([
      'create_preview_link',
      'create_template',
      'generate_image_from_html',
      'generate_image_from_template',
      'generate_pdf_from_html',
      'generate_pdf_from_template',
      'get_template',
      'list_templates',
      'update_template',
    ]);
    const byName = new Map(tools.map((t) => [t.name, t.inputSchema]));
    for (const [name, schema] of Object.entries(expected)) {
      expect(pinnedShapeOf(byName.get(name)), name).toEqual(schema);
    }
  });

  it('AC127: without an API key, createServer exposes only create_preview_link', async () => {
    const tools = await listTools(null);
    expect(tools.map((t) => t.name)).toEqual(['create_preview_link']);
  });
});
