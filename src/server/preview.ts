import sharp from 'sharp';

export interface ImagePreview {
  data: string;
  mimeType: string;
}

/**
 * Fetch a generated image from its public URL and downscale it locally to a
 * small webp so it can be returned as inline MCP image content without bloating
 * the agent's context. The public hotlink needs no auth and costs no credit.
 */
export async function renderPreview(imageUrl: string): Promise<ImagePreview> {
  const response = await fetch(imageUrl);
  if (!response.ok) {
    throw new Error(`Failed to fetch image for preview (${response.status})`);
  }
  const input = Buffer.from(await response.arrayBuffer());
  const output = await sharp(input)
    .resize({ width: 512, withoutEnlargement: true })
    .webp({ quality: 80 })
    .toBuffer();
  return { data: output.toString('base64'), mimeType: 'image/webp' };
}

export type RenderPreview = typeof renderPreview;
