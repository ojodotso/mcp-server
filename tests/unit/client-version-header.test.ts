import { readFileSync } from 'node:fs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { createServer } from '../../src/server/index.js';
import { OjoApiClient } from '../../src/server/ojo-client.js';

// .claude/docs/specs/2026-10-27-api-p2-openapi-contract-docs.md, AC1440: the MCP client sends
// `x-ojo-client-version: <its package version>` on every request.

const VERSION: string = JSON.parse(readFileSync(new URL('../../package.json', import.meta.url), 'utf8')).version;

// One answer that every tool can read: a render, a template, a list, credits and a PDF check.
const answer = () =>
  new Response(
    JSON.stringify({
      id: 'id-1',
      imageUrl: 'https://cdn.example.com/a.png',
      pdfUrl: 'https://cdn.example.com/a.pdf',
      pages: 1,
      credits: 1,
      html: '<p>x</p>',
      images: [{ id: 'id-1', imageUrl: 'https://cdn.example.com/a.png' }],
      items: [],
      totalItems: 0,
      totalPages: 0,
      currentPage: 1,
      pageSize: 10,
      left: 1,
      total: 1,
      expiresAt: null,
      deleted: true,
    }),
    { status: 200, headers: { 'content-type': 'application/json', 'x-pdf-pages': '1' } }
  );

const CALLS: Array<[string, Record<string, unknown>]> = [
  ['generate_image_from_html', { html: '<p>x</p>' }],
  ['generate_image_from_template', { templateId: 't1', modify: { a: 1 } }],
  ['generate_images_from_template', { templateId: 't1', modifications: [{ a: 1 }] }],
  ['generate_pdf_from_html', { html: '<p>x</p>' }],
  ['generate_pdf_from_template', { templateId: 't1' }],
  ['check_pdf', { html: '<p>x</p>' }],
  ['list_templates', {}],
  ['get_template', { templateId: 't1' }],
  ['create_template', { html: '<p>{{a}}</p>' }],
  ['update_template', { templateId: 't1', html: '<p>{{b}}</p>' }],
  ['list_renders', { format: 'image' }],
  ['get_credits', {}],
  ['delete_template', { templateId: 't1' }],
];

describe('AC1440: the MCP client sends its package version on every request', () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchMock = vi.fn(async () => answer());
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('the package has a version to send', () => {
    expect(VERSION).toMatch(/^[0-9A-Za-z.+-]{1,32}$/);
  });

  it.each(CALLS)('%s sends x-ojo-client-version on each request it makes', async (name, args) => {
    const server = createServer(new OjoApiClient('key123', 'https://api.example/v1'));
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    const client = new Client({ name: 'test-client', version: '0.0.0' });
    await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
    try {
      await client.callTool({ name, arguments: args });
    } finally {
      await client.close();
    }

    expect(fetchMock.mock.calls.length).toBeGreaterThan(0);
    for (const [, init] of fetchMock.mock.calls as Array<[string, RequestInit]>) {
      expect(new Headers(init.headers).get('x-ojo-client-version')).toBe(VERSION);
    }
  });

  it('a request the API answers with an error sends it too', async () => {
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify({ error: true, message: 'Unauthorized' }), {
        status: 401,
        headers: { 'content-type': 'application/json' },
      })
    );

    await expect(new OjoApiClient('key123', 'https://api.example/v1').getCredits()).rejects.toThrow();

    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(new Headers(init.headers).get('x-ojo-client-version')).toBe(VERSION);
  });
});
