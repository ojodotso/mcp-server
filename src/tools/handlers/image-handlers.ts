import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import type {
  GeneratedImage,
  OjoApiClient,
} from '../../server/ojo-client.js';
import { renderPreview, type RenderPreview } from '../../server/preview.js';
import type {
  GenerateImageFromHtmlArgs,
  GenerateImageFromTemplateArgs,
} from '../schema.js';
import { toErrorResult } from '../result.js';

export function makeGenerateImageFromHtml(
  client: OjoApiClient,
  preview: RenderPreview = renderPreview
) {
  return async (args: GenerateImageFromHtmlArgs): Promise<CallToolResult> => {
    try {
      const { html, inspect, ...viewport } = args;
      const image = await client.createImageFromHtml(html, viewport);
      return buildImageResult(image, inspect ?? false, preview);
    } catch (error) {
      return toErrorResult(error);
    }
  };
}

export function makeGenerateImageFromTemplate(
  client: OjoApiClient,
  preview: RenderPreview = renderPreview
) {
  return async (
    args: GenerateImageFromTemplateArgs
  ): Promise<CallToolResult> => {
    try {
      const { templateId, modify, inspect, ...viewport } = args;
      const image = await client.createImageFromTemplate(
        templateId,
        modify ?? {},
        viewport
      );
      return buildImageResult(image, inspect ?? false, preview);
    } catch (error) {
      return toErrorResult(error);
    }
  };
}

async function buildImageResult(
  image: GeneratedImage,
  inspect: boolean,
  preview: RenderPreview
): Promise<CallToolResult> {
  const content: CallToolResult['content'] = [
    { type: 'text', text: formatImage(image) },
  ];
  if (inspect) {
    try {
      const { data, mimeType } = await preview(image.imageUrl);
      content.push({ type: 'image', data, mimeType });
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      content.push({ type: 'text', text: `(preview unavailable: ${detail})` });
    }
  }
  return { content };
}

function formatImage(image: GeneratedImage): string {
  return [
    'Image generated successfully.',
    `id: ${image.id}`,
    `url: ${image.imageUrl}`,
  ].join('\n');
}
