import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { createServer } from '../../src/server/index.js';
import type { OjoApiClient } from '../../src/server/ojo-client.js';

async function connect(client_: OjoApiClient | null = {} as OjoApiClient) {
  const server = createServer(client_);
  const [clientTransport, serverTransport] =
    InMemoryTransport.createLinkedPair();
  const client = new Client({ name: 'test-client', version: '0.0.0' });
  await Promise.all([
    server.connect(serverTransport),
    client.connect(clientTransport),
  ]);
  return client;
}

describe('MCP server registration', () => {
  it('registers exactly the v1 tool surface', async () => {
    const client = await connect();

    const { tools } = await client.listTools();
    const names = tools.map((t) => t.name).sort();

    expect(names).toEqual([
      'create_preview_link',
      'create_template',
      'generate_image_from_html',
      'generate_image_from_template',
      'get_template',
      'list_templates',
    ]);

    await client.close();
  });

  it('advertises an object input schema for each tool', async () => {
    const client = await connect();

    const { tools } = await client.listTools();
    for (const tool of tools) {
      expect(tool.inputSchema).toBeDefined();
      expect(tool.inputSchema.type).toBe('object');
    }

    await client.close();
  });

  it('advertises the package version in the MCP handshake', async () => {
    // The handshake version is hand-written in createServer and silently drifted
    // to a stale 0.1.0 while package.json was on 0.1.1. Pin them together.
    const pkg = JSON.parse(
      readFileSync(new URL('../../package.json', import.meta.url), 'utf-8')
    ) as { version: string };

    const client = await connect();
    expect(client.getServerVersion()).toEqual({
      name: 'ojo',
      version: pkg.version,
    });

    await client.close();
  });

  it('steers the credit-costing tools at the free preview loop', async () => {
    // The preview route is the credit-free design loop. If a description loses
    // its pointer to create_preview_link, agents fall back to burning credits.
    const client = await connect();

    const { tools } = await client.listTools();
    const byName = new Map(tools.map((t) => [t.name, t.description ?? '']));

    for (const name of [
      'generate_image_from_html',
      'generate_image_from_template',
    ]) {
      expect(byName.get(name)).toContain('create_preview_link');
      expect(byName.get(name)).toMatch(/costs 1 credit/i);
    }

    expect(byName.get('create_preview_link')).toMatch(/no credit/i);

    await client.close();
  });

  it('serves preview-only when there is no API key, and never a tool that must fail', async () => {
    // Without OJO_API_KEY the entrypoint passes a null client instead of
    // exiting: create_preview_link needs no account, so the server is usable
    // with zero configuration. Every other tool calls the oJo API, so
    // registering it here would advertise a tool that can only error.
    const client = await connect(null);

    const { tools } = await client.listTools();
    expect(tools.map((t) => t.name)).toEqual(['create_preview_link']);

    // The keyless wording must not point at tools that are not registered.
    const description = tools[0]?.description ?? '';
    expect(description).not.toContain('generate_image_from_html');
    expect(description).not.toContain('create_template');
    expect(description).toContain('https://ojo.so/dashboard/api');

    const result = await client.callTool({
      name: 'create_preview_link',
      arguments: { html: '<h1>hi</h1>' },
    });
    const text = (result.content as { type: string; text?: string }[])
      .map((c) => c.text ?? '')
      .join('\n');
    expect(text).toContain('https://ojo.so/preview#draft=');
    expect(text).toContain('https://ojo.so/dashboard/api');

    await client.close();
  });

  it('registers the author_ojo_template guiding prompt', async () => {
    const client = await connect();

    const { prompts } = await client.listPrompts();
    expect(prompts.map((p) => p.name)).toContain('author_ojo_template');

    const result = await client.getPrompt({ name: 'author_ojo_template' });
    const text = result.messages
      .map((m) => (m.content.type === 'text' ? m.content.text : ''))
      .join('\n');
    expect(text).toContain('Template Variables');
    expect(text).toContain('formatCurrency');

    await client.close();
  });
});
