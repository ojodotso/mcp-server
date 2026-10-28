import { describe, expect, it, vi } from 'vitest';
import { gunzipSync } from 'node:zlib';
import { randomBytes } from 'node:crypto';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { OjoApiClient, OjoApiError } from '../../src/server/ojo-client.js';
import {
  makeGenerateImageFromHtml,
  makeGenerateImageFromTemplate,
} from '../../src/tools/handlers/image-handlers.js';
import {
  makeCreateTemplate,
  makeGetTemplate,
  makeListTemplates,
} from '../../src/tools/handlers/template-handlers.js';
import { makeCreatePreviewLink } from '../../src/tools/handlers/preview-handlers.js';
import { makeGeneratePdfFromTemplate } from '../../src/tools/handlers/pdf-handlers.js';

function fakeClient(methods: Partial<OjoApiClient>): OjoApiClient {
  return methods as OjoApiClient;
}

function firstText(result: CallToolResult): string {
  const block = result.content[0]!;
  if (block.type !== 'text') {
    throw new Error(`expected a text block, got ${block.type}`);
  }
  return block.text;
}

const okPreview = vi.fn().mockResolvedValue({
  data: 'AAA',
  mimeType: 'image/webp',
});

describe('image handlers', () => {
  it('passes html and viewport options through to the client', async () => {
    const createImageFromHtml = vi
      .fn()
      .mockResolvedValue({ id: 'img', imageUrl: 'https://u/x.png' });
    const handler = makeGenerateImageFromHtml(
      fakeClient({ createImageFromHtml }),
      okPreview
    );

    const result = await handler({ html: '<h1>hi</h1>', viewportWidth: 500 });

    expect(createImageFromHtml).toHaveBeenCalledWith('<h1>hi</h1>', {
      viewportWidth: 500,
    });
    expect(result.isError).toBeFalsy();
    expect(firstText(result)).toContain('https://u/x.png');
  });

  it('does not request a preview unless inspect is set', async () => {
    const createImageFromHtml = vi
      .fn()
      .mockResolvedValue({ id: 'i', imageUrl: 'https://u/x.png' });
    const preview = vi.fn();
    const handler = makeGenerateImageFromHtml(
      fakeClient({ createImageFromHtml }),
      preview
    );

    const result = await handler({ html: '<p>x</p>' });

    expect(preview).not.toHaveBeenCalled();
    expect(result.content).toHaveLength(1);
    expect(result.content[0]!.type).toBe('text');
  });

  it('appends a preview image block when inspect is true', async () => {
    const createImageFromHtml = vi
      .fn()
      .mockResolvedValue({ id: 'i', imageUrl: 'https://u/x.png' });
    const preview = vi
      .fn()
      .mockResolvedValue({ data: 'BASE64', mimeType: 'image/webp' });
    const handler = makeGenerateImageFromHtml(
      fakeClient({ createImageFromHtml }),
      preview
    );

    const result = await handler({ html: '<p>x</p>', inspect: true });

    expect(preview).toHaveBeenCalledWith('https://u/x.png');
    expect(result.content).toHaveLength(2);
    expect(result.content[1]).toMatchObject({
      type: 'image',
      data: 'BASE64',
      mimeType: 'image/webp',
    });
  });

  it('still succeeds (text only) when the preview fails', async () => {
    const createImageFromHtml = vi
      .fn()
      .mockResolvedValue({ id: 'i', imageUrl: 'https://u/x.png' });
    const preview = vi.fn().mockRejectedValue(new Error('boom'));
    const handler = makeGenerateImageFromHtml(
      fakeClient({ createImageFromHtml }),
      preview
    );

    const result = await handler({ html: '<p>x</p>', inspect: true });

    expect(result.isError).toBeFalsy();
    expect(result.content).toHaveLength(2);
    expect(result.content[1]).toMatchObject({ type: 'text' });
    expect((result.content[1] as { text: string }).text).toContain('boom');
  });

  it('passes templateId, modify and viewport to the client', async () => {
    const createImageFromTemplate = vi
      .fn()
      .mockResolvedValue({ id: 'img', imageUrl: 'u' });
    const handler = makeGenerateImageFromTemplate(
      fakeClient({ createImageFromTemplate }),
      okPreview
    );

    await handler({ templateId: 'tpl', modify: { a: 1 }, viewportHeight: 300 });

    expect(createImageFromTemplate).toHaveBeenCalledWith(
      'tpl',
      { a: 1 },
      { viewportHeight: 300 }
    );
  });

  it('defaults modify to an empty object when omitted', async () => {
    const createImageFromTemplate = vi
      .fn()
      .mockResolvedValue({ id: 'i', imageUrl: 'u' });
    const handler = makeGenerateImageFromTemplate(
      fakeClient({ createImageFromTemplate }),
      okPreview
    );

    await handler({ templateId: 'tpl' });

    expect(createImageFromTemplate).toHaveBeenCalledWith('tpl', {}, {});
  });

  it('returns an isError result when the client throws an OjoApiError', async () => {
    const createImageFromHtml = vi
      .fn()
      .mockRejectedValue(new OjoApiError(402, 'Out of credits — no credits left.'));
    const handler = makeGenerateImageFromHtml(
      fakeClient({ createImageFromHtml }),
      okPreview
    );

    const result = await handler({ html: '<p>x</p>' });

    expect(result.isError).toBe(true);
    expect(firstText(result)).toContain('Out of credits');
  });
});

describe('pdf handlers (AC58)', () => {
  const PDF = {
    id: 'pdf_1',
    pdfUrl: 'https://u/p.pdf',
    pages: 57,
    credits: 3,
    entries: [
      { index: 0, pages: 7 },
      { index: 1, pages: 19 },
      { index: 2, pages: 31 },
    ],
  };
  const PAGES = [
    { templateId: 'tpl_cover', modify: { title: 'Q3' } },
    { html: '<h1>{{title}}</h1>' },
    { modify: { section: 2 } },
  ];

  it('passes templateId, modify and pages to the client unchanged', async () => {
    const createPdfFromTemplate = vi.fn().mockResolvedValue(PDF);
    const handler = makeGeneratePdfFromTemplate(
      fakeClient({ createPdfFromTemplate })
    );

    await handler({
      templateId: 'tpl_default',
      modify: { shared: true },
      pages: PAGES,
    });

    expect(createPdfFromTemplate).toHaveBeenCalledWith({
      templateId: 'tpl_default',
      modify: { shared: true },
      pages: PAGES,
    });
  });

  it('passes pages without a top-level templateId', async () => {
    const createPdfFromTemplate = vi.fn().mockResolvedValue(PDF);
    const handler = makeGeneratePdfFromTemplate(
      fakeClient({ createPdfFromTemplate })
    );

    await handler({ modify: { shared: true }, pages: PAGES });

    // toEqual treats an undefined templateId as absent.
    expect(createPdfFromTemplate.mock.calls).toEqual([
      [{ modify: { shared: true }, pages: PAGES }],
    ]);
  });
});

describe('template handlers', () => {
  it('passes list params through and returns JSON text', async () => {
    const listTemplates = vi
      .fn()
      .mockResolvedValue({ items: [{ template_id: 't1', name: 'A' }], totalItems: 1 });
    const handler = makeListTemplates(fakeClient({ listTemplates }));

    const result = await handler({ page: 1 });

    expect(listTemplates).toHaveBeenCalledWith({ page: 1 });
    expect(JSON.parse(firstText(result))).toMatchObject({ totalItems: 1 });
  });

  it('passes templateId to getTemplate and returns JSON text', async () => {
    const getTemplate = vi.fn().mockResolvedValue({
      id: 't',
      name: 'A',
      html: '<h1>hi</h1>',
      variables: {},
    });
    const handler = makeGetTemplate(fakeClient({ getTemplate }));

    const result = await handler({ templateId: 't' });

    expect(getTemplate).toHaveBeenCalledWith('t');
    expect(JSON.parse(firstText(result)).html).toBe('<h1>hi</h1>');
  });

  // Asserted on the request that reaches fetch, not on the client's call shape, which no
  // criterion fixes (2026-10-26 MCP API parity spec, Q2).
  it('sends html and variables to POST /template and returns the JSON as text', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ id: 'tpl_new', message: 'Template created' }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      })
    );
    vi.stubGlobal('fetch', fetchMock);
    try {
      const handler = makeCreateTemplate(new OjoApiClient('k', 'https://api.example/v1'));

      const result = await handler({
        html: '<h1>{{title}}</h1>',
        variables: { title: 'Hi' },
      });

      expect(fetchMock).toHaveBeenCalledTimes(1);
      const [url, init] = fetchMock.mock.calls[0]! as [string, { method?: string; body?: string }];
      expect(url).toBe('https://api.example/v1/template');
      expect(init.method).toBe('POST');
      expect(JSON.parse(init.body!)).toEqual({
        html: '<h1>{{title}}</h1>',
        variables: { title: 'Hi' },
      });
      expect(JSON.parse(firstText(result)).id).toBe('tpl_new');
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('returns an isError result when getTemplate throws', async () => {
    const getTemplate = vi
      .fn()
      .mockRejectedValue(new OjoApiError(401, 'Unauthorized — set OJO_API_KEY.'));
    const handler = makeGetTemplate(fakeClient({ getTemplate }));

    const result = await handler({ templateId: 't' });

    expect(result.isError).toBe(true);
    expect(firstText(result)).toContain('Unauthorized');
  });
});

describe('preview handler', () => {
  it('returns a /preview#draft= link encoding html, variables and dimensions', async () => {
    const handler = makeCreatePreviewLink('https://ojo.so');

    const result = await handler({
      html: '<h1>{{title}}</h1>',
      variables: { title: 'Hi' },
      viewportWidth: 1080,
      viewportHeight: 1080,
    });

    expect(result.isError).toBeFalsy();
    const match = firstText(result).match(/\/preview#draft=([\w-]+)/);
    expect(match).toBeTruthy();

    const decoded = JSON.parse(
      gunzipSync(Buffer.from(match![1]!, 'base64url')).toString('utf-8')
    );
    expect(decoded).toEqual({
      content: '<h1>{{title}}</h1>',
      variables: { title: 'Hi' },
      width: 1080,
      height: 1080,
    });
  });

  it('omits dimensions from the payload when not provided', async () => {
    const handler = makeCreatePreviewLink('https://ojo.so');

    const result = await handler({ html: '<p>x</p>' });

    const match = firstText(result).match(/\/preview#draft=([\w-]+)/);
    const decoded = JSON.parse(
      gunzipSync(Buffer.from(match![1]!, 'base64url')).toString('utf-8')
    );
    expect(decoded).toEqual({ content: '<p>x</p>' });
  });

  it('refuses a draft whose encoded link would exceed the size limit', async () => {
    const handler = makeCreatePreviewLink('https://ojo.so');

    // Incompressible, the way an inlined data: URI behaves — this is the case
    // the limit exists for. Compressible markup of the same length would pass.
    const inlined = randomBytes(32 * 1024).toString('base64');
    const result = await handler({
      html: `<img src="data:image/png;base64,${inlined}">`,
    });

    expect(firstText(result)).not.toContain('/preview#draft=');
    expect(firstText(result)).toContain('over the 16 KB limit');
    expect(firstText(result)).toContain('https');
  });

  it('still allows text-heavy markup far larger than the link limit', async () => {
    const handler = makeCreatePreviewLink('https://ojo.so');

    // The negative arm of the test above: ~40 KB of compressible HTML must NOT
    // trip the limit, or the guard would be rejecting ordinary drafts.
    const result = await handler({
      html: `<ul>${'<li class="row">metric</li>'.repeat(1600)}</ul>`,
    });

    expect(firstText(result)).toContain('/preview#draft=');
    expect(firstText(result)).not.toContain('too large');
  });
});
