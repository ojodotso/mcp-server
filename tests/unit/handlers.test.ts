import { describe, expect, it, vi } from 'vitest';
import { gunzipSync } from 'node:zlib';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import type { OjoApiClient } from '../../src/server/ojo-client.js';
import { OjoApiError } from '../../src/server/ojo-client.js';
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

  it('passes html and variables to createTemplate', async () => {
    const createTemplate = vi
      .fn()
      .mockResolvedValue({ id: 'tpl_new', message: 'Template created' });
    const handler = makeCreateTemplate(fakeClient({ createTemplate }));

    const result = await handler({
      html: '<h1>{{title}}</h1>',
      variables: { title: 'Hi' },
    });

    expect(createTemplate).toHaveBeenCalledWith('<h1>{{title}}</h1>', {
      title: 'Hi',
    });
    expect(JSON.parse(firstText(result)).id).toBe('tpl_new');
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
});
